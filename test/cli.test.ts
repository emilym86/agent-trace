import assert from 'node:assert/strict';
import { test } from 'node:test';
import { run, type CliIO } from '../src/cli.ts';

const SESSION = [
  '{"type":"user","ts":0,"text":"hi"}',
  '{"type":"tool_call","ts":10,"id":"c1","name":"read_file","args":{"path":"a.ts"}}',
  '{"type":"tool_result","ts":60,"id":"c1","ok":true,"durationMs":50}',
].join('\n');

function fakeIO(files: Record<string, string> = {}): { io: CliIO; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: CliIO = {
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
    readInput: (path) => {
      if (!(path in files)) throw new Error(`no such file: ${path}`);
      return files[path];
    },
  };
  return { io, stdout, stderr };
}

test('stats prints a table and exits 0', () => {
  const { io, stdout } = fakeIO({ 'session.jsonl': SESSION });
  const code = run(['stats', 'session.jsonl'], io);
  assert.equal(code, 0);
  assert.equal(stdout.length, 1);
  assert.match(stdout[0], /tool calls\s+1/);
});

test('stats --json prints parseable JSON with the computed totals', () => {
  const { io, stdout } = fakeIO({ 'session.jsonl': SESSION });
  const code = run(['stats', 'session.jsonl', '--json'], io);
  assert.equal(code, 0);
  const stats = JSON.parse(stdout[0]);
  assert.equal(stats.toolCalls, 1);
  assert.equal(stats.completedCalls, 1);
});

test('show prints a timeline line per event', () => {
  const { io, stdout } = fakeIO({ 'session.jsonl': SESSION });
  const code = run(['show', 'session.jsonl'], io);
  assert.equal(code, 0);
  const lines = stdout[0].split('\n');
  assert.equal(lines.length, 3);
});

test('show --tool filters to a single tool', () => {
  const { io, stdout } = fakeIO({
    'session.jsonl': [
      '{"type":"tool_call","ts":0,"id":"a","name":"run_tests"}',
      '{"type":"tool_result","ts":5,"id":"a","ok":true}',
      '{"type":"tool_call","ts":10,"id":"b","name":"read_file"}',
      '{"type":"tool_result","ts":15,"id":"b","ok":true}',
    ].join('\n'),
  });
  const code = run(['show', 'session.jsonl', '--tool=run_tests'], io);
  assert.equal(code, 0);
  const lines = stdout[0].split('\n');
  assert.equal(lines.length, 2);
  assert.ok(lines.every((line) => line.includes('run_tests')));
});

test('missing command exits 2 with usage on stderr', () => {
  const { io, stderr } = fakeIO();
  const code = run([], io);
  assert.equal(code, 2);
  assert.ok(stderr.some((line) => line.includes('missing command')));
});

test('unknown option exits 2', () => {
  const { io, stderr } = fakeIO({ 'session.jsonl': SESSION });
  const code = run(['stats', 'session.jsonl', '--bogus'], io);
  assert.equal(code, 2);
  assert.ok(stderr.some((line) => line.includes('unrecognized option')));
});

test('missing file exits 2 without touching the trace', () => {
  const { io, stderr } = fakeIO();
  const code = run(['stats', 'missing.jsonl'], io);
  assert.equal(code, 2);
  assert.ok(stderr.some((line) => line.includes('cannot read missing.jsonl')));
});

test('a trace with only bad lines exits 1', () => {
  const { io, stderr } = fakeIO({ 'bad.jsonl': 'not json\n{"type":"mystery"}' });
  const code = run(['stats', 'bad.jsonl'], io);
  assert.equal(code, 1);
  assert.ok(stderr.some((line) => line.includes('no usable events')));
});

test('--strict exits 1 when any line failed to parse, even with usable events', () => {
  const { io, stdout } = fakeIO({ 'mixed.jsonl': `${SESSION}\nnot json` });
  const code = run(['stats', 'mixed.jsonl', '--strict'], io);
  assert.equal(code, 1);
  assert.equal(stdout.length, 0);
});

test('without --strict, bad lines are reported but do not fail the run', () => {
  const { io, stdout, stderr } = fakeIO({ 'mixed.jsonl': `${SESSION}\nnot json` });
  const code = run(['stats', 'mixed.jsonl'], io);
  assert.equal(code, 0);
  assert.equal(stdout.length, 1);
  assert.ok(stderr.some((line) => line.includes('skipped 1 unusable line')));
});

test('--help exits 0 and prints usage', () => {
  const { io, stdout } = fakeIO();
  const code = run(['--help'], io);
  assert.equal(code, 0);
  assert.ok(stdout[0].startsWith('usage:'));
});

test('--version exits 0 and prints a semver-looking string', () => {
  const { io, stdout } = fakeIO();
  const code = run(['--version'], io);
  assert.equal(code, 0);
  assert.match(stdout[0], /^\d+\.\d+\.\d+$/);
});
