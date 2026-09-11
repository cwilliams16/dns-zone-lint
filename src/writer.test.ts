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

  describe('relative to an origin', () => {
    test('shortens the owner name and emits a leading $ORIGIN line', () => {
      const text = formatZone(
        [{ line: 1, name: 'www.example.com.', ttl: 300, recordClass: 'IN', type: 'A', data: '203.0.113.10' }],
        'example.com.',
      );
      assert.equal(text, '$ORIGIN example.com.\nwww 300 IN A 203.0.113.10');
    });

    test('renders the origin itself as @', () => {
      const text = formatZone(
        [{ line: 1, name: 'example.com.', ttl: 300, recordClass: 'IN', type: 'NS', data: 'ns1.example.com.' }],
        'example.com.',
      );
      assert.equal(text, '$ORIGIN example.com.\n@ 300 IN NS ns1');
    });

    test('leaves a name outside the origin fully qualified', () => {
      const text = formatZone(
        [{ line: 1, name: 'www.other.com.', ttl: 300, recordClass: 'IN', type: 'A', data: '203.0.113.10' }],
        'example.com.',
      );
      assert.equal(text, '$ORIGIN example.com.\nwww.other.com. 300 IN A 203.0.113.10');
    });

    test('shortens both SOA mname and rname', () => {
      const text = formatZone(
        [
          {
            line: 1,
            name: 'example.com.',
            ttl: 3600,
            recordClass: 'IN',
            type: 'SOA',
            data: 'ns1.example.com. hostmaster.example.com. 2026081901 7200 3600 1209600 3600',
          },
        ],
        'example.com.',
      );
      assert.equal(text, '$ORIGIN example.com.\n@ 3600 IN SOA ns1 hostmaster 2026081901 7200 3600 1209600 3600');
    });

    test('round-trips through the parser back to the same fully qualified records', () => {
      const original = parseZoneFile(
        '$TTL 3600\n$ORIGIN example.com.\nwww IN A 203.0.113.10\nmail IN MX 10 mail\n',
      );
      assert.equal(original.errors.length, 0);

      const reparsed = parseZoneFile(formatZone(original.records, original.origin));
      assert.equal(reparsed.errors.length, 0);

      const withoutLine = (records: typeof original.records) =>
        records.map(({ line, ...rest }) => rest);
      assert.deepEqual(withoutLine(reparsed.records), withoutLine(original.records));
    });
  });
});
