/**
 * Small printing helpers shared by the demo scripts. They only format output; they hold no business rule.
 * The demos never change anything under src/: they call the real application the same way the tests do.
 */
import type { HttpRequest } from '../src/entrypoint/http';
import type { HttpResponse } from '../src/shared/operation-contract';

const useColour = process.stdout.isTTY === true && process.env['NO_COLOR'] === undefined;
const paint = (code: number, text: string): string => (useColour ? `\u001b[${code}m${text}\u001b[0m` : text);

export const bold = (text: string): string => paint(1, text);
export const dim = (text: string): string => paint(2, text);
export const green = (text: string): string => paint(32, text);
export const red = (text: string): string => paint(31, text);
export const cyan = (text: string): string => paint(36, text);
export const yellow = (text: string): string => paint(33, text);

const WIDTH = 78;

export function title(text: string): void {
  console.log('');
  console.log(bold('='.repeat(WIDTH)));
  console.log(bold(` ${text}`));
  console.log(bold('='.repeat(WIDTH)));
}

export function scene(number: number, text: string): void {
  console.log('');
  console.log(cyan(`--- Step ${number}: ${text} ${'-'.repeat(Math.max(0, WIDTH - 12 - text.length))}`));
}

export function note(text: string): void {
  console.log(dim(`    # ${text}`));
}

export function say(text: string): void {
  console.log(`    ${text}`);
}

export function pass(text: string): void {
  console.log(`    ${green('PASS')} ${text}`);
}

export function failed(text: string): void {
  console.log(`    ${red('FAIL')} ${text}`);
}

/** A check that prints PASS or FAIL and sets a non-zero exit code when it fails, so a broken demo is never silent. */
export function expectThat(condition: boolean, text: string): void {
  if (condition) {
    pass(text);
  } else {
    failed(text);
    process.exitCode = 1;
  }
}

/** Long tokens and signed codes would fill the screen: show their start and their length instead. */
function compact(value: unknown): string {
  return JSON.stringify(value, (_key, item) => (typeof item === 'string' && item.length > 60 ? `${item.slice(0, 30)}...(${item.length} characters)` : item));
}

/** Shows one request and the server's answer in the shape a front end would see it. */
export function showExchange(label: string, request: HttpRequest, response: HttpResponse): void {
  const status = response.status;
  const statusText = status < 300 ? green(String(status)) : status < 500 ? yellow(String(status)) : red(String(status));
  console.log(`    ${bold(label)}`);
  console.log(`      ${dim('>')} ${request.method} ${request.path}${queryText(request.query)}`);
  if (request.body !== undefined) {
    console.log(`      ${dim('>')} body ${compact(request.body)}`);
  }
  console.log(`      ${dim('<')} ${statusText} ${compact(response.body)}`);
}

function queryText(query: Readonly<Record<string, string>>): string {
  const entries = Object.entries(query);
  return entries.length === 0 ? '' : `?${entries.map(([key, value]) => `${key}=${value}`).join('&')}`;
}

export function bodyOf<Shape>(response: HttpResponse): Shape {
  return response.body as Shape;
}

export function money(amount: number): string {
  return `${amount} EGP`;
}

export function table(rows: readonly (readonly string[])[]): void {
  const widths = rows[0]!.map((_, column) => Math.max(...rows.map((row) => (row[column] ?? '').length)));
  for (const [index, row] of rows.entries()) {
    console.log(`    ${row.map((cell, column) => cell.padEnd(widths[column]!)).join('  ')}`);
    if (index === 0) {
      console.log(`    ${widths.map((width) => '-'.repeat(width)).join('  ')}`);
    }
  }
}
