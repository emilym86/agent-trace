import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeStats } from '../src/stats.ts';
import type { TraceEvent } from '../src/types.ts';

test('counts events by type and wall clock spans the first and last timestamp', () => {
  const events: TraceEvent[] = [
    { type: 'user', ts: 1000, text: 'hi' },
    { type: 'assistant', ts: 1200, text: 'ok' },
    { type: 'tool_call', ts: 1300, id: 'c1', name: 'read_file' },
    { type: 'tool_result', ts: 1350, id: 'c1', ok: true },
  ];
  const stats = computeStats(events);
  assert.equal(stats.totalEvents, 4);
  assert.deepEqual(stats.eventCounts, { user: 1, assistant: 1, tool_call: 1, tool_result: 1 });
  assert.equal(stats.wallClockMs, 350);
});

test('wall clock is undefined when no event carries a timestamp', () => {
  const events: TraceEvent[] = [{ type: 'user', text: 'hi' }];
  assert.equal(computeStats(events).wallClockMs, undefined);
});

test('aggregates per-tool timing, failures and time share', () => {
  const events: TraceEvent[] = [
    { type: 'tool_call', ts: 0, id: 'a1', name: 'run_tests' },
    { type: 'tool_result', ts: 90, id: 'a1', ok: false },
    { type: 'tool_call', ts: 100, id: 'a2', name: 'run_tests' },
    { type: 'tool_result', ts: 110, id: 'a2', ok: true },
    { type: 'tool_call', ts: 200, id: 'b1', name: 'read_file' },
    { type: 'tool_result', ts: 210, id: 'b1', ok: true },
  ];
  const stats = computeStats(events);

  assert.equal(stats.toolTimeMs, 110);
  assert.equal(stats.toolCalls, 3);
  assert.equal(stats.completedCalls, 3);
  assert.equal(stats.pendingCalls, 0);
  assert.equal(stats.failedCalls, 1);
  assert.equal(stats.failureRate, 1 / 3);

  assert.equal(stats.tools.length, 2);
  const runTests = stats.tools.find((t) => t.name === 'run_tests');
  assert.deepEqual(runTests, {
    name: 'run_tests',
    calls: 2,
    failures: 1,
    totalMs: 100,
    avgMs: 50,
    maxMs: 90,
    timeShare: 100 / 110,
  });
  // busiest tool sorts first
  assert.equal(stats.tools[0].name, 'run_tests');
});

test('a call still waiting for its result counts as pending, not completed', () => {
  const events: TraceEvent[] = [{ type: 'tool_call', ts: 0, id: 'a1', name: 'run_tests' }];
  const stats = computeStats(events);
  assert.equal(stats.toolCalls, 1);
  assert.equal(stats.completedCalls, 0);
  assert.equal(stats.pendingCalls, 1);
  assert.equal(stats.toolTimeMs, 0);
  assert.equal(stats.tools[0].avgMs, 0);
});

test('an unmatched result is counted as an orphan and does not affect tool stats', () => {
  const events: TraceEvent[] = [{ type: 'tool_result', ts: 0, id: 'ghost', ok: true }];
  const stats = computeStats(events);
  assert.equal(stats.orphanResults, 1);
  assert.equal(stats.toolCalls, 0);
  assert.equal(stats.tools.length, 0);
});

test('sums token usage across assistant events, treating missing usage as zero', () => {
  const events: TraceEvent[] = [
    { type: 'assistant', ts: 0, usage: { inputTokens: 100, outputTokens: 10 } },
    { type: 'assistant', ts: 1, text: 'no usage reported' },
    { type: 'assistant', ts: 2, usage: { inputTokens: 50 } },
  ];
  const stats = computeStats(events);
  assert.equal(stats.inputTokens, 150);
  assert.equal(stats.outputTokens, 10);
  assert.equal(stats.totalTokens, 160);
});
