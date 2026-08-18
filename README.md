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
@       IN  SOA  ns1.example.com. hostmaster.example.com. 2026081901 7200 3600 1209600 3600
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
      { "line": 3, "name": "@", "ttl": 3600, "recordClass": "IN", "type": "NS", "data": "ns1.example.com." },
      { "line": 4, "name": "@", "ttl": 3600, "recordClass": "IN", "type": "A", "data": "203.0.113.10" },
      { "line": 5, "name": "www", "ttl": 3600, "recordClass": "IN", "type": "CNAME", "data": "@" },
      { "line": 6, "name": "mail", "ttl": 3600, "recordClass": "IN", "type": "MX", "data": "10 mail.example.com." },
      { "line": 7, "name": "mail", "ttl": 3600, "recordClass": "IN", "type": "TXT", "data": "\"v=spf1 -all\"" }
    ],
    "errors": [
      { "line": 2, "message": "SOA record is missing its data field", "raw": "..." }
    ]
  }
]
```

(The SOA line above errors in this version because it spans a single line
with more fields than the current parser expects to see on one line without
parentheses — see the note in the roadmap below.)

The tool exits with status 1 if any source produced errors, so it's usable
as a pre-commit or CI check on zone files kept in a repository.

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

It does not yet validate the *contents* of the data field (an A record with
`not-an-ip` as its address will parse fine today). See the roadmap.

## Why this exists

Most DNS tooling either wants a full resolver stack or is bundled into a
provider's CLI. This is meant to stay small enough to read in one sitting
and to be a debugging step you can drop into a shell pipeline.

## License

MIT, see LICENSE.
