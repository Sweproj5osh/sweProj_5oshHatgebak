import { InMemoryDatabase } from '../../../../adapters/in-memory/in-memory-database';
import { createFeeCalculator, createPriceList, type PriceVersion } from '../../../committee-prices/public';
import { FixedClock } from '../../../../shared/clock';
import type { SiteId, TicketId } from '../../../../shared/identifiers';
import type { RequestId } from '../../../../shared/request-id';
import { fail, succeed, type Result } from '../../../../shared/result';
import type { Transaction } from '../../../../shared/unit-of-work';
import {
  createTicketClosing,
  createTicketOpening,
  createTicketPaymentStatus,
  TableTicketStore,
  type ClockedInAttendant,
  type OpenTicketCommand,
  type PaymentStatus,
  type TicketingDependencies,
  type SiteCodeProblem,
  type TicketingSites,
} from '../../public';

export interface PlateRequest {
  readonly carRef: string;
  readonly reader: string;
  readonly purpose: 'receipt';
  readonly siteId: string;
}

/** The identity area's logged plate lookup, recording every request it is asked. */
export class FakePlates {
  readonly requests: PlateRequest[] = [];
  private readonly plates = new Map<string, string>();
  private readonly refusedReaders = new Set<string>();

  withPlate(carRef: string, plate: string): this {
    this.plates.set(carRef, plate);
    return this;
  }

  refuse(reader: string): this {
    this.refusedReaders.add(reader);
    return this;
  }

  async readPlate(request: PlateRequest): Promise<Result<string, 'refused' | 'not resolvable'>> {
    await Promise.resolve();
    this.requests.push(request);
    if (this.refusedReaders.has(request.reader)) {
      return fail('refused');
    }
    const plate = this.plates.get(request.carRef);
    return plate === undefined ? fail('not resolvable') : succeed(plate);
  }
}

/**
 * The identity area's car register. A registered car belongs to exactly the person it was registered to; a car nobody
 * registered belongs to whoever asks, so the many tests that invent car references need no registration step. A test
 * about ownership registers the car it names.
 */
export class FakeCarOwnership {
  private readonly ownerByCar = new Map<string, string>();

  register(carRef: string, ownerRef: string): this {
    this.ownerByCar.set(carRef, ownerRef);
    return this;
  }

  async carBelongsTo(carRef: string, personId: string): Promise<boolean> {
    await Promise.resolve();
    const owner = this.ownerByCar.get(carRef);
    return owner === undefined || owner === personId;
  }
}

/** The attendants as the entry point would prove them: clocked in at site-1, at site-2, or nowhere. */
export const ATTENDANT_AT_SITE_1: ClockedInAttendant = { attendantId: 'attendant-1', boundSiteId: 'site-1' };
export const ATTENDANT_AT_SITE_2: ClockedInAttendant = { attendantId: 'attendant-2', boundSiteId: 'site-2' };
export const ATTENDANT_CLOCKED_OUT: ClockedInAttendant = { attendantId: 'attendant-unknown' };

/**
 * Access checks for the in-memory application: everyone is live, and each named person's session is bound to the site
 * given here (the stand-in for Lino's clock-in, P26 Q4). The shape is `AccessChecks` from the entry point, left
 * unnamed so this support file imports nothing from `src/entrypoint` (F2).
 */
export function clockedIn(boundSites: Readonly<Record<string, string>>) {
  return {
    may: async () => true,
    liveStatus: async () => 'active' as const,
    boundSite: async (personId: string) => boundSites[personId],
  };
}

/** A site registry stand-in: codes are "entry-<site>" and "exit-<site>", and each site is open or closed by hand. */
export class FakeSites implements TicketingSites {
  private readonly closed = new Set<SiteId>();
  private readonly capacities = new Map<SiteId, number>();

  withCapacity(siteId: SiteId, capacity: number): this {
    this.capacities.set(siteId, capacity);
    return this;
  }

  closeSite(siteId: SiteId): void {
    this.closed.add(siteId);
  }

  async verifyEntryCode(code: string, siteId: SiteId): Promise<Result<SiteId, SiteCodeProblem>> {
    await Promise.resolve();
    if (code.startsWith('exit-')) {
      return fail('wrong kind');
    }
    if (!code.startsWith('entry-')) {
      return fail('forged');
    }
    return code === `entry-${siteId}` ? succeed(siteId) : fail('wrong site');
  }

  async verifyExitCode(code: string, siteId: SiteId): Promise<Result<SiteId, SiteCodeProblem>> {
    await Promise.resolve();
    if (code.startsWith('entry-')) {
      return fail('wrong kind');
    }
    if (!code.startsWith('exit-')) {
      return fail('forged');
    }
    return code === `exit-${siteId}` ? succeed(siteId) : fail('wrong site');
  }

