import { createFeeCalculator, createPriceList, type PriceVersion } from '../../../committee-prices/public';
import { FixedClock } from '../../../../shared/clock';
import type { SiteId } from '../../../../shared/identifiers';
import { fail, succeed, type Result } from '../../../../shared/result';
import { createTicketClosing, createTicketOpening, createTicketPaymentStatus, InMemoryTicketStore, type OpenTicketCommand, type SiteCodeProblem, type TicketingSites } from '../../public';

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

/** Who works where: an attendant is assigned to at most one site. */
export class FakeAssignments {
  private readonly sites = new Map<string, string>();

  assign(attendantId: string, siteId: string): this {
    this.sites.set(attendantId, siteId);
    return this;
  }

  async isAssignedTo(attendantId: string, siteId: string): Promise<boolean> {
    await Promise.resolve();
    return this.sites.get(attendantId) === siteId;
  }
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
}

export async function buildTicketingWorld(capacity = 5, options: WorldOptions = {}) {
  const sites = new FakeSites().withCapacity('site-1', capacity);
  const store = new InMemoryTicketStore();
  const clock = new FixedClock(START);
  let counter = 0;
  const assignments = new FakeAssignments().assign('attendant-1', 'site-1').assign('attendant-2', 'site-2');
  const opening = createTicketOpening({ sites, store, clock, assignments, newTicketId: () => `ticket-${(counter += 1)}` });
  const prices = createPriceList({ isApproved: () => true });
  if (options.withPrice !== false) {
    await prices.applyApprovedVersion(PRICE, 'approval-1');
  }
  const residents = options.residents ?? [];
  const fees = createFeeCalculator({ isResident: (carRef, siteId) => siteId === 'site-1' && residents.includes(carRef) });
  const closing = createTicketClosing({ sites, store, clock, prices, fees, assignments });
  const payments = createTicketPaymentStatus({ store });
  return { sites, store, clock, opening, closing, payments, prices, assignments, fees };
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
