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

// Parses a single BIND-style master file. This is a simplified reading of
// RFC 1035 section 5: it does not expand $ORIGIN into relative names and it
// does not follow parenthesized records across multiple lines yet, so a SOA
// record spanning several lines will come through as several parse errors.
export function parseZoneFile(text: string): ParseResult {
  const records: ParsedRecord[] = [];
  const errors: ParseError[] = [];

  let defaultTTL: number | null = null;
  let lastName: string | null = null;

  const rawLines = text.split(/\r\n|\n/);

  for (let i = 0; i < rawLines.length; i++) {
    const lineNumber = i + 1;
    const rawLine = rawLines[i];
    const withoutComment = stripComment(rawLine);

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
      }
      // $ORIGIN and other directives are accepted but not yet acted on.
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
      name = tokens[idx++];
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
