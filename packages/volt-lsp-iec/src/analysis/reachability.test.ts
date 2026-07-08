import { test, expect } from "bun:test"
import { parseSource } from "../syntax/index.js"
import { deadPous, deadMemberSpans, ownerPou, type ReachabilityInput } from "./reachability.js"

/** Build a reachability input from a file's bare name + source (uri drives GVL naming, not needed here). */
function file(name: string, source: string): ReachabilityInput {
  return { uri: `file:///${name}`, source, parseResult: parseSource(source) }
}

const PRG = (name: string, body: string) => file(`${name}.prg`, `PROGRAM ${name}\n${body}\nEND_PROGRAM`)
const FB = (name: string, decl: string, body = "") =>
  file(`${name}.fb`, `FUNCTION_BLOCK ${name}\n${decl}\n${body}\nEND_FUNCTION_BLOCK`)

test("a PROGRAM → FB call chain keeps the FB live", () => {
  const dead = deadPous([
    PRG("Main", "VAR\n inst : FB_Live;\nEND_VAR\ninst();"),
    FB("FB_Live", "VAR x : INT; END_VAR", "x := x + 1;"),
  ])
  expect(dead.has("fb_live")).toBe(false)
})

test("an FB never called or instantiated is dead", () => {
  const dead = deadPous([
    PRG("Main", "VAR\n inst : FB_Live;\nEND_VAR\ninst();"),
    FB("FB_Live", "VAR x : INT; END_VAR", "x := x + 1;"),
    FB("FB_Orphan", "VAR y : INT; END_VAR", "y := y + 1;"),
  ])
  expect(dead.has("fb_orphan")).toBe(true)
  expect(dead.has("fb_live")).toBe(false)
})

test("an FB reachable ONLY via a declaration `inst : FB;` is live (instantiation edge)", () => {
  // FB_Dep is never CALLED, only declared as a member instance of a live FB — still live.
  const dead = deadPous([
    PRG("Main", "VAR\n inst : FB_Holder;\nEND_VAR\ninst();"),
    FB("FB_Holder", "VAR dep : FB_Dep; END_VAR"),
    FB("FB_Dep", "VAR z : INT; END_VAR", "z := z + 1;"),
  ])
  expect(dead.has("fb_dep")).toBe(false)
})

test("an FB implementing a referenced interface is live (uncertain dynamic dispatch ⇒ live)", () => {
  // The program only ever names IFoo (an interface-typed var) — never FB_Impl. The interface→implementer
  // edge is what keeps FB_Impl live, because `p` could hold an FB_Impl at runtime.
  const dead = deadPous([
    PRG("Main", "VAR\n p : IFoo;\nEND_VAR\np.Go();"),
    file("IFoo.itf", "INTERFACE IFoo\nMETHOD Go\nEND_METHOD\nEND_INTERFACE"),
    file("FB_Impl.fb", "FUNCTION_BLOCK FB_Impl IMPLEMENTS IFoo\nEND_FUNCTION_BLOCK"),
  ])
  expect(dead.has("fb_impl")).toBe(false)
  // Sanity: with IFoo referenced nowhere, the implementer really is dead.
  const dead2 = deadPous([
    PRG("Main", "x := 1;"),
    file("IFoo.itf", "INTERFACE IFoo\nMETHOD Go\nEND_METHOD\nEND_INTERFACE"),
    file("FB_Impl.fb", "FUNCTION_BLOCK FB_Impl IMPLEMENTS IFoo\nEND_FUNCTION_BLOCK"),
  ])
  expect(dead2.has("fb_impl")).toBe(true)
})

test("a project with no PROGRAM marks nothing dead (can't determine entry points)", () => {
  const dead = deadPous([FB("FB_A", "VAR END_VAR"), FB("FB_B", "VAR END_VAR")])
  expect(dead.size).toBe(0)
})

