/**
 * the fixtures of `library-bodies.ts` — part A: Standard: the clock-free blocks; Standard: the timers, on the recorded clock; Util.
 *
 * One slice of `library-bodies.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { LanguageTest } from "../../types.js"
import { clocked, fb } from "./library-bodies-shared.js"

export const LIBRARY_BODY_TESTS_A: readonly LanguageTest[] = [
// ── Standard: the clock-free blocks ────────────────────────────────────────────────────────────────────────
  fb("lib_std_edges", "R_TRIG and F_TRIG over a signal high on scans 2, 4 and 5 — how many edges, on which scans",
    `FUNCTION_BLOCK FB_LANG_LIB_edges
VAR
\tn : INT;
\tsig : BOOL;
\trise : R_TRIG;
\tfall : F_TRIG;
\trises : INT;
\tfalls : INT;
\tlastRise : INT;
\tlastFall : INT;
END_VAR
n := n + 1;
sig := n = 2 OR n = 4 OR n = 5;
rise(CLK := sig);
fall(CLK := sig);
IF rise.Q THEN rises := rises + 1; lastRise := n; END_IF
IF fall.Q THEN falls := falls + 1; lastFall := n; END_IF
END_FUNCTION_BLOCK
`, { cycles: 6 }),
  fb("lib_std_counters", "CTU, CTD and CTUD counting the rising edges of a signal, each against PV 2",
    `FUNCTION_BLOCK FB_LANG_LIB_counters
VAR
\tn : INT;
\tsig : BOOL;
\tup : CTU;
\tdown : CTD;
\tboth : CTUD;
END_VAR
n := n + 1;
sig := n = 2 OR n = 4 OR n = 5;
up(CU := sig, RESET := n = 6, PV := 2);
down(CD := sig, LOAD := n = 1, PV := 2);
both(CU := sig, CD := n = 5, RESET := FALSE, LOAD := n = 1, PV := 2);
END_FUNCTION_BLOCK
`, { cycles: 6 }),
  fb("lib_std_counter_ends", "a CTD counted below 0 and a CTUD counted past 16#FFFF — does CV stop, or wrap its WORD?",
    `FUNCTION_BLOCK FB_LANG_LIB_ends
VAR
\tn : INT;
\tdown : CTD;
\tup : CTUD;
END_VAR
n := n + 1;
down(CD := n MOD 2 = 0, LOAD := n = 1, PV := 1);
up(CU := n MOD 2 = 0, CD := FALSE, RESET := FALSE, LOAD := n = 1, PV := 16#FFFE);
END_FUNCTION_BLOCK
`, { cycles: 8 }),
  fb("lib_std_bistables", "SR and RS set, held, reset, and both inputs at once",
    `FUNCTION_BLOCK FB_LANG_LIB_bistables
VAR
\tn : INT;
\tsr1 : SR;
\trs1 : RS;
\tsrHeld : BOOL;
\trsHeld : BOOL;
END_VAR
n := n + 1;
sr1(SET1 := n = 1 OR n = 3, RESET := n >= 3);
rs1(SET := n = 1 OR n = 3, RESET1 := n >= 3);
IF n = 2 THEN srHeld := sr1.Q1; rsHeld := rs1.Q1; END_IF
END_FUNCTION_BLOCK
`, { cycles: 3 }),
  // ── Standard: the timers, on the recorded clock ─────────────────────────────────────────────────────────────
  fb("lib_std_ton", "TON: IN high on scans 2..9 against PT 30ms, then low — Q and ET every scan",
    `FUNCTION_BLOCK FB_LANG_LIB_ton
VAR
\tn : INT;
\tnow : ARRAY[1..12] OF TIME;
\tq : ARRAY[1..12] OF BOOL;
\tet : ARRAY[1..12] OF TIME;
\tt : TON;
END_VAR
n := n + 1;
now[n] := TIME();
t(IN := n >= 2 AND n <= 9, PT := T#30MS);
q[n] := t.Q;
et[n] := t.ET;
END_FUNCTION_BLOCK
`, clocked(12)),
  fb("lib_std_tof", "TOF: IN high on scans 2..3, then low — Q holds for PT 30ms after the fall",
    `FUNCTION_BLOCK FB_LANG_LIB_tof
VAR
\tn : INT;
\tnow : ARRAY[1..12] OF TIME;
\tq : ARRAY[1..12] OF BOOL;
\tet : ARRAY[1..12] OF TIME;
\tt : TOF;
END_VAR
n := n + 1;
now[n] := TIME();
t(IN := n = 2 OR n = 3, PT := T#30MS);
q[n] := t.Q;
et[n] := t.ET;
END_FUNCTION_BLOCK
`, clocked(12)),
  fb("lib_std_tp", "TP: a pulse on scan 2 that IN falling does not cut short, and a second edge on scan 10",
    `FUNCTION_BLOCK FB_LANG_LIB_tp
VAR
\tn : INT;
\tnow : ARRAY[1..12] OF TIME;
\tq : ARRAY[1..12] OF BOOL;
\tet : ARRAY[1..12] OF TIME;
\tt : TP;
END_VAR
n := n + 1;
now[n] := TIME();
t(IN := n = 2 OR n = 10 OR n = 11, PT := T#30MS);
q[n] := t.Q;
et[n] := t.ET;
END_FUNCTION_BLOCK
`, clocked(12)),
  fb("lib_std_tp_held", "TP: IN held high past the pulse's end — what ET holds while IN stays high, and when it clears",
    `FUNCTION_BLOCK FB_LANG_LIB_tp_held
VAR
\tn : INT;
\tnow : ARRAY[1..12] OF TIME;
\tq : ARRAY[1..12] OF BOOL;
\tet : ARRAY[1..12] OF TIME;
\tt : TP;
END_VAR
n := n + 1;
now[n] := TIME();
t(IN := (n >= 2 AND n <= 7) OR n = 11, PT := T#30MS);
q[n] := t.Q;
et[n] := t.ET;
END_FUNCTION_BLOCK
`, clocked(12)),
  fb("lib_std_rtc", "RTC: CDT from PDT on EN's rising edge, running with the clock",
    `FUNCTION_BLOCK FB_LANG_LIB_rtc
VAR
\tn : INT;
\tnow : ARRAY[1..8] OF TIME;
\tq : ARRAY[1..8] OF BOOL;
\tcdt : ARRAY[1..8] OF DT;
\tclk : RTC;
END_VAR
n := n + 1;
now[n] := TIME();
clk(EN := n >= 2, PDT := DT#2026-01-01-00:00:00);
q[n] := clk.Q;
cdt[n] := clk.CDT;
END_FUNCTION_BLOCK
`, clocked(8)),
  // ── Util ───────────────────────────────────────────────────────────────────────────────────────────────
  fb("lib_util_blink", "BLINK: TIMELOW 20ms, TIMEHIGH 10ms while ENABLE holds — which phase first, and OUT every scan",
    `FUNCTION_BLOCK FB_LANG_LIB_blink
VAR
\tn : INT;
\tnow : ARRAY[1..14] OF TIME;
\tout : ARRAY[1..14] OF BOOL;
\tb : BLINK;
END_VAR
n := n + 1;
now[n] := TIME();
b(ENABLE := n <= 12, TIMELOW := T#20MS, TIMEHIGH := T#10MS);
out[n] := b.OUT;
END_FUNCTION_BLOCK
`, clocked(14)),
  fb("lib_util_blink_slow", "BLINK: TIMELOW 50ms, TIMEHIGH 30ms — phases several scans long, so each phase's LENGTH shows",
    `FUNCTION_BLOCK FB_LANG_LIB_blink_slow
VAR
\tn : INT;
\tnow : ARRAY[1..14] OF TIME;
\tout : ARRAY[1..14] OF BOOL;
\tb : BLINK;
END_VAR
n := n + 1;
now[n] := TIME();
b(ENABLE := n <= 12, TIMELOW := T#50MS, TIMEHIGH := T#30MS);
out[n] := b.OUT;
END_FUNCTION_BLOCK
`, clocked(14)),
]
