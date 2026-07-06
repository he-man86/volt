import { test, expect } from "bun:test"
import { parseSource } from "../syntax/index.js"
import { deadPous, ownerPou, type ReachabilityInput } from "./reachability.js"

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

test("ownerPou returns the file's primary POU, undefined for a non-POU file", () => {
  expect(ownerPou(parseSource("FUNCTION_BLOCK F\nEND_FUNCTION_BLOCK"))).toBe("f")
  expect(ownerPou(parseSource("INTERFACE I\nEND_INTERFACE"))).toBeUndefined()
})
