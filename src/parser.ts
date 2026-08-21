import type { ParsedRecord, ParseError, ParseResult, RecordType } from './types.js';

const KNOWN_TYPES: ReadonlySet<string> = new Set([
  'A',
  'AAAA',
  'CNAME',
  'MX',
  'NS',
  'TXT',
  'PTR',
  'SRV',
  'SOA',
  'CAA',
]);

const KNOWN_CLASSES: ReadonlySet<string> = new Set(['IN', 'CH', 'HS']);

// Zone files allow ';' comments, but only outside quoted strings (TXT data
// can legitimately contain a semicolon inside quotes).
function stripComment(line: string): string {
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ';' && !inQuotes) {
      return line.slice(0, i);
    }
  }
  return line;
}

function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }
    if (/\s/.test(ch) && !inQuotes) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

interface LogicalLine {
  lineNumber: number;
  text: string;
  raw: string;
  unbalanced: boolean;
}

// Joins records that use parentheses to spread their data across several
// physical lines (SOA is the usual case). Parentheses are grouping syntax,
// not data, so RFC 1035 treats them as equivalent to whitespace once
// matched: each open paren suspends end-of-line-ends-record until its
// matching close paren shows up, possibly many lines later. Comments are
// stripped per physical line first, since a ';' inside the parenthesized
// group still only comments out the rest of that one line.
function joinParenthesizedRecords(rawLines: string[]): LogicalLine[] {
  const logicalLines: LogicalLine[] = [];
  let i = 0;

  while (i < rawLines.length) {
    const startLine = i + 1;
    const rawParts: string[] = [];
    const textParts: string[] = [];
    let depth = 0;
    let malformed = false;
    let inQuotes = false;

    for (;;) {
      rawParts.push(rawLines[i]);
      const withoutComment = stripComment(rawLines[i]);
      let piece = '';
      for (const ch of withoutComment) {
        if (ch === '"') {
          inQuotes = !inQuotes;
          piece += ch;
        } else if (ch === '(' && !inQuotes) {
          depth++;
          piece += ' ';
        } else if (ch === ')' && !inQuotes) {
          depth--;
          piece += ' ';
          if (depth < 0) {
            malformed = true;
            depth = 0;
          }
        } else {
          piece += ch;
        }
      }
      textParts.push(piece);

      if (depth === 0) {
        break;
      }
      i++;
      if (i >= rawLines.length) {
        malformed = true;
        break;
      }
    }

    logicalLines.push({
      lineNumber: startLine,
      text: textParts.join(' '),
      raw: rawParts.join('\n'),
      unbalanced: malformed,
    });
    i++;
  }

  return logicalLines;
}

// A name ending in '.' is already fully qualified. '@' stands for the
// current origin itself. Anything else is relative and gets the origin
// appended, the same way BIND reads an owner name.
function expandName(label: string, origin: string | null): string {
  if (label === '@') {
    return origin ?? label;
  }
  if (label.endsWith('.')) {
    return label;
  }
  if (origin === null) {
    return label;
  }
  return `${label}.${origin}`;
}

// $ORIGIN's own argument follows the same absolute-vs-relative rule as an
// owner name, except '@' has no meaning here since there's no origin yet.
function resolveOrigin(value: string, currentOrigin: string | null): string | null {
  if (value.endsWith('.')) {
    return value;
  }
  if (currentOrigin === null) {
    return null;
  }
  return `${value}.${currentOrigin}`;
}

// Parses a single BIND-style master file. This is a simplified reading of
// RFC 1035 section 5.
export function parseZoneFile(text: string): ParseResult {
  const records: ParsedRecord[] = [];
  const errors: ParseError[] = [];

  let defaultTTL: number | null = null;
  let lastName: string | null = null;
  let origin: string | null = null;

  const logicalLines = joinParenthesizedRecords(text.split(/\r\n|\n/));

  for (const logicalLine of logicalLines) {
    const lineNumber = logicalLine.lineNumber;
    const rawLine = logicalLine.raw;

    if (logicalLine.unbalanced) {
      errors.push({
        line: lineNumber,
        message: 'unbalanced parentheses in record',
        raw: rawLine,
      });
      continue;
    }

    const withoutComment = logicalLine.text;

    if (withoutComment.trim().length === 0) {
      continue;
    }

    const hasLeadingWhitespace = /^[ \t]/.test(withoutComment);
    const tokens = tokenize(withoutComment);

    if (tokens.length === 0) {
      continue;
    }

    if (tokens[0].startsWith('$')) {
      const directive = tokens[0].toUpperCase();
      if (directive === '$TTL') {
        const value = Number(tokens[1]);
        if (Number.isFinite(value)) {
          defaultTTL = value;
        } else {
          errors.push({
            line: lineNumber,
            message: '$TTL requires a numeric value',
            raw: rawLine,
          });
        }
      } else if (directive === '$ORIGIN') {
        const value = tokens[1];
        if (!value) {
          errors.push({
            line: lineNumber,
            message: '$ORIGIN requires a domain name',
            raw: rawLine,
          });
        } else {
          const resolved = resolveOrigin(value, origin);
          if (resolved === null) {
            errors.push({
              line: lineNumber,
              message: '$ORIGIN value must be fully qualified until an origin is already set',
              raw: rawLine,
            });
          } else {
            origin = resolved;
          }
        }
      }
      // Other directives are accepted but not yet acted on.
      continue;
    }

    let idx = 0;
    let name: string;
    if (hasLeadingWhitespace) {
      if (lastName === null) {
        errors.push({
          line: lineNumber,
          message: 'record has no name and no prior record to inherit one from',
          raw: rawLine,
        });
        continue;
      }
      name = lastName;
    } else {
      name = expandName(tokens[idx++], origin);
      lastName = name;
    }

    let ttl = defaultTTL;
    let recordClass = 'IN';

    // TTL and class can appear in either order, and both are optional.
    while (idx < tokens.length) {
      const token = tokens[idx];
      if (/^\d+$/.test(token)) {
        ttl = Number(token);
        idx++;
      } else if (KNOWN_CLASSES.has(token.toUpperCase())) {
        recordClass = token.toUpperCase();
        idx++;
      } else {
        break;
      }
    }

    const typeToken = tokens[idx];
    idx++;

    if (!typeToken || !KNOWN_TYPES.has(typeToken.toUpperCase())) {
      errors.push({
        line: lineNumber,
        message: `unrecognized or missing record type: ${typeToken ?? '(none)'}`,
        raw: rawLine,
      });
      continue;
    }

    const type = typeToken.toUpperCase() as RecordType;
    const data = tokens.slice(idx).join(' ');

    if (data.length === 0) {
      errors.push({
        line: lineNumber,
        message: `${type} record is missing its data field`,
        raw: rawLine,
      });
      continue;
    }

    records.push({ line: lineNumber, name, ttl, recordClass, type, data });
  }

  return { records, errors };
}
