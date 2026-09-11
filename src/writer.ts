import type { ParsedRecord } from './types.js';

// Strips a trailing origin off a fully qualified name, the inverse of the
// parser's expandName. Only names actually under the origin get shortened;
// anything else (a name from a different origin, or one that never had a
// trailing '.') is left fully qualified rather than guessing.
function relativize(name: string, origin: string): string {
  if (name === origin) {
    return '@';
  }
  if (name.length > origin.length && name.endsWith(origin) && name[name.length - origin.length - 1] === '.') {
    return name.slice(0, name.length - origin.length - 1);
  }
  return name;
}

// CNAME/NS/PTR data is a single domain name; SOA's first two fields
// (mname, rname) are domain names followed by five plain numbers. Those are
// the only data shapes worth relativizing, the same set the parser expands
// against $ORIGIN on the way in.
function relativizeData(record: ParsedRecord, origin: string): string {
  if (record.type === 'CNAME' || record.type === 'NS' || record.type === 'PTR') {
    return relativize(record.data, origin);
  }
  if (record.type === 'SOA') {
    const tokens = record.data.split(' ');
    if (tokens.length === 7) {
      const [mname, rname, ...rest] = tokens;
      return [relativize(mname, origin), relativize(rname, origin), ...rest].join(' ');
    }
  }
  return record.data;
}

// Renders parsed records back into zone syntax, one RR per line. Names and
// embedded domain names in each record are already fully qualified by the
// parser, so the default (no origin passed) output doesn't depend on
// $ORIGIN and stands on its own even when records came from sources with
// different origins. TTL is only written when the parser resolved one (from
// an explicit value or $TTL); a record with no TTL of either kind is left
// without one, the same as it appeared in the source.
//
// Passing the origin the source itself ended on switches to the relative
// form instead: a leading $ORIGIN line is emitted, and names/data that fall
// under it are shortened, matching how the source likely looked before the
// parser expanded everything. Names outside that origin are left absolute.
export function formatZone(records: ParsedRecord[], origin: string | null = null): string {
  const lines: string[] = [];
  if (origin !== null) {
    lines.push(`$ORIGIN ${origin}`);
  }
  for (const record of records) {
    const fields = [origin !== null ? relativize(record.name, origin) : record.name];
    if (record.ttl !== null) {
      fields.push(String(record.ttl));
    }
    fields.push(record.recordClass, record.type, origin !== null ? relativizeData(record, origin) : record.data);
    lines.push(fields.join(' '));
  }
  return lines.join('\n');
}