test("an FB kept live by a global instance (GVL) is not dead", () => {
  const dead = deadPous([
    PRG("Main", "x := 1;"),
    file("GVL.gvl", "VAR_GLOBAL\n g : FB_Global;\nEND_VAR"),
    FB("FB_Global", "VAR END_VAR"),
  ])
  expect(dead.has("fb_global")).toBe(false)
})

// Task-root seeding — CODESYS runs only PROGRAMs assigned to a task (`.task` `Calls:`). A PROGRAM not in
// any task, whose sole call is commented out ("moved elsewhere"), is dead. (Corpus-found: bakon-nano's
// ControlStatusAGMs.)
test("a PROGRAM not assigned to a task (call commented out) is dead when task roots are given", () => {
  const files = [
    // CyclicTask is the task entry; its call to the other program is commented, so no reference edge.
    PRG("CyclicTask", "x := 1;\n// ControlStatusAGMs();"),
    PRG("ControlStatusAGMs", "y := 1;"),
  ]
  // Without task roots, every PROGRAM is a root ⇒ nothing dead (the safe fallback).
  expect(deadPous(files).has("controlstatusagms")).toBe(false)
  // With task roots = {CyclicTask}, the uncalled PROGRAM is dead.
  const dead = deadPous(files, new Set(["cyclictask"]))
  expect(dead.has("controlstatusagms")).toBe(true)
  expect(dead.has("cyclictask")).toBe(false)
})

test("a PROGRAM the task entry actually CALLS stays live under task-root seeding", () => {
  const files = [PRG("CyclicTask", "SubProgram();"), PRG("SubProgram", "y := 1;")]
  const dead = deadPous(files, new Set(["cyclictask"]))
  expect(dead.has("subprogram")).toBe(false) // reached via the live call edge
})

test("every PROGRAM on a multi-call task stays live; one not on any task is dead", () => {
  // Mirrors `Calls: Simulation, General, ...` — several independent task-root programs, none calling
  // the others. All named roots are live; an unlisted PROGRAM (Orphan) is dead.
  const files = [
    PRG("Simulation", "x := 1;"),
    PRG("General", "y := 1;"),
    PRG("Mach1_MotionControl", "z := 1;"),
    PRG("Orphan", "w := 1;"),
  ]
  const dead = deadPous(files, new Set(["simulation", "general", "mach1_motioncontrol"]))
  expect(dead.has("simulation")).toBe(false)
  expect(dead.has("general")).toBe(false)
  expect(dead.has("mach1_motioncontrol")).toBe(false)
  expect(dead.has("orphan")).toBe(true)
})

test("task roots that match no PROGRAM fall back to all-programs (safety, never over-kill)", () => {
  const files = [PRG("Main", "x := 1;"), PRG("Other", "y := 1;")]
  const dead = deadPous(files, new Set(["nonexistent_task"]))
  expect(dead.size).toBe(0) // no match ⇒ every PROGRAM is a root, as before
})

// Member-level dead code — a LIVE FB can still contain excluded/uncalled methods (CODESYS excludes methods
// individually; corpus-found: pro2193's Execute_Sequence2/3). The finer suppression targets those.
/** Lowercased names of the dead MEMBERS across `files`. */
function deadMembers(files: ReachabilityInput[]): Set<string> {
  const spans = deadMemberSpans(files, deadPous(files, new Set(["main"])))
  const names = new Set<string>()
  for (const f of files) {
    const dm = spans.get(f.uri)
    if (dm === undefined) continue
    for (const u of f.parseResult.units)
      if (
        (u.kind === "method" || u.kind === "action" || u.kind === "property") &&
        dm.some((d) => u.span.start >= d.start && u.span.start < d.end)
      )
        names.add(u.name.text.toLowerCase())
  }
  return names
}

