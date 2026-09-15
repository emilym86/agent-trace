#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseTrace } from './parse.ts';
import { computeStats } from './stats.ts';
import { renderStats, renderTimeline } from './render.ts';

const USAGE = `usage: agent-trace <command> <file> [options]

commands:
  stats <file>   totals, per-tool timing, token usage
  show <file>    indented timeline of the session

options:
  --json          print stats as JSON instead of a table (stats only)
  --tool=<name>   restrict show to a single tool
  --max-arg=<n>   truncate tool arguments to n characters (default 80)
  --no-text       hide user and assistant messages
  --strict        exit 1 if any line failed to parse
  -h, --help      usage
  --version       version

Pass - as <file> to read the trace from stdin.`;

interface Options {
  json: boolean;
  tool?: string;
  maxArg: number;
  text: boolean;
  strict: boolean;
}

function parseOptions(args: string[]): Options | { error: string } {
  const options: Options = { json: false, maxArg: 80, text: true, strict: false };
  for (const arg of args) {
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--no-text') {
      options.text = false;
    } else if (arg === '--strict') {
      options.strict = true;
    } else if (arg.startsWith('--tool=')) {
      options.tool = arg.slice('--tool='.length);
    } else if (arg.startsWith('--max-arg=')) {
      const raw = arg.slice('--max-arg='.length);
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) return { error: `invalid --max-arg value: ${raw}` };
      options.maxArg = n;
    } else {
      return { error: `unrecognized option: ${arg}` };
    }
  }
  return options;
}

export interface CliIO {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  readInput: (path: string) => string;
}

const defaultIO: CliIO = {
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
  readInput: (path) => (path === '-' ? readFileSync(0, 'utf8') : readFileSync(path, 'utf8')),
};

function readVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  };
  return pkg.version;
}

export function run(argv: string[], io: CliIO = defaultIO): number {
  if (argv.includes('-h') || argv.includes('--help')) {
    io.stdout(USAGE);
    return 0;
  }
  if (argv.includes('--version')) {
    io.stdout(readVersion());
    return 0;
  }

  const [command, file, ...rest] = argv;
  if (command !== 'stats' && command !== 'show') {
    io.stderr(command === undefined ? 'missing command' : `unknown command: ${command}`);
    io.stderr(USAGE);
    return 2;
  }
  if (file === undefined) {
    io.stderr('missing <file>');
    io.stderr(USAGE);
    return 2;
  }

  const options = parseOptions(rest);
  if ('error' in options) {
    io.stderr(options.error);
    io.stderr(USAGE);
    return 2;
  }

  let text: string;
  try {
    text = io.readInput(file);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.stderr(`cannot read ${file}: ${message}`);
    return 2;
  }

  const { events, issues } = parseTrace(text);

  if (options.strict && issues.length > 0) {
    for (const parseIssue of issues) io.stderr(`line ${parseIssue.line}: ${parseIssue.message}`);
    return 1;
  }

  if (events.length === 0) {
    io.stderr('no usable events in trace');
    for (const parseIssue of issues) io.stderr(`line ${parseIssue.line}: ${parseIssue.message}`);
    return 1;
  }

  if (command === 'stats') {
    const stats = computeStats(events);
    io.stdout(options.json ? JSON.stringify(stats, null, 2) : renderStats(stats));
  } else {
    io.stdout(renderTimeline(events, { tool: options.tool, maxArgLength: options.maxArg, includeText: options.text }));
  }

  if (issues.length > 0) {
    io.stderr(`skipped ${issues.length} unusable line(s); rerun with --strict to fail on them`);
  }

  return 0;
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  process.exit(run(process.argv.slice(2)));
}
