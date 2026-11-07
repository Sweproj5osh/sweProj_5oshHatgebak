import { f10PersonalDataColumnsStayInTheirSchema } from './f10-personal-data-columns-stay-in-their-schema';
import { f11WriteSchemasCarryNoTimestamp } from './f11-write-schemas-carry-no-timestamp';
import { f12PersonalFieldsHaveARedactionRule } from './f12-personal-fields-have-a-redaction-rule';
import { f13OnlySignInIsPublic } from './f13-only-sign-in-is-public';
import { f1CommitteePricesIsPure } from './f1-committee-prices-is-pure';
import { f2CrossModuleImportsUsePublicInterfaces } from './f2-cross-module-imports-use-public-interfaces';
import { f8MustStayOnNeverImportsMayFail } from './f8-must-stay-on-never-imports-may-fail';
import type { FitnessFunction } from './support/fitness-result';

export const allFitnessFunctions: readonly FitnessFunction[] = [
  f1CommitteePricesIsPure,
  f2CrossModuleImportsUsePublicInterfaces,
  f8MustStayOnNeverImportsMayFail,
  f10PersonalDataColumnsStayInTheirSchema,
  f11WriteSchemasCarryNoTimestamp,
  f12PersonalFieldsHaveARedactionRule,
  f13OnlySignInIsPublic,
];
