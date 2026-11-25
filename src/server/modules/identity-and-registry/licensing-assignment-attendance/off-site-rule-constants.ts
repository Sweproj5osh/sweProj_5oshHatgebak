/**
 * The off-site rule of task A14 (P11): engineering defaults until the committee rules, listed in the "still to decide"
 * list. The server decides the flag from the distances it computed itself (Rule A, Rule I).
 */

/** A reading farther than this from the site's centre counts as away from the site. */
export const OFF_SITE_RADIUS_METERS = 300;

/** Readings must have stayed away for at least this long, without one reading back at the site, before the flag. */
export const OFF_SITE_MINUTES_BEFORE_FLAG = 10;

/** The rule's numbers in one object, for the report and for review. */
export const OFF_SITE_POLICY = { radiusMeters: OFF_SITE_RADIUS_METERS, minutesBeforeFlag: OFF_SITE_MINUTES_BEFORE_FLAG } as const;

export interface DistanceReading {
  readonly distanceMeters: number;
  readonly recordedAt: string;
}

/**
 * True when the latest readings of one shift are all beyond the radius and the oldest of that unbroken run is at least
 * the rule's minutes old. One stray reading never raises a flag; a reading back at the site starts the count afresh.
 */
export function isOffSite(readingsOldestFirst: readonly DistanceReading[], now: Date): boolean {
  const awayRun = trailingRunAway(readingsOldestFirst);
  const oldestAway = awayRun[0];
  if (oldestAway === undefined || awayRun.length < 2) {
    return false;
  }
  return now.getTime() - new Date(oldestAway.recordedAt).getTime() >= OFF_SITE_MINUTES_BEFORE_FLAG * 60_000;
}

function trailingRunAway(readingsOldestFirst: readonly DistanceReading[]): readonly DistanceReading[] {
  const lastAtSite = readingsOldestFirst.findLastIndex((reading) => reading.distanceMeters <= OFF_SITE_RADIUS_METERS);
  return readingsOldestFirst.slice(lastAtSite + 1);
}
