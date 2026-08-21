#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseZoneFile } from './parser.js';

interface Source {
  label: string;
  text: string;
}

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8');
  } catch (err) {
    throw new Error(`failed to read from stdin: ${(err as Error).message}`);
  }
}

function collectSources(args: string[]): Source[] {
  if (args.length === 0) {
    return [{ label: 'stdin', text: readStdin() }];
  }
  return args.map((arg) => {
    if (arg === '-') {
      return { label: 'stdin', text: readStdin() };
    }
    return { label: arg, text: readFileSync(arg, 'utf8') };
  });
}

function printUsage(): void {
  console.log(`dns-zone-lint - parse and validate BIND-style DNS zone files

Usage:
  dns-zone-lint [file ...]
  cat zone.txt | dns-zone-lint

Reads one or more zone files, or standard input if no files are given.
Pass "-" as a file argument to read stdin at that position, which lets you
mix piped input with files on the same command line.

Prints a JSON report per source with parsed records, any syntax errors, and
any data warnings (bad IP addresses, out-of-range numeric fields, etc.).
Exits with status 1 if any source contained errors; warnings alone do not
affect the exit code.`);
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  let sources: Source[];
  try {
    sources = collectSources(args);
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
    return;
  }

  const report = sources.map((source) => {
    const result = parseZoneFile(source.text);
    return {
      source: source.label,
      records: result.records,
      errors: result.errors,
      warnings: result.warnings,
    };
  });

  console.log(JSON.stringify(report, null, 2));

  if (report.some((entry) => entry.errors.length > 0)) {
    process.exitCode = 1;
  }
}

main();
