import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatZone } from './writer.js';
import { parseZoneFile } from './parser.js';

describe('formatZone', () => {
  test('renders a record with an explicit TTL as one line', () => {
    const text = formatZone([
      { line: 1, name: 'www.example.com.', ttl: 3600, recordClass: 'IN', type: 'A', data: '203.0.113.10' },
    ]);
    assert.equal(text, 'www.example.com. 3600 IN A 203.0.113.10');
  });

  test('omits the TTL field when a record has none', () => {
    const text = formatZone([
      { line: 1, name: 'www.example.com.', ttl: null, recordClass: 'IN', type: 'A', data: '203.0.113.10' },
    ]);
    assert.equal(text, 'www.example.com. IN A 203.0.113.10');
  });

  test('joins multiple records with one per line', () => {
    const text = formatZone([
      { line: 1, name: 'a.example.com.', ttl: 300, recordClass: 'IN', type: 'A', data: '203.0.113.10' },
      { line: 2, name: 'b.example.com.', ttl: 300, recordClass: 'IN', type: 'A', data: '203.0.113.11' },
    ]);
    assert.equal(text, 'a.example.com. 300 IN A 203.0.113.10\nb.example.com. 300 IN A 203.0.113.11');
  });

  test('an empty record list renders as an empty string', () => {
    assert.equal(formatZone([]), '');
  });

  test('round-trips through the parser: re-parsing the output yields equivalent records', () => {
    const original = parseZoneFile(
      '$TTL 3600\n$ORIGIN example.com.\nwww IN A 203.0.113.10\nmail IN MX 10 mail\n',
    );
    assert.equal(original.errors.length, 0);

    const reparsed = parseZoneFile(formatZone(original.records));
    assert.equal(reparsed.errors.length, 0);

    const withoutLine = (records: typeof original.records) =>
      records.map(({ line, ...rest }) => rest);
    assert.deepEqual(withoutLine(reparsed.records), withoutLine(original.records));
  });
});
