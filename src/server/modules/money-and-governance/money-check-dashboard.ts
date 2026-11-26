/**
 * Money Check & Dashboard — owner: Teammate C (Area 4). May-fail set.
 * Money due versus collected per site and period; owns no table (ADR-06 Rule G). Reads TicketQuery, PaymentLedger,
 * DepositLedger.
 */
import type { DistrictId, PersonId, SiteId } from '../../shared/identifiers';
import type { Result } from '../../shared/result';

export interface MoneyCheckFigures {
  readonly due: number;
  readonly paidInApp: number;
  readonly cashTicked: number;
  readonly depositsConfirmed: number;
  /** cash ticked minus deposited */
  readonly gap: number;
}

export interface DashboardView {
  readonly districts: readonly DistrictId[];
  readonly figuresBySite: Readonly<Record<SiteId, MoneyCheckFigures>>;
}

export interface MoneyCheck {
  computeFor(siteId: SiteId, periodStart: Date, periodEnd: Date): Promise<MoneyCheckFigures>;
  dashboardFor(viewer: PersonId): Promise<Result<DashboardView, 'committee only'>>;
}
