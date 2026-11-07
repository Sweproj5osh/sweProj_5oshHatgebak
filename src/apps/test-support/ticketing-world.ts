/**
 * Karim's real ticketing operations from main, composed for the apps' data-layer tests through his public interface
 * only (fitness function F2). What his module asks of other modules is answered by fakes here: the site registry's
 * codes ("entry-<site>" and "exit-<site>"), the price list with one approved version per site, and the plate lookup.
 * Nothing here is a stand-in for an operation: the operations under test are the ones the server runs.
 */
import { createFeeCalculator, createPriceList, type PriceVersion } from '../../modules/committee-prices/public';
import {
  createTicketClosing,
  createTicketCounts,
  createTicketingOperations,
  createTicketOpening,
  createTicketReading,
  InMemoryTicketStore,
  type PlateLookup,
  type SiteCodeProblem,
  type TicketingSites,
} from '../../modules/ticketing/public';
import { FixedClock } from '../../shared/clock';
import type { SiteId } from '../../shared/identifiers';
import type { Operation } from '../../shared/operation-contract';
import { fail, succeed, type Result } from '../../shared/result';

export const TICKETING_WORLD_START = new Date('2026-11-09T08:00:00Z');

/** The price every site in the world charges: ten pounds for the first hour, five for each later one, fifty a day. */
export const WORLD_PRICE = { firstHourFee: 10, eachLaterHourFee: 5, dailyCap: 50 };

export interface TicketingWorldOptions {
  /** The sites that exist, each with its capacity. */
  readonly sites: Readonly<Record<SiteId, number>>;
  /** The plate the lookup answers for a car reference; a car without one makes the receipt refuse. */
  readonly plates?: Readonly<Record<string, string>>;
}

export interface TicketingWorld {
  readonly operations: readonly Operation[];
  readonly clock: FixedClock;
  readonly price: typeof WORLD_PRICE;
  openTicketsAt(siteId: SiteId): Promise<number>;
}

/** A site registry stand-in for Karim's port: codes are "entry-<site>" and "exit-<site>"; every known site is open. */
class FakeSites implements TicketingSites {
  constructor(private readonly capacities: ReadonlyMap<SiteId, number>) {}

  async verifyEntryCode(code: string, siteId: SiteId): Promise<Result<SiteId, SiteCodeProblem>> {
    return verifyCode(code, siteId, 'entry-', 'exit-');
  }

  async verifyExitCode(code: string, siteId: SiteId): Promise<Result<SiteId, SiteCodeProblem>> {
    return verifyCode(code, siteId, 'exit-', 'entry-');
  }

  async isOpenAt(siteId: SiteId): Promise<boolean> {
    return this.capacities.has(siteId);
  }

  async capacityOf(siteId: SiteId): Promise<number | undefined> {
    return this.capacities.get(siteId);
  }
}

function verifyCode(code: string, siteId: SiteId, expectedKind: string, otherKind: string): Result<SiteId, SiteCodeProblem> {
  if (code.startsWith(otherKind)) {
    return fail('wrong kind');
  }
  if (!code.startsWith(expectedKind)) {
    return fail('forged');
  }
  return code === `${expectedKind}${siteId}` ? succeed(siteId) : fail('wrong site');
}

/** The identity area's logged plate lookup, answering the plates the world was given. */
class FakePlates implements PlateLookup {
  constructor(private readonly plates: ReadonlyMap<string, string>) {}

  async readPlate(request: { readonly carRef: string }): Promise<Result<string, 'refused' | 'not resolvable'>> {
    const plate = this.plates.get(request.carRef);
    return plate === undefined ? fail('not resolvable') : succeed(plate);
  }
}

export async function buildTicketingWorld(options: TicketingWorldOptions): Promise<TicketingWorld> {
  const capacities = new Map(Object.entries(options.sites));
  const sites = new FakeSites(capacities);
  const store = new InMemoryTicketStore();
  const clock = new FixedClock(TICKETING_WORLD_START);
  let ticketCounter = 0;
  const opening = createTicketOpening({ sites, store, clock, newTicketId: () => `ticket-${(ticketCounter += 1)}` });
  const prices = createPriceList({ isApproved: () => true });
  for (const siteId of capacities.keys()) {
    await prices.applyApprovedVersion(priceVersionFor(siteId), `approval-${siteId}`);
  }
  const fees = createFeeCalculator({});
  const closing = createTicketClosing({ sites, store, clock, prices, fees });
  const reading = createTicketReading({ store, plates: new FakePlates(new Map(Object.entries(options.plates ?? {}))), fees });
  const counts = createTicketCounts({ sites, store });
  return {
    operations: createTicketingOperations({ opening, closing, store, reading }),
    clock,
    price: WORLD_PRICE,
    openTicketsAt: async (siteId) => (capacities.get(siteId) ?? 0) - (await counts.freeSpaces(siteId)),
  };
}

function priceVersionFor(siteId: SiteId): PriceVersion {
  return { versionId: `price-${siteId}`, siteId, ...WORLD_PRICE, validFrom: '2026-11-01T00:00:00.000Z' };
}