  async isOpenAt(siteId: SiteId): Promise<boolean> {
    await Promise.resolve();
    return this.capacities.has(siteId) && !this.closed.has(siteId);
  }

  async capacityOf(siteId: SiteId): Promise<number | undefined> {
    await Promise.resolve();
    return this.capacities.get(siteId);
  }
}

export const START = new Date('2026-11-09T08:00:00Z');

export const PRICE: PriceVersion = {
  versionId: 'price-1',
  siteId: 'site-1',
  firstHourFee: 10,
  eachLaterHourFee: 5,
  dailyCap: 50,
  validFrom: '2026-11-01T00:00:00.000Z',
};

export interface WorldOptions {
  /** Whether a price is in force at site-1 (default yes). */
  readonly withPrice?: boolean;
  /** Cars registered as residents at site-1. */
  readonly residents?: readonly string[];
  /** Whether the resident lookup fails instead of answering (the identity area down). */
  readonly residentLookupFails?: boolean;
}

/**
 * The ticketing module over an in-memory database, with its ports faked. Each wrapper below (`openTicket`, `closeTicket`,
 * …) runs one call in its own unit of work and commits, as one request through the entry point would (ADR-13); a test
 * that needs several calls in one transaction uses `transact` directly.
 */
export async function buildTicketingWorld(capacity = 5, options: WorldOptions = {}) {
  const database = new InMemoryDatabase();
  const sites = new FakeSites().withCapacity('site-1', capacity);
  const store = new TableTicketStore();
  const clock = new FixedClock(START);
  const plates = new FakePlates().withPlate('car-a', 'ABC 123');
  const cars = new FakeCarOwnership();
  let counter = 0;
  const opening = createTicketOpening({ sites, carOwnership: cars, store, clock, newTicketId: () => `ticket-${(counter += 1)}` });
  const prices = createPriceList({ isApproved: () => true });
  if (options.withPrice !== false) {
    await prices.applyApprovedVersion(PRICE, 'approval-1');
  }
  const residents = options.residents ?? [];
  const fees = createFeeCalculator({
    isResident: (carRef, siteId) => {
      if (options.residentLookupFails === true) {
        throw new Error('registrations unavailable');
      }
      return siteId === 'site-1' && residents.includes(carRef);
    },
  });
  const closing = createTicketClosing({ sites, store, clock, prices, fees });
  const payments = createTicketPaymentStatus({ store });
  const dependencies: TicketingDependencies = { carOwnership: cars, clock, fees, plates, prices, sites, tickets: store };

  async function transact<Value>(work: (transaction: Transaction) => Promise<Value>): Promise<Value> {
    const transaction = database.begin();
    try {
      const value = await work(transaction);
      await transaction.commit();
      return value;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  return {
    database,
    sites,
    store,
    clock,
    opening,
    closing,
    payments,
    prices,
    fees,
    plates,
    cars,
    /** The ports as `operations(dependencies)` and the composition root's `moduleDependencies` option take them. */
    dependencies,
    transact,
    openTicket: (command: OpenTicketCommand) => transact((transaction) => opening.openTicket(transaction, command)),
    openAssistedTicket: (command: OpenTicketCommand, attendant: ClockedInAttendant) =>
      transact((transaction) => opening.openAssistedTicket(transaction, command, attendant)),
    closeTicket: (requestId: RequestId, ticketId: TicketId, exitCode: string) =>
      transact((transaction) => closing.closeTicket(transaction, requestId, ticketId, exitCode)),
    closeAssistedTicket: (requestId: RequestId, ticketId: TicketId, exitCode: string, attendant: ClockedInAttendant, carRef: string) =>
      transact((transaction) => closing.closeAssistedTicket(transaction, requestId, ticketId, exitCode, attendant, carRef)),
    changePaymentStatus: (requestId: RequestId, ticketId: TicketId, to: PaymentStatus) =>
      transact((transaction) => payments.changePaymentStatus(transaction, requestId, ticketId, to)),
    findById: (ticketId: TicketId) => store.findById(database, ticketId),
    countOpen: (siteId: SiteId) => store.countOpen(database, siteId),
  };
}

let requestCounter = 0;

export function assistedCommand(overrides: Partial<OpenTicketCommand> = {}): OpenTicketCommand {
  return openCommand({ driverRef: 'walk-in-driver', ...overrides });
}

export function openCommand(overrides: Partial<OpenTicketCommand> = {}): OpenTicketCommand {
  requestCounter += 1;
  return {
    requestId: `request-${requestCounter}`,
    driverRef: 'driver-1',
    carRef: `car-${requestCounter}`,
    siteId: 'site-1',
    entryCode: 'entry-site-1',
    ...overrides,
  };
}
