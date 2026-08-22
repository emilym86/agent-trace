import type { TraceEvent } from './types.ts';

export interface ToolSpan {
  id?: string;
  name: string;
  callTs?: number;
  args?: unknown;
  resultTs?: number;
  durationMs?: number;
  ok?: boolean;
  output?: unknown;
}

export interface OrphanResult {
  id?: string;
  ts?: number;
  ok?: boolean;
  durationMs?: number;
  output?: unknown;
}

// A tool_result without an id is matched to the oldest call still waiting for
// a result -- that's what a sequential agent (no concurrent calls) produces.
// A tool_result with an id is matched by id regardless of position. Either
// way, a span stays in `spans` even if no result ever arrives for it, so a
// hung call shows up as a pending span instead of silently disappearing.
export function pairToolEvents(events: TraceEvent[]): { spans: ToolSpan[]; orphans: OrphanResult[] } {
  const spans: ToolSpan[] = [];
  const open: ToolSpan[] = [];
  const orphans: OrphanResult[] = [];

  for (const event of events) {
    if (event.type === 'tool_call') {
      const span: ToolSpan = { id: event.id, name: event.name, callTs: event.ts, args: event.args };
      spans.push(span);
      open.push(span);
      continue;
    }

    if (event.type !== 'tool_result') continue;

    let span: ToolSpan | undefined;
    if (event.id !== undefined) {
      const index = open.findIndex((candidate) => candidate.id === event.id);
      if (index !== -1) span = open.splice(index, 1)[0];
    } else {
      span = open.shift();
    }

    if (span === undefined) {
      orphans.push({ id: event.id, ts: event.ts, ok: event.ok, durationMs: event.durationMs, output: event.output });
      continue;
    }

    span.resultTs = event.ts;
    span.ok = event.ok;
    span.output = event.output;
    span.durationMs =
      event.durationMs ??
      (span.callTs !== undefined && event.ts !== undefined ? event.ts - span.callTs : undefined);
  }

  return { spans, orphans };
}
