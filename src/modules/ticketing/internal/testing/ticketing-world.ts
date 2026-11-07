import { createFeeCalculator, createPriceList, type PriceVersion } from '../../../committee-prices/public';
import { FixedClock } from '../../../../shared/clock';
import type { SiteId } from '../../../../shared/identifiers';
import { fail, succeed, type Result } from '../../../../shared/result';
import {
  createTicketClosing,
  createTicketOpening,
  createTicketPaymentStatus,
  InMemoryTicketStore,
  type ClockedInAttendant,
  type OpenTicketCommand,
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
}

export async function buildTicketingWorld(capacity = 5, options: WorldOptions = {}) {
  const sites = new FakeSites().withCapacity('site-1', capacity);
  const store = new InMemoryTicketStore();
  const clock = new FixedClock(START);
  let counter = 0;
  const opening = createTicketOpening({ sites, store, clock, newTicketId: () => `ticket-${(counter += 1)}` });
  const prices = createPriceList({ isApproved: () => true });
  if (options.withPrice !== false) {
    await prices.applyApprovedVersion(PRICE, 'approval-1');
  }
  const residents = options.residents ?? [];
  const fees = createFeeCalculator({ isResident: (carRef, siteId) => siteId === 'site-1' && residents.includes(carRef) });
  const closing = createTicketClosing({ sites, store, clock, prices, fees });
  const payments = createTicketPaymentStatus({ store });
  return { sites, store, clock, opening, closing, payments, prices, fees };
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
