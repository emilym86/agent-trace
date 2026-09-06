import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderStats, renderTimeline } from '../src/render.ts';
import { computeStats } from '../src/stats.ts';
import type { TraceEvent } from '../src/types.ts';

const SESSION: TraceEvent[] = [
  { type: 'user', ts: 1767225600000, text: 'the parse test fails on windows' },
  { type: 'assistant', ts: 1767225600900, text: 'let me look', usage: { inputTokens: 1180, outputTokens: 96 } },
  { type: 'tool_call', ts: 1767225600950, id: 'c1', name: 'read_file', args: { path: 'src/parse.ts' } },
  { type: 'tool_result', ts: 1767225601004, id: 'c1', ok: true, durationMs: 54, output: '1.9 kB read' },
];

test('renderTimeline renders every event in order with padded type labels', () => {
  const output = renderTimeline(SESSION);
  const lines = output.split('\n');
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^\d\d:\d\d:\d\d\.\d\d\d {2}user {9}the parse test fails on windows$/);
  assert.match(lines[2], /^\d\d:\d\d:\d\d\.\d\d\d {2}tool_call {4}read_file {2}\{"path":"src\/parse\.ts"\}$/);
  assert.match(lines[3], /^\d\d:\d\d:\d\d\.\d\d\d {2}tool_result {2}read_file {2}ok {2}54ms {2}1\.9 kB read$/);
});

test('renderTimeline --tool filters to matching calls and their results, dropping text', () => {
  const events: TraceEvent[] = [
    ...SESSION,
    { type: 'tool_call', ts: 1767225601100, id: 'c2', name: 'run_tests' },
    { type: 'tool_result', ts: 1767225601200, id: 'c2', ok: false },
  ];
  const output = renderTimeline(events, { tool: 'run_tests' });
  const lines = output.split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /tool_call {4}run_tests$/);
  assert.match(lines[1], /tool_result {2}run_tests {2}fail$/);
});

test('renderTimeline --no-text hides user and assistant lines only', () => {
  const output = renderTimeline(SESSION, { includeText: false });
  const lines = output.split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^\d\d:\d\d:\d\d\.\d\d\d {2}tool_call/);
  assert.match(lines[1], /^\d\d:\d\d:\d\d\.\d\d\d {2}tool_result/);
});

test('renderTimeline truncates long tool_call args to maxArgLength', () => {
  const events: TraceEvent[] = [
    { type: 'tool_call', ts: 0, id: 'c1', name: 'read_file', args: { path: 'a'.repeat(50) } },
  ];
  const output = renderTimeline(events, { maxArgLength: 10 });
  const args = output.split('  ').pop()!;
  assert.equal(args.length, 11);
  assert.ok(args.endsWith('…'));
});

test('renderTimeline resolves an id-less result to the oldest open call for filtering', () => {
  const events: TraceEvent[] = [
    { type: 'tool_call', ts: 0, name: 'a' },
    { type: 'tool_call', ts: 1, name: 'b' },
    { type: 'tool_result', ts: 2, ok: true },
    { type: 'tool_result', ts: 3, ok: true },
  ];
  const output = renderTimeline(events, { tool: 'a' });
  const lines = output.split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[1], /tool_result {2}a {2}ok$/);
});

test('renderStats formats the summary and per-tool table with aligned columns', () => {
  const events: TraceEvent[] = [
    { type: 'user', ts: 0 },
    { type: 'assistant', ts: 500, usage: { inputTokens: 1000, outputTokens: 200 } },
    { type: 'tool_call', ts: 1000, id: 'a1', name: 'run_tests' },
    { type: 'tool_result', ts: 2800, id: 'a1', ok: false, durationMs: 1800 },
    { type: 'tool_call', ts: 3000, id: 'a2', name: 'run_tests' },
    { type: 'tool_result', ts: 4700, id: 'a2', ok: true, durationMs: 1700 },
    { type: 'tool_call', ts: 5000, id: 'b1', name: 'apply_patch' },
    { type: 'tool_result', ts: 5060, id: 'b1', ok: true, durationMs: 60 },
    { type: 'tool_call', ts: 5100, id: 'b2', name: 'apply_patch' },
    { type: 'tool_result', ts: 5158, id: 'b2', ok: true, durationMs: 58 },
    { type: 'tool_call', ts: 5200, id: 'c1', name: 'read_file' },
    { type: 'tool_result', ts: 5254, id: 'c1', ok: true, durationMs: 54 },
    { type: 'tool_call', ts: 5300, id: 'c2', name: 'read_file' },
    { type: 'tool_result', ts: 5340, id: 'c2', ok: true, durationMs: 40 },
    { type: 'user', ts: 10000 },
  ];
  const output = renderStats(computeStats(events));
  const lines = output.split('\n');

  assert.equal(lines[0], 'events        15  (user 2, assistant 1, tool_call 6, tool_result 6)');
  assert.equal(lines[1], 'wall clock    10.000s');
  assert.equal(lines[2], 'tool time     3.712s  (37.1% of wall clock)');
  assert.equal(lines[3], 'tool calls    6  (6 completed, 0 pending, 1 failed = 16.7% failure rate)');
  assert.equal(lines[4], 'tokens        1000 in / 200 out = 1200 total');
  assert.equal(lines[5], '');
  assert.equal(lines[6], 'tool         calls  fail   total     avg     max  share');
  assert.equal(lines[7], 'run_tests        2     1  3.500s  1.750s  1.800s  94.3%');
  assert.equal(lines[8], 'apply_patch      2     0   118ms    59ms    60ms   3.2%');
  assert.equal(lines[9], 'read_file        2     0    94ms    47ms    54ms   2.5%');
});

test('renderStats omits the tool table when there are no tool calls', () => {
  const output = renderStats(computeStats([{ type: 'user', ts: 0, text: 'hi' }]));
  assert.ok(!output.includes('tool         calls'));
});

test('renderStats reports orphan results when present', () => {
  const output = renderStats(computeStats([{ type: 'tool_result', ts: 0, id: 'ghost', ok: true }]));
  assert.ok(output.includes('orphans       1 tool_result event(s) with no matching call'));
});

test('renderStats omits the wall-clock share when no event carries a timestamp', () => {
  const output = renderStats(computeStats([{ type: 'user', text: 'hi' }]));
  assert.ok(output.split('\n').some((line) => line === 'tool time     0ms'));
});
