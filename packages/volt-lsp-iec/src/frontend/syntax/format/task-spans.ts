/**
 * WHERE A `.task` DESCRIPTOR STATES THINGS — the spans a finding about one of its lines or calls stands on, for the
 * analysis (`checks/workspace/tasks.ts`) and the transpiler's task entry alike. Lines are 1-based, columns 0-based, as
 * every `Span`.
 */
import { splitLines, type Span } from "../span.js"

/** The lines of a text and the offset each starts at. */
function lineStarts(text: string): { lines: string[]; starts: number[] } {
  const lines = splitLines(text)
  const starts: number[] = []
  let at = 0
  for (const line of lines) {
    starts.push(at)
    at += line.length + (text.startsWith("\r\n", at + line.length) ? 2 : 1)
  }
  return { lines, starts }
}

/** The span of line `line` from column `col`, `length` characters long (to its end when not given). */
export function taskLineSpan(text: string, line: number, col = 0, length?: number): Span {
  const { lines, starts } = lineStarts(text)
  const n = Math.min(Math.max(line, 1), lines.length)
  const width = length ?? (lines[n - 1]?.length ?? 0) - col
  const start = (starts[n - 1] ?? 0) + col
  return { start, end: start + width, startLine: n, startCol: col, endLine: n, endCol: col + width }
}

/** The line `label:` stands on — line 1 when the descriptor states no such line. */
function labelLine(text: string, label: string): number {
  const i = lineStarts(text).lines.findIndex((l) => l.includes(":") && l.slice(0, l.indexOf(":")).trim() === label)
  return i < 0 ? 1 : i + 1
}

/** The span of the line `label:` stands on (line 1 where it states none). */
export const taskLabelSpan = (text: string, label: string): Span => taskLineSpan(text, labelLine(text, label))

/** Each of `calls` (the `Calls:` line's names, in order, as `readTask` read them) as the span of its name. */
export function taskCallSpans(text: string, calls: readonly string[]): Span[] {
  const line = labelLine(text, "Calls")
  const raw = lineStarts(text).lines[line - 1] ?? ""
  let from = raw.indexOf(":") + 1
  return calls.map((call) => {
    const col = raw.indexOf(call, from)
    from = col + call.length
    return taskLineSpan(text, line, col, call.length)
  })
}
