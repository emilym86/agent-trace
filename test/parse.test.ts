import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseTrace, parseTraceLine, parseTraceStrict } from '../src/parse.ts';

test('parses a user event', () => {
  const result = parseTraceLine('{"type":"user","ts":100,"text":"hi"}');
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.event, { type: 'user', ts: 100, text: 'hi' });
});

test('parses an assistant event with token usage', () => {
  const line = '{"type":"assistant","ts":200,"text":"ok","usage":{"input_tokens":10,"output_tokens":5}}';
  const result = parseTraceLine(line);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.ok && result.event,
    { type: 'assistant', ts: 200, text: 'ok', usage: { inputTokens: 10, outputTokens: 5 } },
  );
});

test('parses a tool_call event', () => {
  const line = '{"type":"tool_call","ts":300,"id":"c1","name":"read_file","args":{"path":"a.ts"}}';
  const result = parseTraceLine(line);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.ok && result.event,
    { type: 'tool_call', ts: 300, id: 'c1', name: 'read_file', args: { path: 'a.ts' } },
  );
});

test('parses a tool_result event', () => {
  const line = '{"type":"tool_result","ts":354,"id":"c1","ok":true,"durationMs":54,"output":"1.9 kB read"}';
  const result = parseTraceLine(line);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.ok && result.event,
    { type: 'tool_result', ts: 354, id: 'c1', ok: true, durationMs: 54, output: '1.9 kB read' },
  );
});

test('accepts alternate field names', () => {
  const line = '{"role":"tool_call","timestamp":42,"tool":"run_tests","arguments":{"suite":"unit"}}';
  const result = parseTraceLine(line);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.ok && result.event,
    { type: 'tool_call', ts: 42, id: undefined, name: 'run_tests', args: { suite: 'unit' } },
  );
});

test('reports invalid JSON with the line number', () => {
  const result = parseTraceLine('not json', 7);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.issue.line, 7);
  assert.match(!result.ok ? result.issue.message : '', /invalid JSON/);
});

test('reports a missing type field', () => {
  const result = parseTraceLine('{"ts":1,"text":"hi"}');
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.issue.message : '', /missing "type"/);
});

test('reports an unknown type value', () => {
  const result = parseTraceLine('{"type":"system_prompt","ts":1}');
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.issue.message : '', /unknown event type/);
});

test('reports a tool_call missing its name', () => {
  const result = parseTraceLine('{"type":"tool_call","ts":1}');
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.issue.message : '', /missing "name"/);
});

test('parseTrace skips blank lines and collects issues by line number', () => {
  const text = [
    '{"type":"user","ts":1,"text":"hi"}',
    '',
    'garbage',
    '{"type":"assistant","ts":2,"text":"ok"}',
    '   ',
  ].join('\n');

  const { events, issues } = parseTrace(text);
  assert.equal(events.length, 2);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].line, 3);
});

test('parseTraceStrict returns events for a clean trace', () => {
  const text = '{"type":"user","ts":1,"text":"hi"}\n{"type":"assistant","ts":2,"text":"ok"}';
  const events = parseTraceStrict(text);
  assert.equal(events.length, 2);
});

test('parseTraceStrict throws when any line is unusable', () => {
  const text = '{"type":"user","ts":1,"text":"hi"}\ngarbage';
  assert.throws(() => parseTraceStrict(text), /unusable line/);
});
