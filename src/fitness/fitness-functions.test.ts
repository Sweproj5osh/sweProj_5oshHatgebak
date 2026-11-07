import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { allFitnessFunctions } from './all-fitness-functions';
import { f10PersonalDataColumnsStayInTheirSchema } from './f10-personal-data-columns-stay-in-their-schema';
import { f11WriteSchemasCarryNoTimestamp } from './f11-write-schemas-carry-no-timestamp';
import { f12PersonalFieldsHaveARedactionRule, namesPersonalData } from './f12-personal-fields-have-a-redaction-rule';
import { f1CommitteePricesIsPure } from './f1-committee-prices-is-pure';
import { f2CrossModuleImportsUsePublicInterfaces } from './f2-cross-module-imports-use-public-interfaces';
import { f8MustStayOnNeverImportsMayFail } from './f8-must-stay-on-never-imports-may-fail';
import { FIXTURES_FOLDER } from './support/import-scanner';
import { columnsDeclaredIn } from './support/sql-columns';

const repositoryRoot = process.cwd();
const fixture = (name: string) => path.join(repositoryRoot, FIXTURES_FOLDER, name);

describe('fitness functions pass on this repository', () => {
  it('all of them are green and report how much they checked', async () => {
    const started = performance.now();
    const results = await Promise.all(allFitnessFunctions.map((fitnessFunction) => fitnessFunction(repositoryRoot)));
    const milliseconds = (performance.now() - started).toFixed(0);
    for (const result of results) {
      expect(result.violations, result.name).toEqual([]);
      expect(result.checked, `${result.name} must inspect something`).toBeGreaterThan(0);
    }
    console.log(`Z8 report: suite of ${results.length} fitness functions ran in ${milliseconds} ms`);
  });
});

describe('each fitness function fails on its planted violation', () => {
  it('F1 catches committee-prices importing ticketing and node:crypto', async () => {
    const result = await f1CommitteePricesIsPure(fixture('f1-violation'));
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(2);
  });

  it('F2 catches an import of another module\'s internal file', async () => {
    const result = await f2CrossModuleImportsUsePublicInterfaces(fixture('f2-violation'));
    expect(result.passed).toBe(false);
    expect(result.violations[0]).toContain('audit-log/internal/read-scope');
  });

  it('F2 catches a module importing the entry point', async () => {
    const result = await f2CrossModuleImportsUsePublicInterfaces(fixture('f2-entrypoint-violation'));
    expect(result.passed).toBe(false);
    expect(result.violations[0]).toContain('src/entrypoint, which no module or app may import');
  });

  it('F8 catches a must-stay-on module importing a may-fail module', async () => {
    const result = await f8MustStayOnNeverImportsMayFail(fixture('f8-violation'));
    expect(result.passed).toBe(false);
    expect(result.violations[0]).toContain('ticketing reaches may-fail module notifications');
  });

  it('F10 catches plate and phone columns outside personal_data, in CREATE TABLE and ALTER TABLE', async () => {
    const result = await f10PersonalDataColumnsStayInTheirSchema(fixture('f10-violation'));
    expect(result.passed).toBe(false);
    expect(result.violations.map((violation) => violation.split(': ')[1]?.split(' ')[0])).toEqual([
      'ticketing.tickets.plate',
      'ticketing.tickets.driver_phone',
    ]);
  });

  it('F11 catches a closedAt field and a localDateTime outside the committee, and allows the committee\'s closure', async () => {
    const result = await f11WriteSchemasCarryNoTimestamp(fixture('f11-violation'));
    expect(result.passed).toBe(false);
    expect(result.violations).toEqual([
      'bad.closeTicket declares the field "closedAt", which looks like a timestamp',
      'bad.driverDeclaresWhenParked declares the localDateTime field "parkedFrom", but only committee operations (roles member, chair) may take a calendar time',
    ]);
  });

  it('F12 catches personal fields without a redaction rule, including compound names, and accepts covered ones', async () => {
    const result = await f12PersonalFieldsHaveARedactionRule(fixture('f12-violation'));
    expect(result.passed).toBe(false);
    expect(result.violations).toEqual([
      'bad.addCar declares the personal field "plate" with no audit.omit or audit.replace rule covering it',
      'bad.createPerson declares the personal field "displayName" with no audit.omit or audit.replace rule covering it',
    ]);
  });
});

describe('SQL column scanner', () => {
  it('reads schema, table and columns and skips constraints', () => {
    const sql = `CREATE TABLE IF NOT EXISTS "personal_data"."people" (
      id bigint PRIMARY KEY,
      full_name text NOT NULL CHECK (length(full_name) > 0),
      PRIMARY KEY (id),
      CONSTRAINT one_name UNIQUE (full_name)
    );`;
    expect(columnsDeclaredIn(sql)).toEqual([
      { schema: 'personal_data', table: 'people', column: 'id' },
      { schema: 'personal_data', table: 'people', column: 'full_name' },
    ]);
  });

  it('defaults to the public schema when the table is not qualified', () => {
    expect(columnsDeclaredIn('CREATE TABLE things (id int);')).toEqual([{ schema: 'public', table: 'things', column: 'id' }]);
  });
});

describe('F12 personal-field detection', () => {
  it.each(['plate', 'phoneNumber', 'displayName', 'owner_phone', 'ownerPhoneDigits', 'Latitude', 'newPassword'])('flags %s', (field) =>
    expect(namesPersonalData(field)).toBe(true),
  );

  it.each(['siteId', 'reason', 'entryCode', 'capacity', 'colour'])('leaves %s alone', (field) =>
    expect(namesPersonalData(field)).toBe(false),
  );
});
