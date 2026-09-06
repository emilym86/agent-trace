import type { TraceEvent } from './types.ts';
import type { TraceStats, ToolStats } from './stats.ts';

export interface TimelineOptions {
  tool?: string;
  maxArgLength?: number;
  includeText?: boolean;
}

const TYPE_WIDTH = 'tool_result'.length;

function formatTimestamp(ts?: number): string {
  return ts === undefined ? '--:--:--.---' : new Date(ts).toISOString().slice(11, 23);
}

function formatValue(value: unknown): string {
  return value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

// tool_result carries no name of its own, so the name shown for --tool
// filtering and display is recovered by tracking open calls the same way
// pairToolEvents does: match by id, otherwise take the oldest open call.
export function renderTimeline(events: TraceEvent[], options: TimelineOptions = {}): string {
  const { tool, maxArgLength = 80, includeText = true } = options;
  const openCalls: { id?: string; name: string }[] = [];
  const lines: string[] = [];

  for (const event of events) {
    if (event.type === 'tool_call') {
      openCalls.push({ id: event.id, name: event.name });
      if (tool !== undefined && event.name !== tool) continue;
      const args = truncate(formatValue(event.args), maxArgLength);
      lines.push(
        `${formatTimestamp(event.ts)}  ${'tool_call'.padEnd(TYPE_WIDTH)}  ${event.name}${args ? `  ${args}` : ''}`,
      );
      continue;
    }

    if (event.type === 'tool_result') {
      let name: string | undefined;
      if (event.id !== undefined) {
        const index = openCalls.findIndex((call) => call.id === event.id);
        if (index !== -1) name = openCalls.splice(index, 1)[0].name;
      } else {
        name = openCalls.shift()?.name;
      }
      if (tool !== undefined && name !== tool) continue;
      const status = event.ok === undefined ? '?' : event.ok ? 'ok' : 'fail';
      const duration = event.durationMs !== undefined ? `${event.durationMs}ms` : '';
      const details = [name ?? '(unmatched)', status, duration, formatValue(event.output)]
        .filter((part) => part.length > 0)
        .join('  ');
      lines.push(`${formatTimestamp(event.ts)}  ${'tool_result'.padEnd(TYPE_WIDTH)}  ${details}`);
      continue;
    }

    if (tool !== undefined || !includeText) continue;
    lines.push(`${formatTimestamp(event.ts)}  ${event.type.padEnd(TYPE_WIDTH)}  ${event.text ?? ''}`);
  }

  return lines.join('\n');
}

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(3)}s` : `${Math.round(ms)}ms`;
}

function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

function formatLine(label: string, value: string, extra?: string): string {
  return `${label.padEnd(14)}${value}${extra ? `  (${extra})` : ''}`;
}

function renderToolTable(tools: ToolStats[]): string[] {
  const rows = tools.map((t) => ({
    name: t.name,
    calls: String(t.calls),
    fail: String(t.failures),
    total: formatDuration(t.totalMs),
    avg: formatDuration(t.avgMs),
    max: formatDuration(t.maxMs),
    share: formatPercent(t.timeShare),
  }));

  const widths = {
    name: Math.max('tool'.length, ...rows.map((r) => r.name.length)),
    calls: Math.max('calls'.length, ...rows.map((r) => r.calls.length)),
    fail: Math.max('fail'.length, ...rows.map((r) => r.fail.length)),
    total: Math.max('total'.length, ...rows.map((r) => r.total.length)),
    avg: Math.max('avg'.length, ...rows.map((r) => r.avg.length)),
    max: Math.max('max'.length, ...rows.map((r) => r.max.length)),
    share: Math.max('share'.length, ...rows.map((r) => r.share.length)),
  };

  const line = (r: { name: string; calls: string; fail: string; total: string; avg: string; max: string; share: string }) =>
    [
      r.name.padEnd(widths.name),
      r.calls.padStart(widths.calls),
      r.fail.padStart(widths.fail),
      r.total.padStart(widths.total),
      r.avg.padStart(widths.avg),
      r.max.padStart(widths.max),
      r.share.padStart(widths.share),
    ].join('  ');

  return [
    line({ name: 'tool', calls: 'calls', fail: 'fail', total: 'total', avg: 'avg', max: 'max', share: 'share' }),
    ...rows.map(line),
  ];
}

export function renderStats(stats: TraceStats): string {
  const lines: string[] = [];
  const counts = stats.eventCounts;

  lines.push(
    formatLine(
      'events',
      String(stats.totalEvents),
      `user ${counts.user}, assistant ${counts.assistant}, tool_call ${counts.tool_call}, tool_result ${counts.tool_result}`,
    ),
  );

  if (stats.wallClockMs !== undefined) {
    lines.push(formatLine('wall clock', formatDuration(stats.wallClockMs)));
    const share = stats.wallClockMs > 0 ? stats.toolTimeMs / stats.wallClockMs : 0;
    lines.push(formatLine('tool time', formatDuration(stats.toolTimeMs), `${formatPercent(share)} of wall clock`));
  } else {
    lines.push(formatLine('tool time', formatDuration(stats.toolTimeMs)));
  }

  lines.push(
    formatLine(
      'tool calls',
      String(stats.toolCalls),
      `${stats.completedCalls} completed, ${stats.pendingCalls} pending, ${stats.failedCalls} failed = ${formatPercent(stats.failureRate)} failure rate`,
    ),
  );

  lines.push(formatLine('tokens', `${stats.inputTokens} in / ${stats.outputTokens} out = ${stats.totalTokens} total`));

  if (stats.orphanResults > 0) {
    lines.push(formatLine('orphans', `${stats.orphanResults} tool_result event(s) with no matching call`));
  }

  if (stats.tools.length > 0) {
    lines.push('', ...renderToolTable(stats.tools));
  }

  return lines.join('\n');
}
