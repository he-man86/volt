import { describe, expect, test } from "bun:test"
import { compareLines, DEFAULT_DIRS, junitLines, suiteDirs } from "./suite-snapshot.js"

describe("suite-snapshot (gate T)", () => {
  test("the default set covers the conformance suite, the transpiler, the front-end and the libraries", () => {
    for (const d of ["test/conformance", "src/transpile", "src/frontend/types", "src/frontend/symbols", "src/frontend/syntax", "test/libraries"])
      expect(DEFAULT_DIRS as readonly string[]).toContain(d)
  })

  test("the default set keeps only the directories the tree has; --dirs refuses one it lacks", () => {
    const has = (d: string) => d !== "test/exec"
    expect(suiteDirs(undefined, has)).not.toContain("test/exec")
    expect(suiteDirs("src/transpile, test/libraries", has)).toEqual(["src/transpile", "test/libraries"])
    expect(() => suiteDirs("src/transpile,test/exec", has)).toThrow(/no such directory: test\/exec/)
    expect(() => suiteDirs(",", has)).toThrow(/names no directory/)
  })

  test("a JUnit report becomes sorted status/describe/title lines, the file not part of them", () => {
    const xml = `<testsuite name="a.test.ts"><testcase name="t &amp; u" classname="d › e" time="0"/>` +
      `<testcase name="b" classname="d" time="0"><failure/></testcase><testcase name="c" classname="d"><skipped/></testcase></testsuite>`
    expect(junitLines(xml)).toEqual(["fail\td › b", "pass\td › e › t & u", "skip\td › c"])
  })

  test("an unchanged suite compares identical; one renamed title is reported lost and gained", () => {
    const before = ["pass\tx › a", "pass\tx › b", "pass\tx › b"]
    expect(compareLines(before, [...before].reverse())).toEqual([])
    expect(compareLines(before, ["pass\tx › a", "pass\tx › b", "pass\tx › c"])).toEqual(["- pass\tx › b", "+ pass\tx › c"])
  })
})
