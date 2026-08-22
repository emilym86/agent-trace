import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pairToolEvents } from '../src/pair.ts';
import type { TraceEvent } from '../src/types.ts';

test('matches a result to its call by id', () => {
  const events: TraceEvent[] = [
    { type: 'tool_call', ts: 100, id: 'c1', name: 'read_file', args: { path: 'a.ts' } },
    { type: 'tool_result', ts: 154, id: 'c1', ok: true, output: 'done' },
  ];
  const { spans, orphans } = pairToolEvents(events);
  assert.equal(orphans.length, 0);
  assert.equal(spans.length, 1);
  assert.deepEqual(spans[0], {
    id: 'c1',
    name: 'read_file',
    callTs: 100,
    args: { path: 'a.ts' },
    resultTs: 154,
    ok: true,
    output: 'done',
    durationMs: 54,
  });
});

test('prefers an explicit durationMs over the timestamp delta', () => {
  const events: TraceEvent[] = [
    { type: 'tool_call', ts: 100, id: 'c1', name: 'read_file' },
    { type: 'tool_result', ts: 200, id: 'c1', ok: true, durationMs: 40 },
  ];
  const { spans } = pairToolEvents(events);
  assert.equal(spans[0].durationMs, 40);
});

test('matches an id-less result to the oldest still-open call', () => {
  const events: TraceEvent[] = [
    { type: 'tool_call', ts: 1, name: 'a' },
    { type: 'tool_call', ts: 2, name: 'b' },
    { type: 'tool_result', ts: 3, ok: true },
    { type: 'tool_result', ts: 4, ok: false },
  ];
  const { spans, orphans } = pairToolEvents(events);
  assert.equal(orphans.length, 0);
  assert.equal(spans[0].name, 'a');
  assert.equal(spans[0].ok, true);
  assert.equal(spans[1].name, 'b');
  assert.equal(spans[1].ok, false);
});

test('a call is a still-open candidate for id-less matching even if it has an id', () => {
  const events: TraceEvent[] = [
    { type: 'tool_call', ts: 1, id: 'c1', name: 'a' },
    { type: 'tool_result', ts: 2, ok: true },
  ];
  const { spans, orphans } = pairToolEvents(events);
  assert.equal(orphans.length, 0);
  assert.equal(spans[0].ok, true);
});

test('a result whose id matches nothing is an orphan, not attached to an unrelated call', () => {
  const events: TraceEvent[] = [
    { type: 'tool_call', ts: 1, name: 'a' },
    { type: 'tool_result', ts: 2, id: 'unknown', ok: true },
  ];
  const { spans, orphans } = pairToolEvents(events);
  assert.equal(spans[0].ok, undefined);
  assert.equal(spans[0].durationMs, undefined);
  assert.equal(orphans.length, 1);
  assert.equal(orphans[0].id, 'unknown');
});

test('a call with no result yet is left in spans without result fields', () => {
  const events: TraceEvent[] = [{ type: 'tool_call', ts: 1, name: 'run_tests' }];
  const { spans, orphans } = pairToolEvents(events);
  assert.equal(orphans.length, 0);
  assert.equal(spans.length, 1);
  assert.equal(spans[0].ok, undefined);
  assert.equal(spans[0].durationMs, undefined);
});
