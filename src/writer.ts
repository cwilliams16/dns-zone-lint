import type { ParsedRecord } from './types.js';

// Renders parsed records back into zone syntax, one RR per line. Names and
// embedded domain names in each record are already fully qualified by the
// parser, so the output doesn't depend on $ORIGIN and stands on its own even
// when records came from sources with different origins. TTL is only
// written when the parser resolved one (from an explicit value or $TTL); a
// record with no TTL of either kind is left without one, the same as it
// appeared in the source.
export function formatZone(records: ParsedRecord[]): string {
  return records
    .map((record) => {
      const fields = [record.name];
      if (record.ttl !== null) {
        fields.push(String(record.ttl));
      }
      fields.push(record.recordClass, record.type, record.data);
      return fields.join(' ');
    })
    .join('\n');
}
