# dns-zone-lint

A command line tool that reads a BIND-style DNS zone file and turns it into
structured JSON: one object per resource record, plus a list of any lines it
couldn't make sense of. I wanted something I could pipe a zone file through
before pushing it to a nameserver, without spinning up `named-checkzone` or
trusting the DNS provider's web form to catch a typo'd record.

It reads from files given as arguments, or from stdin if none are given, so
it works equally well as `dns-zone-lint example.com.zone` or as the tail end
of a pipeline that generated the zone file on the fly.

## Usage

Build once:

```
npm install -D typescript
npm run build
```

Then run it against a file:

```
dist/index.js example.com.zone
```

Or pipe input in:

```
cat example.com.zone | dist/index.js
```

Given a zone file like:

```
$TTL 3600
@       IN  SOA  ns1.example.com. hostmaster.example.com. (
                 2026081901 ; serial
                 7200       ; refresh
                 3600       ; retry
                 1209600    ; expire
                 3600 )     ; minimum
@       IN  NS   ns1.example.com.
@       IN  A    203.0.113.10
www     IN  CNAME @
mail    IN  MX   10 mail.example.com.
        IN  TXT  "v=spf1 -all"
```

it prints something like:

```json
[
  {
    "source": "example.com.zone",
    "records": [
      { "line": 2, "name": "@", "ttl": 3600, "recordClass": "IN", "type": "SOA", "data": "ns1.example.com. hostmaster.example.com. 2026081901 7200 3600 1209600 3600" },
      { "line": 8, "name": "@", "ttl": 3600, "recordClass": "IN", "type": "NS", "data": "ns1.example.com." },
      { "line": 9, "name": "@", "ttl": 3600, "recordClass": "IN", "type": "A", "data": "203.0.113.10" },
      { "line": 10, "name": "www", "ttl": 3600, "recordClass": "IN", "type": "CNAME", "data": "@" },
      { "line": 11, "name": "mail", "ttl": 3600, "recordClass": "IN", "type": "MX", "data": "10 mail.example.com." },
      { "line": 12, "name": "mail", "ttl": 3600, "recordClass": "IN", "type": "TXT", "data": "\"v=spf1 -all\"" }
    ],
    "errors": [],
    "warnings": []
  }
]
```

The SOA record's `line` is the line the record started on, even though its
data was spread across six physical lines with parentheses.

The tool exits with status 1 if any source produced errors, so it's usable
as a pre-commit or CI check on zone files kept in a repository. Pass
`--strict` to also fail on warnings, for a CI setup where questionable data
(a malformed CAA value, an SOA serial that isn't a number) should block the
build rather than just get flagged:

```
dns-zone-lint --strict example.com.zone
```

You can also mix stdin with files by passing `-` as one of the arguments:

```
generate-zone | dns-zone-lint - existing.zone
```

## What it checks right now

- Line structure: name, optional TTL, optional class, record type, data
- Record type is one of the types this version knows about (A, AAAA, CNAME,
  MX, NS, TXT, PTR, SRV, SOA, CAA)
- A record isn't missing its data field
- A blank-name continuation line isn't the first line of a source
- Parentheses used to spread a record across multiple lines are balanced

Owner names are expanded against `$ORIGIN`: a relative name gets the current
origin appended, `@` is replaced with the origin itself, and a name already
ending in `.` is left alone. A `$ORIGIN` line whose own value is relative is
only accepted once an earlier `$ORIGIN` has established a base to expand it
against.

Records that parse structurally fine can still have data that doesn't match
their type; those show up as `warnings` rather than `errors`, since the
record itself is still reported. Checked so far:

- A: the data is a valid IPv4 address
- AAAA: the data is a valid IPv6 address
- MX: `<preference> <exchange>`, preference is a 16-bit number
- SRV: `<priority> <weight> <port> <target>`, all three numbers fit in 16 bits
- CAA: `<flag> <tag> <value>`, flag is an 8-bit number
- SOA: all five trailing numeric fields (serial, refresh, retry, expire,
  minimum) are present and fit in 32 bits

CNAME, NS, PTR, and TXT data isn't validated yet, and no record type has its
embedded domain names (an NS or CNAME target, an SOA's mname/rname) expanded
against `$ORIGIN` or checked for well-formedness. See the roadmap.

## Why this exists

Most DNS tooling either wants a full resolver stack or is bundled into a
provider's CLI. This is meant to stay small enough to read in one sitting
and to be a debugging step you can drop into a shell pipeline.

## License

MIT, see LICENSE.
