export interface DeclaredColumn {
  readonly schema: string;
  readonly table: string;
  readonly column: string;
}

const CREATE_TABLE = /create\s+table\s+(?:if\s+not\s+exists\s+)?([\w".]+)\s*\(/gi;
const ADD_COLUMN = /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([\w".]+)\s+add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?("?\w+"?)/gi;
const RENAME_COLUMN = /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([\w".]+)\s+rename\s+(?:column\s+)?"?\w+"?\s+to\s+("?\w+"?)/gi;
const CONSTRAINT_KEYWORDS = ['constraint', 'primary', 'unique', 'foreign', 'check', 'exclude', 'like'];
const DEFAULT_SCHEMA = 'public';

/** Every column declared by CREATE TABLE, ALTER TABLE ... ADD COLUMN or ALTER TABLE ... RENAME COLUMN ... TO in one migration file. */
export function columnsDeclaredIn(sql: string): DeclaredColumn[] {
  const withoutComments = sql.replace(/--[^\n]*/g, '');
  return [...createdColumns(withoutComments), ...addedColumns(withoutComments), ...renamedColumns(withoutComments)];
}

function createdColumns(sql: string): DeclaredColumn[] {
  return [...sql.matchAll(CREATE_TABLE)].flatMap((match) => {
    const { schema, table } = splitQualifiedName(match[1] ?? '');
    const bodyStart = match.index + match[0].length;
    return topLevelPieces(sql, bodyStart)
      .map(firstWord)
      .filter((word) => word !== '' && !CONSTRAINT_KEYWORDS.includes(word.toLowerCase()))
      .map((column) => ({ schema, table, column }));
  });
}

function addedColumns(sql: string): DeclaredColumn[] {
  return [...sql.matchAll(ADD_COLUMN)].map((match) => ({
    ...splitQualifiedName(match[1] ?? ''),
    column: unquote(match[2] ?? ''),
  }));
}

/** A column renamed INTO a personal name is as much a violation as one created with it. */
function renamedColumns(sql: string): DeclaredColumn[] {
  return [...sql.matchAll(RENAME_COLUMN)].map((match) => ({
    ...splitQualifiedName(match[1] ?? ''),
    column: unquote(match[2] ?? ''),
  }));
}

function splitQualifiedName(qualified: string): { schema: string; table: string } {
  const parts = qualified.split('.').map(unquote);
  const table = parts[parts.length - 1] ?? '';
  const schema = parts.length > 1 ? (parts[parts.length - 2] ?? DEFAULT_SCHEMA) : DEFAULT_SCHEMA;
  return { schema, table };
}

/** The comma-separated pieces inside the parentheses that start at `openParenIndex`, ignoring nested parentheses. */
function topLevelPieces(sql: string, bodyStart: number): string[] {
  const pieces: string[] = [];
  let depth = 0;
  let current = '';
  for (let index = bodyStart; index < sql.length; index += 1) {
    const character = sql[index] ?? '';
    if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      if (depth === 0) {
        pieces.push(current);
        return pieces;
      }
      depth -= 1;
    } else if (character === ',' && depth === 0) {
      pieces.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  return pieces;
}

function firstWord(piece: string): string {
  return unquote(piece.trim().split(/\s+/)[0] ?? '');
}

function unquote(identifier: string): string {
  return identifier.replace(/^"|"$/g, '');
}
