import { f10PersonalDataColumnsStayInTheirSchema } from './f10-personal-data-columns-stay-in-their-schema';
import { f11WriteSchemasCarryNoTimestamp } from './f11-write-schemas-carry-no-timestamp';
import { f12PersonalFieldsHaveARedactionRule } from './f12-personal-fields-have-a-redaction-rule';
import { f13OnlySignInIsPublic } from './f13-only-sign-in-is-public';
import { f14ProductionCodeNeverReachesTestCode } from './f14-production-code-never-reaches-test-code';
import { f1CommitteePricesIsPure } from './f1-committee-prices-is-pure';
import type { FitnessFunction } from './support/fitness-result';

export const allFitnessFunctions: readonly FitnessFunction[] = [
  f1CommitteePricesIsPure,
  f10PersonalDataColumnsStayInTheirSchema,
  f11WriteSchemasCarryNoTimestamp,
  f12PersonalFieldsHaveARedactionRule,
  f13OnlySignInIsPublic,
  f14ProductionCodeNeverReachesTestCode,
];
