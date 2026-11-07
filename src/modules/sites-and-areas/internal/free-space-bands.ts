import type { FreeSpaceBand } from '../public';

/**
 * The free-space band cut-offs (task A10, P11): engineering defaults until the committee rules, listed in the "still to
 * decide" list. The server computes the band; the app only displays the word (Rule A, Rule I).
 */

/** "full": this many free spaces or fewer. */
export const FULL_AT_OR_BELOW_SPACES = 0;
/** "few": this many free spaces or fewer … */
export const FEW_AT_OR_BELOW_SPACES = 2;
/** … or this share of the site's capacity or fewer, whichever is the larger number of spaces. */
export const FEW_AT_OR_BELOW_SHARE_OF_CAPACITY = 1 / 5;

/** The cut-offs in one object, for the report and for review. */
export const FREE_SPACE_BAND_POLICY = {
  fullAtOrBelowSpaces: FULL_AT_OR_BELOW_SPACES,
  fewAtOrBelowSpaces: FEW_AT_OR_BELOW_SPACES,
  fewAtOrBelowShareOfCapacity: FEW_AT_OR_BELOW_SHARE_OF_CAPACITY,
} as const;

/** "unknown" when the count could not be read: the map says so rather than guess (Rule G: the tickets win). */
export function bandFor(freeSpaces: number | undefined, capacity: number): FreeSpaceBand {
  if (freeSpaces === undefined) {
    return 'unknown';
  }
  if (freeSpaces <= FULL_AT_OR_BELOW_SPACES) {
    return 'full';
  }
  return freeSpaces <= fewThresholdFor(capacity) ? 'few' : 'free';
}

export function fewThresholdFor(capacity: number): number {
  return Math.max(FEW_AT_OR_BELOW_SPACES, Math.floor(capacity * FEW_AT_OR_BELOW_SHARE_OF_CAPACITY));
}