test("an uncalled method island (in a LIVE FB) is dead; the called chain stays live", () => {
  const src = `FUNCTION_BLOCK F
Live1();
END_FUNCTION_BLOCK
METHOD Live1
Live2();
END_METHOD
METHOD Live2
x := 1;
END_METHOD
METHOD Island1
Island2();
END_METHOD
METHOD Island2
y := 1;
END_METHOD`
  const dead = deadMembers([PRG("Main", "VAR i : F; END_VAR\ni();"), file("F.fb", src)])
  expect(dead.has("island1")).toBe(true)
  expect(dead.has("island2")).toBe(true)
  expect(dead.has("live1")).toBe(false)
  expect(dead.has("live2")).toBe(false)
})

test("a dead ACTION (uncalled) is dead; a called action stays live", () => {
  const src = `FUNCTION_BLOCK F
LiveAction;
END_FUNCTION_BLOCK
ACTION LiveAction
x := 1;
END_ACTION
ACTION DeadAction
y := 1;
END_ACTION`
  const dead = deadMembers([PRG("Main", "VAR i : F; END_VAR\ni();"), file("F.fb", src)])
  expect(dead.has("deadaction")).toBe(true)
  expect(dead.has("liveaction")).toBe(false)
})

test("a member called CROSS-FILE (fbB.Method) stays live; a truly-unused sibling is dead", () => {
  const a = file("FB_A.fb", `FUNCTION_BLOCK FB_A\nVAR b : FB_B; END_VAR\nb.DoThing();\nEND_FUNCTION_BLOCK`)
  const b = file("FB_B.fb", `FUNCTION_BLOCK FB_B\nEND_FUNCTION_BLOCK\nMETHOD DoThing\nz := 1;\nEND_METHOD\nMETHOD Unused\nw := 1;\nEND_METHOD`)
  const dead = deadMembers([PRG("Main", "VAR a : FB_A; END_VAR\na();"), a, b])
  expect(dead.has("dothing")).toBe(false) // reached via the cross-file call edge
  expect(dead.has("unused")).toBe(true)
})

// SAFETY: implicitly-called members must NEVER be reported dead, else a real error in them is hidden.
test("a lifecycle method (FB_Init) with no explicit caller is NOT dead (whitelisted)", () => {
  const src = `FUNCTION_BLOCK F
END_FUNCTION_BLOCK
METHOD FB_Init : BOOL
VAR_INPUT bInitRetains : BOOL; bInCopyCode : BOOL; END_VAR
x := 1;
END_METHOD`
  expect(deadMembers([PRG("Main", "VAR i : F; END_VAR\ni();"), file("F.fb", src)]).has("fb_init")).toBe(false)
})

test("a method matching an interface method (dispatch) is NOT dead", () => {
  const iface = file("IGo.itf", "INTERFACE IGo\nMETHOD Go\nEND_METHOD\nEND_INTERFACE")
  const fb = file("F.fb", `FUNCTION_BLOCK F IMPLEMENTS IGo\nEND_FUNCTION_BLOCK\nMETHOD Go\nx := 1;\nEND_METHOD`)
  // Main references IGo (keeps the interface + implementer live); Go is never called by name.
  const dead = deadMembers([PRG("Main", "VAR p : IGo; i : F; END_VAR\ni();"), iface, fb])
  expect(dead.has("go")).toBe(false)
})

test("a method of a DEAD FB is not double-reported (whole file already suppressed)", () => {
  const dead = deadMembers([PRG("Main", "x := 1;"), file("Orphan.fb", `FUNCTION_BLOCK Orphan\nEND_FUNCTION_BLOCK\nMETHOD M\ny();\nEND_METHOD`)])
  expect(dead.has("m")).toBe(false) // Orphan is dead at the POU level; its members aren't separately listed
})

test("ownerPou returns the file's primary POU, undefined for a non-POU file", () => {
  expect(ownerPou(parseSource("FUNCTION_BLOCK F\nEND_FUNCTION_BLOCK"))).toBe("f")
  expect(ownerPou(parseSource("INTERFACE I\nEND_INTERFACE"))).toBeUndefined()
})
