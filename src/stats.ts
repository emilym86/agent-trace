import { pairToolEvents } from './pair.ts';
import type { TraceEvent } from './types.ts';

export interface ToolStats {
  name: string;
  calls: number;
  failures: number;
  totalMs: number;
  avgMs: number;
  maxMs: number;
  timeShare: number;
}

export interface EventCounts {
  user: number;
  assistant: number;
  tool_call: number;
  tool_result: number;
}

export interface TraceStats {
  totalEvents: number;
  eventCounts: EventCounts;
  wallClockMs?: number;
  toolTimeMs: number;
  toolCalls: number;
  completedCalls: number;
  pendingCalls: number;
  failedCalls: number;
  failureRate: number;
  tools: ToolStats[];
  orphanResults: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface ToolAccumulator {
  calls: number;
  completed: number;
  failures: number;
  totalMs: number;
  maxMs: number;
}

export function computeStats(events: TraceEvent[]): TraceStats {
  const eventCounts: EventCounts = { user: 0, assistant: 0, tool_call: 0, tool_result: 0 };
  let inputTokens = 0;
  let outputTokens = 0;
  let minTs: number | undefined;
  let maxTs: number | undefined;

  for (const event of events) {
    eventCounts[event.type]++;
    if (event.ts !== undefined) {
      minTs = minTs === undefined ? event.ts : Math.min(minTs, event.ts);
      maxTs = maxTs === undefined ? event.ts : Math.max(maxTs, event.ts);
    }
    if (event.type === 'assistant' && event.usage !== undefined) {
      inputTokens += event.usage.inputTokens ?? 0;
      outputTokens += event.usage.outputTokens ?? 0;
    }
  }

  const { spans, orphans } = pairToolEvents(events);

  const byName = new Map<string, ToolAccumulator>();
  let toolTimeMs = 0;
  let completedCalls = 0;
  let failedCalls = 0;

  for (const span of spans) {
    const acc = byName.get(span.name) ?? { calls: 0, completed: 0, failures: 0, totalMs: 0, maxMs: 0 };
    acc.calls++;
    if (span.durationMs !== undefined) {
      acc.completed++;
      acc.totalMs += span.durationMs;
      acc.maxMs = Math.max(acc.maxMs, span.durationMs);
      toolTimeMs += span.durationMs;
      completedCalls++;
    }
    if (span.ok === false) {
      acc.failures++;
      failedCalls++;
    }
    byName.set(span.name, acc);
  }

  const tools: ToolStats[] = [...byName.entries()]
    .map(([name, acc]) => ({
      name,
      calls: acc.calls,
      failures: acc.failures,
      totalMs: acc.totalMs,
      avgMs: acc.completed > 0 ? acc.totalMs / acc.completed : 0,
      maxMs: acc.maxMs,
      timeShare: toolTimeMs > 0 ? acc.totalMs / toolTimeMs : 0,
    }))
    .sort((a, b) => b.totalMs - a.totalMs);

  const toolCalls = spans.length;

  return {
    totalEvents: events.length,
    eventCounts,
    wallClockMs: minTs !== undefined && maxTs !== undefined ? maxTs - minTs : undefined,
    toolTimeMs,
    toolCalls,
    completedCalls,
    pendingCalls: toolCalls - completedCalls,
    failedCalls,
    failureRate: toolCalls > 0 ? failedCalls / toolCalls : 0,
    tools,
    orphanResults: orphans.length,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}
