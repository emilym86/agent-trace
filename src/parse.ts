import type {
  AssistantEvent,
  LineResult,
  ParseIssue,
  ToolCallEvent,
  ToolResultEvent,
  TraceEvent,
  UserEvent,
} from './types.ts';

const EVENT_TYPES = new Set(['user', 'assistant', 'tool_call', 'tool_result']);

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function issue(line: number, raw: string, message: string): ParseIssue {
  return { line, raw, message };
}

// Runtimes disagree on field names, so every field that carries the same
// meaning under two spellings is read with a fallback: ts/timestamp,
// name/tool, args/arguments, and the kind field itself as type/role.
export function parseTraceLine(raw: string, line = 0): LineResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, issue: issue(line, raw, `invalid JSON: ${message}`) };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, issue: issue(line, raw, 'line is not a JSON object') };
  }

  const record = parsed as Record<string, unknown>;
  const kind = asString(record.type) ?? asString(record.role);
  if (kind === undefined) {
    return { ok: false, issue: issue(line, raw, 'missing "type" (or "role") field') };
  }
  if (!EVENT_TYPES.has(kind)) {
    return { ok: false, issue: issue(line, raw, `unknown event type "${kind}"`) };
  }

  const ts = asNumber(record.ts) ?? asNumber(record.timestamp);

  if (kind === 'user') {
    const event: UserEvent = { type: 'user', ts, text: asString(record.text) };
    return { ok: true, event };
  }

  if (kind === 'assistant') {
    let usage: AssistantEvent['usage'];
    const usageRaw = record.usage;
    if (typeof usageRaw === 'object' && usageRaw !== null) {
      const u = usageRaw as Record<string, unknown>;
      const inputTokens = asNumber(u.input_tokens) ?? asNumber(u.inputTokens);
      const outputTokens = asNumber(u.output_tokens) ?? asNumber(u.outputTokens);
      if (inputTokens !== undefined || outputTokens !== undefined) {
        usage = { inputTokens, outputTokens };
      }
    }
    const event: AssistantEvent = { type: 'assistant', ts, text: asString(record.text), usage };
    return { ok: true, event };
  }

  if (kind === 'tool_call') {
    const name = asString(record.name) ?? asString(record.tool);
    if (name === undefined) {
      return { ok: false, issue: issue(line, raw, 'tool_call is missing "name" (or "tool")') };
    }
    const event: ToolCallEvent = {
      type: 'tool_call',
      ts,
      id: asString(record.id),
      name,
      args: record.args ?? record.arguments,
    };
    return { ok: true, event };
  }

  // kind === 'tool_result'
  const event: ToolResultEvent = {
    type: 'tool_result',
    ts,
    id: asString(record.id),
    ok: asBoolean(record.ok),
    durationMs: asNumber(record.durationMs),
    output: record.output,
  };
  return { ok: true, event };
}

export function parseTrace(text: string): { events: TraceEvent[]; issues: ParseIssue[] } {
  const events: TraceEvent[] = [];
  const issues: ParseIssue[] = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim().length === 0) continue;

    const result = parseTraceLine(raw, i + 1);
    if (result.ok) {
      events.push(result.event);
    } else {
      issues.push(result.issue);
    }
  }

  return { events, issues };
}

export function parseTraceStrict(text: string): TraceEvent[] {
  const { events, issues } = parseTrace(text);
  if (issues.length > 0) {
    const first = issues[0];
    throw new Error(
      `trace has ${issues.length} unusable line(s); first at line ${first.line}: ${first.message}`,
    );
  }
  return events;
}
