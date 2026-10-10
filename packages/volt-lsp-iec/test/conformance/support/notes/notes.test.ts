import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import type { ShapeNote } from "../../fixtures/map-row.js"
import { NOTES } from "./notes.data.js"
import { assertNotes, notesByTask, noteTagProblems, RESTRUCTURE_TASKS, taskIdsOf } from "./notes.js"

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
    // shapes6_4 (the hand-written `impl Default`) rode in 870b70e195 under 7.2.8 with no task of its own: now 7.8.11's —
    // in fbde4d6e1e since 7.2.8 printed field literals bare (`x: L,`), where every field note's items met (its 7.2.11 and 7.2.12
    // items went when those landed)
    // (its 7.8.8 item is `keep:niche: accepted loss …` since 7.8.8 measured 2 occurrences in the corpora)
    expect(NOTES["fbde4d6e1e"]!.tasks.map((t) => t.split(" ")[0])).toEqual(["keep:niche:"])
    // a `keep` note's other items ask for changes: each names the task that makes it, and stays when 7.2.13 removed
    // the `keep` items beside it (its 7.2.5 item went when 7.2.5 landed — the task that lands removes its items)
    // (496b8acb56's was 7.6.6's, and went with it: SEL prints a lazy `if` since 6.15 — transpile-restructure 7.6.6)
    expect(NOTES["496b8acb56"]).toBeUndefined()
    // 7.2.13: the notes of the group-2 constructs that held only `keep` items are gone
    for (const id of ["6a98109119", "a497507b30", "4a6baf16b3", "687428cc81"]) expect(NOTES[id]).toBeUndefined()
    // …and 1d7709a031 (7.3.1) and 1307e33bbf (7.3.5) went with the last item their tasks landed
    for (const id of ["1d7709a031", "1307e33bbf"]) expect(NOTES[id]).toBeUndefined()
  })

  test("7.7.10: the `keep` note on a correct call (fb7e9e6ff4) is gone", () => {
    expect(NOTES["fb7e9e6ff4"]).toBeUndefined()
  })

  test("the authored NOTES all carry a valid tag (transpile-restructure's tasks.md)", () => {
    expect(noteTagProblems(NOTES, taskIdsOf(readFileSync(RESTRUCTURE_TASKS, "utf8")))).toEqual([])
    expect(() => assertNotes()).not.toThrow()
  })
})
