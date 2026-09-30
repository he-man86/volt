/**
 * A CALENDAR LITERAL'S VALUE — a DATE, DT or TOD literal's text as nanoseconds (from the transpiler's constants, where
 * it was the one reader: openspec frontend-conformance 1.22).
 */

/** Nanoseconds since the epoch (DATE/DT) or since midnight (TOD) for a literal's text, or undefined when malformed. */
export function calendarNanoseconds(kind: "date" | "datetime" | "tod", text: string): bigint | undefined {
  const clock = (h: string, m: string, s: string, frac = ""): bigint =>
    ((BigInt(h) * 60n + BigInt(m)) * 60n + BigInt(s)) * 1_000_000_000n + BigInt(frac.padEnd(9, "0").slice(0, 9) || "0")
  if (kind === "tod") {
    const t = /^(\d+):(\d+):(\d+)(?:\.(\d+))?$/.exec(text)
    return t === null ? undefined : clock(t[1]!, t[2]!, t[3]!, t[4])
  }
  const d = /^(\d+)-(\d+)-(\d+)(?:-(\d+):(\d+):(\d+)(?:\.(\d+))?)?$/.exec(text)
  if (d === null) return undefined
  // `Date.UTC` answers NaN past its own range (about year 275760), and `BigInt(NaN)` THROWS — which broke the
  // totality contract that everything downstream rests on: `D#300000-01-01` came out of `lowerSource` as a bare
  // `RangeError: Not an integer`, with no diagnostic and no position. Answering `undefined` is all that is
  // needed, because this function already returns it for a malformed literal and the caller already reports
  // that — the machinery was there, the NaN just walked past it.
  const utc = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]))
  if (!Number.isFinite(utc)) return undefined
  const days = BigInt(utc / 86_400_000)
  const midnight = days * 86_400n * 1_000_000_000n
  return kind === "date" || d[4] === undefined ? midnight : midnight + clock(d[4], d[5]!, d[6]!, d[7])
}
