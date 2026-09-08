#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseZoneFile } from './parser.js';
import { formatZone } from './writer.js';
import type { ParseError } from './types.js';

interface Source {
  label: string;
  text: string;
}

function formatIssue(label: string, kind: string, issue: ParseError): string {
  return `${label}:${issue.line}: ${kind}: ${issue.message}`;
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
  dns-zone-lint [--strict] [--format=json|zone] [file ...]
  cat zone.txt | dns-zone-lint

Reads one or more zone files, or standard input if no files are given.
Pass "-" as a file argument to read stdin at that position, which lets you
mix piped input with files on the same command line.

By default, prints a JSON report per source with parsed records, any
syntax errors, and any data warnings (bad IP addresses, out-of-range
numeric fields, etc.). Exits with status 1 if any source contained errors;
warnings alone do not affect the exit code unless --strict is given, in
which case warnings are treated the same as errors.

Pass --format=zone to print the parsed records back out as zone syntax
instead of JSON, one record per line with names and embedded domain names
fully qualified. Errors and warnings go to stderr as "label:line: message"
instead of being embedded in the output.`);
}

function main(): void {
  const rawArgs = process.argv.slice(2);

  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    printUsage();
    return;
  }

  const strict = rawArgs.includes('--strict');
  const args: string[] = [];
  let format: 'json' | 'zone' = 'json';

  for (const arg of rawArgs) {
    if (arg === '--strict') continue;
    if (arg.startsWith('--format=')) {
      const value = arg.slice('--format='.length);
      if (value !== 'json' && value !== 'zone') {
        console.error(`unrecognized --format value: ${value} (expected "json" or "zone")`);
        process.exitCode = 1;
        return;
      }
      format = value;
      continue;
    }
    args.push(arg);
  }

  let sources: Source[];
  try {
    sources = collectSources(args);
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
    return;
  }

  const results = sources.map((source) => ({ source, result: parseZoneFile(source.text) }));
  const hasErrors = results.some(({ result }) => result.errors.length > 0);
  const hasWarnings = results.some(({ result }) => result.warnings.length > 0);

  if (format === 'zone') {
    for (const { source, result } of results) {
      for (const error of result.errors) {
        console.error(formatIssue(source.label, 'error', error));
      }
      for (const warning of result.warnings) {
        console.error(formatIssue(source.label, 'warning', warning));
      }
      if (sources.length > 1) {
        console.log(`; source: ${source.label}`);
      }
      console.log(formatZone(result.records));
    }
  } else {
    const report = results.map(({ source, result }) => ({
      source: source.label,
      records: result.records,
      errors: result.errors,
      warnings: result.warnings,
    }));
    console.log(JSON.stringify(report, null, 2));
  }

  if (hasErrors || (strict && hasWarnings)) {
    process.exitCode = 1;
  }
}

main();
