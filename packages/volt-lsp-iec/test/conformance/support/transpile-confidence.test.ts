/**
 * transpile-review 48: `vendor` is the claim that a RECORDED VALUE came back out of the emitted Rust. A recording whose
 * every value is its type's default, from a program with no non-default constant in it, pins nothing — every variable
 * starts at its default, so a body that computes the wrong thing over zeros (or nothing at all) reads the same.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import type { ShapeNote } from "../fixtures/map-row.js"
import { ALL_TESTS } from "../fixtures/index.js"
import { assembleFixture } from "./fixture-units.js"
import { assertNotes, correctnessOf, NOTES, notesByTask, noteTagProblems, RESTRUCTURE_TASKS, taskIdsOf } from "./transpile-confidence.js"

const sourceOf = (name: string): string => {
  const t = ALL_TESTS.find((x) => x.name === name)
  if (t === undefined) throw new Error(`no fixture ${name}`)
  const { source, gvls } = assembleFixture(t, ALL_TESTS)
  return [source, ...gvls.map((g) => g.source)].join("\n")
}
const rated = (name: string): string => correctnessOf(name, "confirmed", true, sourceOf(name))

describe("the vendor oracle needs a recording that discriminates", () => {
  test("all defaults out of all-default inputs is not vendor evidence (cc_ rows)", () => {
    expect(["cc_fp_neg_int_into_int", "cc_add_uint_int", "cc_max_udint_dint"].map(rated)).toEqual(["compiles", "compiles", "compiles"])
  })

  test("a prim_default_* fixture asks for exactly the default, so it keeps vendor", () => {
    expect(["prim_default_int", "prim_default_string"].map(rated)).toEqual(["vendor", "vendor"])
  })

  test("a default ANSWER from non-default constants discriminates, so it keeps vendor", () => {
    // LIMIT(100, 50, 0) = 0 (MX wins when MN > MX); a WHILE false on entry leaves 0; an attribute method that never runs
    expect(["limit_inverted_bounds", "stmt_while_never", "call_after_init"].map(rated)).toEqual(["vendor", "vendor", "vendor"])
  })

  test("a recording with a non-default value stays vendor", () => {
    expect(rated("cc_bitwise_sint_and_literal")).toBe("vendor")
  })
})

/**
 * transpile-restructure 0.6: every review note names the task that owns it — an id of that change's `tasks.md`, or
 * `keep:<reason>` when the note says nothing needs to change — so a note can be deleted the day its task lands and the
 * map header can count what each task still owes.
 */
describe("every note is tagged with the task that owns it", () => {
  const TASKS = [
    "## 0. Baseline",
    "- [x] 0.0 Gate: the tree.",
    "  - Done 2026-10-07. Not a task line: - [ ] 9.9 inside prose.",
    "- [ ] 0a Gate: the review.",
    "- [ ] 7.3.1 The narrow-arithmetic rule in lowering.",
    "  - Notes: 0153115496.",
  ].join("\n")

  test("the task ids are the ids of the file's task lines, nothing else, each with whether it is ticked", () => {
    expect([...taskIdsOf(TASKS)].sort()).toEqual([
      ["0.0", true],
      ["0a", false],
      ["7.3.1", false],
    ])
  })

  test("a note with no tag, an empty keep reason or an id the file does not have is refused by note id", () => {
    const ids = taskIdsOf(TASKS)
    const notes: Record<string, ShapeNote> = {
      aaaaaaaaaa: { improvement: "fine", tasks: ["7.3.1"] },
      bbbbbbbbbb: { improvement: "kept", tasks: ["keep:correct for every input"] },
      cccccccccc: { improvement: "untagged", tasks: [""] },
      dddddddddd: { improvement: "no reason", tasks: ["keep:"] },
      eeeeeeeeee: { improvement: "no such task", tasks: ["7.3.99"] },
      ffffffffff: { improvement: "no owner at all", tasks: [] },
    }
    expect(noteTagProblems(notes, ids)).toEqual([
      "cccccccccc: item 1 has no task",
      "dddddddddd: item 1 is `keep:` without a reason",
      "eeeeeeeeee: item 1's task 7.3.99 is not in transpile-restructure's tasks.md",
      "ffffffffff: no task",
    ])
    expect(noteTagProblems({ aaaaaaaaaa: notes.aaaaaaaaaa!, bbbbbbbbbb: notes.bbbbbbbbbb! }, ids)).toEqual([])
  })

  test("a merged note names an owner per item, and each item is refused on its own", () => {
    const ids = taskIdsOf(TASKS)
    const notes: Record<string, ShapeNote> = {
      aaaaaaaaaa: { improvement: "A Also: B", tasks: ["7.3.1", "keep:B is correct"] },
      bbbbbbbbbb: { improvement: "A Also: B", tasks: ["7.3.1", ""] },
    }
    expect(noteTagProblems(notes, ids)).toEqual(["bbbbbbbbbb: item 2 has no task"])
  })

  test("a note item an already ticked task owns is refused: the task that lands removes its items (7.11.2)", () => {
    const ids = taskIdsOf(TASKS)
    const notes: Record<string, ShapeNote> = {
      aaaaaaaaaa: { improvement: "done", tasks: ["0.0"] },
      bbbbbbbbbb: { improvement: "A Also: B", tasks: ["7.3.1", "0.0"] },
    }
    expect(noteTagProblems(notes, ids)).toEqual([
      "aaaaaaaaaa: item 1's task 0.0 is ticked — the task that lands removes its items from the note",
      "bbbbbbbbbb: item 2's task 0.0 is ticked — the task that lands removes its items from the note",
    ])
  })

  test("the count per task counts a note once under each owner, every keep folded into one `keep` line, by count, then id", () => {
    const notes: Record<string, ShapeNote> = {
      a: { improvement: "x", tasks: ["7.2.3"] },
      b: { improvement: "x", tasks: ["7.3.1"] },
      c: { improvement: "x", tasks: ["7.3.1", "7.3.1"] },
      d: { improvement: "x", tasks: ["keep:one reason", "7.2.3"] },
      e: { improvement: "x", tasks: ["keep:another", "keep:a third"] },
    }
    expect(notesByTask(notes)).toEqual([
      ["7.2.3", 2],
      ["7.3.1", 2],
      ["keep", 2],
    ])
  })

  test("no item of a merged note rides on another item's owner (the 0b review)", () => {
    // shapes6_4 (the hand-written `impl Default`) rode in 870b70e195 under 7.2.8 with no task of its own: now 7.8.11's
    expect(NOTES["870b70e195"]!.tasks).toEqual(["7.2.8", "7.8.11"])
    // a `keep` note's other items ask for changes: each names the task that makes it
    expect(NOTES["1d7709a031"]!.tasks.slice(1)).toEqual(["7.2.5", "7.3.1"])
    expect(NOTES["1307e33bbf"]!.tasks.slice(1)).toEqual(["7.3.5"])
    expect(NOTES["496b8acb56"]!.tasks.slice(1)).toEqual(["7.6.6"])
  })

  test("the authored NOTES all carry a valid tag (transpile-restructure's tasks.md)", () => {
    expect(noteTagProblems(NOTES, taskIdsOf(readFileSync(RESTRUCTURE_TASKS, "utf8")))).toEqual([])
    expect(() => assertNotes()).not.toThrow()
  })
})
