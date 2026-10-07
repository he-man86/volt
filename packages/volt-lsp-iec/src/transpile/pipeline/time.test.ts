import { describe, expect, test } from "bun:test"
import { load } from "../index.js"

// End to end, ST -> lower -> interpreter: durations, dates and their conversions.
describe("interp — the executable core", () => {
  test("TIME is 32-bit milliseconds and LTIME 64-bit nanoseconds — both wrap, and TIME × an INT stays TIME", () => {
    // Every duration used to be an unbounded bigint of NANOSECONDS, and a TIME initializer never folded (slots began at 0)
    const pou = load(`
PROGRAM P
VAR
  timeMax : TIME := T#49D17H2M47S295MS; oneMs : TIME := T#1MS; t1s : TIME := T#1S; t500 : TIME := T#500MS; three : INT := 3;
  lt1s : LTIME := LTIME#1S; oneNs : LTIME := LTIME#1NS;
  over : TIME; negative : TIME; tripled : TIME; asDint : DINT; asLint : LINT;
END_VAR
over := timeMax + oneMs; negative := t500 - t1s; tripled := t1s * three;
asDint := TIME_TO_DINT(t1s); asLint := LTIME_TO_LINT(lt1s + oneNs);
END_PROGRAM
`)
    pou.scan()
    const names = ["over", "negative", "tripled", "asDint", "asLint"]
    expect(names.map((n) => pou.get(n))).toEqual([
      0n, // TIME's maximum + 1 ms wraps
      4294966796n, // 500 ms - 1 s wraps below zero, like a UDINT
      3000n, // milliseconds
      1000n,
      1000000001n, // LTIME keeps nanoseconds
    ])
  })

  test("DATE and DT count seconds, TOD milliseconds, the L variants nanoseconds — as literals and as initializers", () => {
    // A date literal reached lowering as its TEXT and was typed STRING; as an initializer it never folded (slot = 0).
    const pou = load(`
PROGRAM P
VAR
  d1 : DATE := D#1970-01-02; dt1 : DT := DT#1970-01-01-00:00:01; tod1 : TOD := TOD#00:00:01;
  ldt1 : LDT := LDT#1970-01-01-00:00:01; early : DT := DT#2024-01-01-00:00:00;
  dateUnits : UDINT; dtUnits : UDINT; todUnits : UDINT; ldtUnits : ULINT; before : BOOL;
END_VAR
dateUnits := DATE_TO_UDINT(d1); dtUnits := DT_TO_UDINT(dt1); todUnits := TOD_TO_UDINT(tod1);
ldtUnits := LDT_TO_ULINT(ldt1); before := early < DT#2024-01-01-00:00:01;
END_PROGRAM
`)
    pou.scan()
    const names = ["dateUnits", "dtUnits", "todUnits", "ldtUnits", "before"]
    expect(names.map((n) => pou.get(n))).toEqual([86400n, 1n, 1000n, 1000000000n, true])
  })

  test("date arithmetic scales between units — truncating into seconds, wrapping, and TOD not reduced modulo a day", () => {
    // `dt + T#1S` had no common type at all; stamped naively, the 1000-ms literal would have added 1000 SECONDS
    const pou = load(`
PROGRAM P
VAR
  epoch : DT := DT#1970-01-01-00:00:00; t1500 : TIME := T#1500MS; dtMax : DT := DT#2106-02-07-06:28:15;
  d28 : DATE := D#2024-02-28; mar1 : DATE := D#2024-03-01; noon : TOD := TOD#12:30:15.5; halfDay : TIME := T#12H;
  plusFraction : UDINT; wrapped : UDINT; forward : UDINT; backward : UDINT; pastMidnight : UDINT; nextDay : UDINT;
END_VAR
plusFraction := DT_TO_UDINT(epoch + t1500); wrapped := DT_TO_UDINT(dtMax + T#1S);
forward := TIME_TO_UDINT(mar1 - d28); backward := TIME_TO_UDINT(d28 - mar1);
pastMidnight := TOD_TO_UDINT(noon + halfDay); nextDay := DATE_TO_UDINT(d28 + T#1D);
END_PROGRAM
`)
    pou.scan()
    const names = ["plusFraction", "wrapped", "forward", "backward", "pastMidnight", "nextDay"]
    expect(names.map((n) => pou.get(n))).toEqual([
      1n, // 1500 ms into seconds truncates
      0n, // DT is 32-bit seconds: its maximum + 1 s is the epoch
      172800000n, // two days, in TIME's milliseconds
      4122167296n, // the reverse wraps as a UDINT
      88215500n, // TOD is not reduced modulo a day
      1709164800n, // 2024-02-29, in seconds
    ])
  })

  // `temporal_conversions`. Why missed: the temporal rules were measured to and from integers only; these pairs were
  // refused, so no test reached them.
  test("temporal conversions: DT to its day and time of day, the literal text, REAL counts, and REAL to TIME rounding", () => {
    const pou = load(
      `PROGRAM P
VAR dt1 : DT := DT#2026-05-29-12:30:45; d1 : DATE := D#2026-05-09; tod1 : TOD := TOD#07:05:03.250; tod0 : TOD := TOD#23:59:59;
  t1 : TIME := T#1H2M3S4MS; rHalf : REAL := 2.5;
  toDate : DATE; toTod : TOD; dateText : STRING; dtText : STRING; todText : STRING; tod0Text : STRING; timeToReal : REAL; halfToTime : TIME; END_VAR
toDate := DT_TO_DATE(dt1); toTod := DT_TO_TOD(dt1);
dateText := DATE_TO_STRING(d1); dtText := DT_TO_STRING(dt1); todText := TOD_TO_STRING(tod1); tod0Text := TOD_TO_STRING(tod0);
timeToReal := TIME_TO_REAL(t1); halfToTime := REAL_TO_TIME(rHalf);
END_PROGRAM`,
      "P",
    )
    pou.scan()
    expect(pou.get("toDate")).toBe(1780012800n) // 2026-05-29, seconds
    expect(pou.get("toTod")).toBe(45045000n) // 12:30:45, milliseconds
    expect([pou.get("dateText"), pou.get("dtText"), pou.get("todText"), pou.get("tod0Text")]).toEqual(["D#2026-05-09", "DT#2026-05-29-12:30:45", "TOD#07:05:03.250", "TOD#23:59:59"])
    expect([pou.get("timeToReal"), pou.get("halfToTime")]).toEqual([3723004, 3n])
  })
})
