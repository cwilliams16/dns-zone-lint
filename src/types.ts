export type RecordType =
  | 'A'
  | 'AAAA'
  | 'CNAME'
  | 'MX'
  | 'NS'
  | 'TXT'
  | 'PTR'
  | 'SRV'
  | 'SOA'
  | 'CAA';

export interface ParsedRecord {
  line: number;
  name: string;
  ttl: number | null;
  recordClass: string;
  type: RecordType;
  data: string;
}

export interface ParseError {
  line: number;
  message: string;
  raw: string;
}

export interface ParseResult {
  records: ParsedRecord[];
  errors: ParseError[];
}
