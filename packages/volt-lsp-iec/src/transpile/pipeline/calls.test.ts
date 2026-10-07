import { describe, expect, test } from "bun:test"
import { load } from "../index.js"
import { IecFault } from "../semantics/index.js"

// End to end, ST -> lower -> interpreter: FB calls, routines, PROGRAMs and globals, inheritance, properties.
describe("interp — the executable core", () => {
  // Phase 3 step 3: calls on declared FB instances, as CODESYS recorded them (conformance `fbcall_*`). Before it, any
  // `inst(...)` refused the whole POU (`stmt-call_stmt`, 84% of the corpus).
  test("an FB call stores its inputs, runs the body on the instance, reads its outputs; VAR_IN_OUT writes back", () => {
    const pou = load(
      `FUNCTION_BLOCK FB_Add
VAR_INPUT a : INT; b : INT; END_VAR
VAR_OUTPUT sum : INT; END_VAR
VAR count : INT; END_VAR
count := count + 1;
sum := a + b;
END_FUNCTION_BLOCK
FUNCTION_BLOCK FB_Bump
VAR_IN_OUT v : INT; END_VAR
VAR inner : FB_Add; END_VAR
inner(a := v, b := 10, sum => v);
END_FUNCTION_BLOCK
PROGRAM P
VAR adder : FB_Add; bump : FB_Bump; wide : DINT; n : INT := 1; again : INT; END_VAR
adder(a := 30000, b := 1, sum => wide);
adder(b := 2);
again := adder.sum;
bump(v := n);
END_PROGRAM`,
      "P",
    )
    pou.scan()
    expect(pou.get("wide")).toBe(30001n) // an INT output widened into a DINT on its way out
    expect([pou.get("adder.a"), pou.get("again"), pou.get("adder.count")]).toEqual([30000n, 30002n, 2n]) // `a` kept its value
    expect([pou.get("n"), pou.get("bump.inner.count")]).toEqual([11n, 1n]) // written back through a nested instance
    pou.scan()
    expect(pou.get("n")).toBe(21n)
  })

  // Phase 3 step 4: METHOD, ACTION and FUNCTION calls, as CODESYS recorded them (conformance `fbcall_method_locals`,
  // `fbcall_action`, `fbcall_function_locals`). Before it, `inst.M()` and `F(x)` refused the whole POU (`call-method`,
  // `expr-call`).
  test("a METHOD's and a FUNCTION's locals start over per call; an ACTION runs on its FB; VAR_IN_OUT reaches a routine", () => {
    const pou = load(
      `FUNCTION_BLOCK FB_M
VAR calls : INT; count : INT; END_VAR
END_FUNCTION_BLOCK
METHOD Tick : INT
VAR_INPUT amount : INT; END_VAR
VAR localCount : INT; END_VAR
localCount := localCount + amount;
calls := calls + 1;
Tick := localCount;
END_METHOD
METHOD AddTo
VAR_IN_OUT target : INT; END_VAR
target := target + calls;
END_METHOD
ACTION Inc
count := count + 1;
END_ACTION
FUNCTION F_Acc : INT
VAR_INPUT amount : INT; END_VAR
VAR acc : INT; END_VAR
acc := acc + amount;
F_Acc := acc;
END_FUNCTION
PROGRAM P
VAR inst : FB_M; first : INT; second : INT; viaF : INT; viaPositional : INT; sink : INT := 100; END_VAR
first := inst.Tick(amount := 3);
second := inst.Tick(amount := 3);
inst.Inc();
inst.Inc();
viaF := F_Acc(amount := 4);
viaPositional := F_Acc(4);
inst.AddTo(target := sink);
END_PROGRAM`,
      "P",
    )
    pou.scan()
    expect([pou.get("first"), pou.get("second"), pou.get("inst.calls")]).toEqual([3n, 3n, 2n])
    expect([pou.get("inst.count"), pou.get("viaF"), pou.get("viaPositional"), pou.get("sink")]).toEqual([2n, 4n, 4n, 102n])
  })

  // Phase 3 step 5: globals and PROGRAM calls, as CODESYS recorded them (conformance `fbcall_program_writes_global`: the
  // called program's VAR persists and the global it writes is what the caller reads). Before it, a GVL variable, a
  // VAR_EXTERNAL and a PROGRAM call each refused the POU (`place-not-local`, `call-program`) — and a VAR_EXTERNAL was
  // declared as a LOCAL copy, so a write through it would never have reached the global.
  test("a PROGRAM's instance and a GVL variable are the application's — shared by every body, VAR_EXTERNAL included", () => {
    const pou = load(
      `VAR_GLOBAL
  gShared : INT;
  gStart : INT := 100;
END_VAR
FUNCTION_BLOCK FB_Reader
VAR_OUTPUT seenByFb : INT; END_VAR
seenByFb := gShared + gStart;
END_FUNCTION_BLOCK
PROGRAM PRG_Writer
VAR runs : INT; END_VAR
runs := runs + 1;
gShared := runs * 7;
END_PROGRAM
PROGRAM PLC_PRG
VAR_EXTERNAL gShared : INT; END_VAR
VAR reader : FB_Reader; seen : INT; viaFb : INT; runsSeen : INT; END_VAR
PRG_Writer();
seen := gShared;
reader(seenByFb => viaFb);
runsSeen := PRG_Writer.runs;
END_PROGRAM`,
      "PLC_PRG",
    )
    pou.scan()
    pou.scan()
    expect([pou.get("seen"), pou.get("viaFb"), pou.get("runsSeen")]).toEqual([14n, 114n, 2n])
  })

  // Phase 3½ (2026-09-15), the rules the `inh_*` recordings measured: calling a derived FB runs only its own body;
  // `SUPER^(in := x)` assigns the instance's input and runs the base body on it; that base body's bare `Hook()` reaches
  // the derived override; `SUPER^.Hook()` is the base's.
  test("inheritance: a derived body runs alone, SUPER^ runs the base, and a method call reaches the override", () => {
    const pou = load(
      `PROGRAM P
VAR plain : FB_D; viaSuper : FB_S; END_VAR
plain(inBase := 7);
viaSuper(inBase := 5);
END_PROGRAM
FUNCTION_BLOCK FB_B
VAR_INPUT inBase : INT; END_VAR
VAR nBase : INT; hookBase : INT; END_VAR
nBase := nBase + 1;
Hook();
END_FUNCTION_BLOCK
METHOD Hook
hookBase := hookBase + 1;
END_METHOD
FUNCTION_BLOCK FB_D EXTENDS FB_B
VAR nDerived : INT; hookDerived : INT; END_VAR
nDerived := nDerived + inBase;
END_FUNCTION_BLOCK
METHOD Hook
hookDerived := hookDerived + 1;
END_METHOD
FUNCTION_BLOCK FB_S EXTENDS FB_B
VAR hookDerived : INT; END_VAR
SUPER^(inBase := inBase + 100);
SUPER^.Hook();
END_FUNCTION_BLOCK
METHOD Hook
hookDerived := hookDerived + 1;
END_METHOD`,
      "P",
    )
    pou.scan()
    // the base body did not run for `plain` (inh_call_runs_derived_body)
    expect([pou.get("plain.nBase"), pou.get("plain.nDerived"), pou.get("plain.hookBase"), pou.get("plain.hookDerived")]).toEqual([0n, 7n, 0n, 0n])
    // SUPER^ assigned 105 and ran the base body, whose Hook() is the override; SUPER^.Hook() is the base's
    expect([pou.get("viaSuper.inBase"), pou.get("viaSuper.nBase"), pou.get("viaSuper.hookDerived"), pou.get("viaSuper.hookBase")]).toEqual([105n, 1n, 1n, 1n])
  })

  // `state_program_called_from_fb`: a PROGRAM called from an FB's body is the one instance PLC_PRG calls. Why missed: a
  // program was callable from the POU's own body only, as Rust held its instance for the root scan alone.
  test("a PROGRAM called from inside an FB is the same one instance the POU calls", () => {
    const pou = load(
      `PROGRAM P
VAR inst : FB_C; direct : INT; END_VAR
inst();
PRG_Counted();
direct := PRG_Counted.runs;
END_PROGRAM
PROGRAM PRG_Counted
VAR runs : INT; END_VAR
runs := runs + 1;
END_PROGRAM
FUNCTION_BLOCK FB_C
VAR_OUTPUT seen : INT; END_VAR
PRG_Counted();
seen := PRG_Counted.runs;
END_FUNCTION_BLOCK`,
      "P",
    )
    pou.scan()
    pou.scan()
    expect([pou.get("inst.seen"), pou.get("direct")]).toEqual([3n, 4n])
  })

  // `state_call_after_global_init_counts`: the method runs once per instance before the first scan, however many scans
  // follow. Why missed: `call_after_global_init_slot` wrote `iCount := 1`, and an FB carrying it was refused.
  test("a call_after_global_init_slot METHOD runs once per instance, before the first scan", () => {
    const pou = load(
      `PROGRAM P
VAR one : FB_I; two : FB_I; END_VAR
one();
two();
END_PROGRAM
FUNCTION_BLOCK FB_I
VAR inits : INT; scans : INT; END_VAR
scans := scans + 1;
END_FUNCTION_BLOCK
{attribute 'call_after_global_init_slot' := '50000'}
METHOD AfterGlobalInit
inits := inits + 1;
END_METHOD`,
      "P",
    )
    expect([pou.get("one.inits"), pou.get("one.scans")]).toEqual([1n, 0n]) // run at start, before any scan
    pou.scan()
    pou.scan()
    pou.scan()
    expect(["one.inits", "one.scans", "two.inits", "two.scans"].map((n) => pou.get(n))).toEqual([1n, 3n, 1n, 3n])
  })

  // `state_routine_outputs`: a FUNCTION's and a METHOD's VAR_OUTPUT starts over at every call, is read through `=>`, and
  // may be left unconnected. Why missed: routine outputs were refused, and `var_output_on_function` wrote 0 — a value
  // no store could be told from.
  test("a routine's VAR_OUTPUT starts over every call and is read through =>, connected or not", () => {
    const pou = load(
      `PROGRAM P
VAR inst : FB_O; units : INT; tens : INT; calls1 : INT; calls2 : INT; units2 : INT; took : INT; before : INT; kept1 : INT; kept2 : INT; END_VAR
units := F_S(value := 47, tens => tens, calls => calls1);
units2 := F_S(value := 3, calls => calls2);
F_S(value := 9);
took := inst.Take(amount := 2, before => before, kept => kept1);
inst.Take(amount := 1, kept => kept2);
END_PROGRAM
FUNCTION F_S : INT
VAR_INPUT value : INT; END_VAR
VAR_OUTPUT tens : INT; calls : INT; END_VAR
calls := calls + 1;
tens := value / 10;
F_S := value MOD 10;
END_FUNCTION
FUNCTION_BLOCK FB_O
VAR stored : INT := 5; END_VAR
END_FUNCTION_BLOCK
METHOD Take : INT
VAR_INPUT amount : INT; END_VAR
VAR_OUTPUT before : INT; kept : INT; END_VAR
kept := kept + 1;
before := stored;
stored := stored + amount;
Take := stored;
END_METHOD`,
      "P",
    )
    pou.scan()
    pou.scan()
    const names = ["before", "calls1", "calls2", "inst.stored", "kept1", "kept2", "tens", "took", "units", "units2"]
    expect(names.map((n) => pou.get(n))).toEqual([8n, 1n, 1n, 11n, 1n, 1n, 4n, 10n, 7n, 3n])
  })

  // Phase 3½, the rules the `state_*` recordings measured: a METHOD's VAR_INST is kept per instance from its initial value,
  // its VAR_STAT is one variable for every instance, and `a := ,` assigns nothing.
  test("VAR_INST per instance, VAR_STAT shared by every instance, and an empty argument that assigns nothing", () => {
    const pou = load(
      `PROGRAM P
VAR one : FB_T; two : FB_T; first : INT; other : INT; sOne : INT; sTwo : INT; inst : FB_E; got : INT; END_VAR
first := one.Tick();
first := one.Tick();
other := two.Tick();
sOne := one.Shared();
sTwo := two.Shared();
inst(a := 100, b := 1);
inst(a := , b := 2, sum => got);
END_PROGRAM
FUNCTION_BLOCK FB_T
VAR x : INT; END_VAR
END_FUNCTION_BLOCK
METHOD Tick : INT
VAR_INST ticks : INT := 10; END_VAR
ticks := ticks + 1;
Tick := ticks;
END_METHOD
METHOD Shared : INT
VAR_STAT count : INT := 10; END_VAR
count := count + 1;
Shared := count;
END_METHOD
FUNCTION_BLOCK FB_E
VAR_INPUT a : INT := 7; b : INT; END_VAR
VAR_OUTPUT sum : INT; END_VAR
sum := a + b;
END_FUNCTION_BLOCK`,
      "P",
    )
    pou.scan()
    expect([pou.get("first"), pou.get("other"), pou.get("sOne"), pou.get("sTwo"), pou.get("got")]).toEqual([12n, 11n, 11n, 12n, 102n])
  })

  // `state_property_get_set`: set 3 → stored 4; the body's bare read gets 8; `THIS^.Level := THIS^.Level + 5` stores 14;
  // two reads in one expression run the getter twice; its VAR starts over each call, so `gets` counts the calls.
  test("a PROPERTY: the getter per read with its VAR started over, a set after its value — bare, THIS^ and dot", () => {
    const pou = load(
      `PROGRAM P
VAR inst : FB_STATE_prop; twice : INT; END_VAR
inst.Level := 3;
inst();
inst.Bump();
twice := inst.Level + inst.Level;
END_PROGRAM
FUNCTION_BLOCK FB_STATE_prop
VAR stored : INT; gets : INT; inside : INT; END_VAR
inside := Level;
END_FUNCTION_BLOCK
METHOD Bump
THIS^.Level := THIS^.Level + 5;
END_METHOD
PROPERTY Level : INT
GET
VAR scratch : INT; END_VAR
scratch := scratch + 1;
gets := gets + scratch;
Level := stored * 2;
END_GET
SET
stored := Level + 1;
END_SET
END_PROPERTY`,
      "P",
    )
    pou.scan()
    expect([pou.get("inst.stored"), pou.get("inst.gets"), pou.get("inst.inside"), pou.get("twice")]).toEqual([14n, 4n, 8n, 56n])
  })

  // Phase 3½: the corpus lowers every FB on its own. Lowered as if it were a PROGRAM, it had no THIS^, no base and no
  // SUPER^ — so this is the shape 128 corpus FBs stopped at.
  test("an FB lowered on its own is one instance of itself, called each scan — its base, SUPER^ and methods included", () => {
    const pou = load(
      `FUNCTION_BLOCK FB_Top EXTENDS FB_Bottom
VAR n : INT; END_VAR
SUPER^(inBase := 2);
Bump();
END_FUNCTION_BLOCK
METHOD Bump
n := n + 1;
END_METHOD
FUNCTION_BLOCK FB_Bottom
VAR_INPUT inBase : INT; END_VAR
VAR total : INT; END_VAR
total := total + inBase;
END_FUNCTION_BLOCK`,
      "FB_Top",
    )
    pou.scan()
    pou.scan()
    expect([pou.get("FB_Top.total"), pou.get("FB_Top.n"), pou.get("FB_Top.inBase")]).toEqual([4n, 2n, 2n])
  })

  // Phase 3½ (`fbcall_gvl_qualified`): a qualified_only list's variable is reachable only as `List.var`, and two lists
  // may each declare one of the same name — two globals, not one.
  test("a GVL variable named through its list, two qualified_only lists holding the same name apart", () => {
    const q = { uri: "GVL_Q.gvl", source: "{attribute 'qualified_only'}\nVAR_GLOBAL\n  gX : INT := 1;\nEND_VAR\n" }
    const other = { uri: "GVL_R.gvl", source: "{attribute 'qualified_only'}\nVAR_GLOBAL\n  gX : INT := 50;\nEND_VAR\n" }
    const pou = load("PROGRAM P\nVAR seen : INT; apart : INT; END_VAR\nGVL_Q.gX := GVL_Q.gX + 5;\nseen := GVL_Q.gX;\napart := GVL_R.gX;\nEND_PROGRAM\n", "P", [q, other])
    pou.scan()
    pou.scan()
    expect([pou.get("seen"), pou.get("apart")]).toEqual([11n, 50n])
  })
})

// Every fixed-text fault is ONE type, `IecFault` (transpile-restructure 1.3a's review): a call through a null interface
// (`dispatch`) was a plain `RangeError`.
describe("a call through a null interface is an IecFault", () => {
  test("no instance", () => {
    const pou = load(
      `INTERFACE I_Do
METHOD Run : INT
END_METHOD
END_INTERFACE
FUNCTION_BLOCK FB_Do IMPLEMENTS I_Do
METHOD Run : INT
Run := 1;
END_METHOD
END_FUNCTION_BLOCK
PROGRAM P
VAR fb : FB_Do; i : I_Do; x : INT; END_VAR
x := i.Run();
END_PROGRAM`,
      "P",
    )
    expect(() => pou.scan()).toThrow(new IecFault("no-instance"))
    expect(() => pou.scan()).toThrow(IecFault)
  })
})
