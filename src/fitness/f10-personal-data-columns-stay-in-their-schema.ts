import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { defineFitnessFunction } from './support/fitness-result';
import { runWhenInvokedDirectly } from './support/run-as-script';
import { columnsDeclaredIn } from './support/sql-columns';

export const PERSONAL_DATA_SCHEMA = 'personal_data';
const PERSONAL_DATA_WORDS = ['plate', 'phone', 'name'];

/** F10: no column named plate, phone or name in any migration outside the personal_data schema (ADR-06, Rule F). */
export const f10PersonalDataColumnsStayInTheirSchema = defineFitnessFunction(
  'F10',
  `no plate, phone or name column outside the ${PERSONAL_DATA_SCHEMA} schema`,
  async (repositoryRoot) => {
    const migrationsFolder = path.join(repositoryRoot, 'db', 'migrations');
    const migrationFiles = (await readdir(migrationsFolder).catch(() => [])).filter((name) => name.endsWith('.sql')).sort();
    const violations: string[] = [];
    let checked = 0;
    for (const file of migrationFiles) {
      const columns = columnsDeclaredIn(await readFile(path.join(migrationsFolder, file), 'utf8'));
      checked += columns.length;
      columns
        .filter((column) => column.schema !== PERSONAL_DATA_SCHEMA && namesPersonalData(column.column))
        .forEach((column) => violations.push(`${file}: ${column.schema}.${column.table}.${column.column} names personal data outside ${PERSONAL_DATA_SCHEMA}`));
    }
    return { violations, checked };
  },
);

/** Splits snake_case and quoted camelCase names ("driverName") into words before lower-casing, so no word hides. */
function namesPersonalData(columnName: string): boolean {
  const words = columnName.split(/[_\s]+|(?<=[a-z0-9])(?=[A-Z])/).map((word) => word.toLowerCase());
  return words.some((word) => PERSONAL_DATA_WORDS.includes(word) || word.includes('plate') || word.includes('phone'));
}

runWhenInvokedDirectly(import.meta.url, f10PersonalDataColumnsStayInTheirSchema);
