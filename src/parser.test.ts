import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseZoneFile } from './parser.js';

describe('basic records', () => {
  test('parses a simple A record with an explicit TTL and class', () => {
    const result = parseZoneFile('www 3600 IN A 203.0.113.10\n');
    assert.equal(result.errors.length, 0);
    assert.deepEqual(result.records, [
      { line: 1, name: 'www', ttl: 3600, recordClass: 'IN', type: 'A', data: '203.0.113.10' },
    ]);
  });

  test('TTL and class can appear in either order', () => {
    const result = parseZoneFile('www IN 3600 A 203.0.113.10\n');
    assert.equal(result.errors.length, 0);
    assert.equal(result.records[0].ttl, 3600);
    assert.equal(result.records[0].recordClass, 'IN');
  });

  test('$TTL sets the default TTL for records that omit one', () => {
    const result = parseZoneFile('$TTL 1800\nwww IN A 203.0.113.10\n');
    assert.equal(result.records[0].ttl, 1800);
  });

  test('a blank-name line inherits the owner name of the previous record', () => {
    const result = parseZoneFile('mail IN MX 10 mx1.example.com.\n    IN TXT "v=spf1 -all"\n');
    assert.equal(result.errors.length, 0);
    assert.equal(result.records[1].name, 'mail');
  });

  test('a blank-name line with no prior record is an error, not a crash', () => {
    const result = parseZoneFile('    IN A 203.0.113.10\n');
    assert.equal(result.records.length, 0);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].message, /no prior record/);
  });

  test('an unrecognized record type is an error', () => {
    const result = parseZoneFile('www IN BOGUS somedata\n');
    assert.equal(result.records.length, 0);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].message, /unrecognized or missing record type/);
  });

  test('a record with no data field is an error', () => {
    const result = parseZoneFile('www IN A\n');
    assert.equal(result.records.length, 0);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].message, /missing its data field/);
  });

  test('a semicolon comment is stripped, but not one inside quotes', () => {
    const result = parseZoneFile('www IN A 203.0.113.10 ; the web server\ntxt IN TXT "a;b"\n');
    assert.equal(result.records[0].data, '203.0.113.10');
    assert.equal(result.records[1].data, '"a;b"');
  });
});

describe('$ORIGIN and owner name expansion', () => {
  test('a relative owner name gets the current origin appended', () => {
    const result = parseZoneFile('$ORIGIN example.com.\nwww IN A 203.0.113.10\n');
    assert.equal(result.records[0].name, 'www.example.com.');
  });

  test('@ expands to the origin itself', () => {
    const result = parseZoneFile('$ORIGIN example.com.\n@ IN A 203.0.113.10\n');
    assert.equal(result.records[0].name, 'example.com.');
  });

  test('a name already ending in "." is left alone', () => {
    const result = parseZoneFile('$ORIGIN example.com.\nwww.other.net. IN A 203.0.113.10\n');
    assert.equal(result.records[0].name, 'www.other.net.');
  });

  test('a relative $ORIGIN value is resolved against the previous origin', () => {
    const result = parseZoneFile('$ORIGIN example.com.\n$ORIGIN sub\nwww IN A 203.0.113.10\n');
    assert.equal(result.errors.length, 0);
    assert.equal(result.records[0].name, 'www.sub.example.com.');
  });

  test('a relative $ORIGIN before any origin is set is an error', () => {
    const result = parseZoneFile('$ORIGIN sub\nwww IN A 203.0.113.10\n');
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].message, /fully qualified/);
  });
});

describe('parenthesized multi-line records', () => {
  test('an SOA spread across lines is joined into one record at its start line', () => {
    const zone = [
      '@ IN SOA ns1.example.com. hostmaster.example.com. (',
      '    2026081901 ; serial',
      '    7200       ; refresh',
      '    3600       ; retry',
      '    1209600    ; expire',
      '    3600 )     ; minimum',
      'www IN A 203.0.113.10',
    ].join('\n');
    const result = parseZoneFile(zone);
    assert.equal(result.errors.length, 0);
    assert.equal(result.records[0].type, 'SOA');
    assert.equal(result.records[0].line, 1);
    assert.equal(result.records[0].data, 'ns1.example.com. hostmaster.example.com. 2026081901 7200 3600 1209600 3600');
    assert.equal(result.records[1].line, 7);
  });

  test('unbalanced parentheses produce an error instead of hanging', () => {
    const result = parseZoneFile('@ IN SOA ns1.example.com. hostmaster.example.com. (\n2026081901\n');
    assert.equal(result.records.length, 0);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].message, /unbalanced parentheses/);
  });

  test('an unmatched closing paren produces an error', () => {
    const result = parseZoneFile('www IN A 203.0.113.10 )\n');
    assert.equal(result.records.length, 0);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].message, /unbalanced parentheses/);
  });
});

describe('record data validation', () => {
  test('a malformed A address is a warning, and the record is still reported', () => {
    const result = parseZoneFile('www IN A not-an-ip\n');
    assert.equal(result.errors.length, 0);
    assert.equal(result.records.length, 1);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0].message, /not a valid IPv4 address/);
  });

  test('a valid AAAA address produces no warning', () => {
    const result = parseZoneFile('www IN AAAA 2001:db8::1\n');
    assert.equal(result.warnings.length, 0);
  });

  test('an MX preference that is not a 16-bit number is a warning', () => {
    const result = parseZoneFile('mail IN MX 99999 mx1.example.com.\n');
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0].message, /preference is not a valid 16-bit number/);
  });

  test('an SRV record with an out-of-range port is a warning', () => {
    const result = parseZoneFile('_sip._tcp IN SRV 10 20 99999 sip.example.com.\n');
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0].message, /port is not a valid 16-bit number/);
  });

  test('a CAA record with a non-numeric flag is a warning', () => {
    const result = parseZoneFile('@ IN CAA x issue "letsencrypt.org"\n');
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0].message, /flag is not a valid 8-bit number/);
  });

  test('an SOA record with a non-numeric field names which one is wrong', () => {
    const result = parseZoneFile('@ IN SOA ns1.example.com. hostmaster.example.com. 1 2 x 4 5\n');
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0].message, /SOA retry is not a valid number/);
  });
});
