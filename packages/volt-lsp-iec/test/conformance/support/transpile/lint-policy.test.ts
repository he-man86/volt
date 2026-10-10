import { expect, test } from "bun:test"
import { ALLOWED, splitFindings } from "./lint-policy.js"

const warning = (code: string, line: number): string =>
  JSON.stringify({ level: "warning", code: { code }, spans: [{ is_primary: true, line_start: line }] })

// 7.7.13: a PEDANTIC lint the policy ALLOWS with its reason is Volt's answer, as any allowed lint is — excused (so the
// generator can still refuse an entry that excuses nothing), and not counted in the row's `pedantic`
test("an allowed pedantic lint is excused, not counted; another pedantic one is counted; a clippy::all one is found", () => {
  expect(ALLOWED["clippy::missing_panics_doc"]).toBeDefined()
  const stderr = [warning("clippy::missing_panics_doc", 2), warning("clippy::cast_possible_wrap", 3), warning("clippy::bool_comparison", 4)].join("\n")
  const split = splitFindings(stderr, 10)
  expect(split.excused).toEqual(["clippy::missing_panics_doc"])
  expect(split.pedantic).toEqual(["clippy::cast_possible_wrap"])
  expect(split.found).toEqual([{ code: "clippy::bool_comparison", line: 4 }])
})

// 7.8.9: `x := x` stays ALLOWED, and the review's note on it (ea53989ac8) is that entry's reason now
test("the self_assignment reason carries the review note's text", () => {
  expect(ALLOWED["clippy::self_assignment"]).toContain("ea53989ac8")
  expect(ALLOWED["clippy::self_assignment"]).toContain("could be dropped when target and source are the same side-effect-free place with no conversion")
})

// review of 7.11.3: `dead_code` is ALLOWED for its self-assignment findings only — its reason names nothing else, so an
// unused generated fn, field or variant is FOUND, not excused under a reason that does not describe it
test("dead_code is excused only for a field assigned to itself", () => {
  const dead = (message: string, line: number): string =>
    JSON.stringify({ level: "warning", message, code: { code: "dead_code" }, spans: [{ is_primary: true, line_start: line }] })
  const split = splitFindings([dead("useless assignment of field of type `i16` to itself", 2), dead("function `read` is never used", 3)].join("\n"), 10)
  expect(split.excused).toEqual(["dead_code"])
  expect(split.found).toEqual([{ code: "dead_code", line: 3 }])
})
