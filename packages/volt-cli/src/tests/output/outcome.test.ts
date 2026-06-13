import { describe, test, expect } from "bun:test"
import { renderPull, renderPush } from "../../output/outcome.js"

describe("renderPull", () => {
  test("ok (human) — exit 0, no extra output (command already printed)", () => {
    const e = renderPull({ kind: "ok", synced: ["a", "b"] }, false)
    expect(e.exitCode).toBe(0)
    expect(e.stdout).toBeUndefined()
    expect(e.stderr).toBeUndefined()
  })

  test("refused (human) — exit 2 + the reason on stderr", () => {
    const e = renderPull({ kind: "refused", reason: "pull refused — workspace dirty" }, false)
    expect(e.exitCode).toBe(2)
    expect(e.stderr).toContain("pull refused — workspace dirty")
    expect(e.stdout).toBeUndefined()
  })

  test("conflict (human) — exit 2 + on-disk paths + merge hint on stderr", () => {
    const e = renderPull({ kind: "conflict", paths: ["POUs/FB_Motor.st"] }, false)
    expect(e.exitCode).toBe(2)
    expect(e.stderr).toContain("src/POUs/FB_Motor.st") // src/ prefix → real on-disk path
    expect(e.stderr).toContain("volt merge --continue")
  })

  test("conflict (json) — exit 2 + machine-readable result on stdout", () => {
    const e = renderPull({ kind: "conflict", paths: ["POUs/FB_Motor.st"] }, true)
    expect(e.exitCode).toBe(2)
    expect(e.stderr).toBeUndefined()
    expect(JSON.parse(e.stdout!)).toEqual({ kind: "conflict", paths: ["POUs/FB_Motor.st"] })
  })

  test("ok (json) — exit 0 + result on stdout", () => {
    const e = renderPull({ kind: "ok", synced: ["x"] }, true)
    expect(e.exitCode).toBe(0)
    expect(JSON.parse(e.stdout!)).toEqual({ kind: "ok", synced: ["x"] })
  })
})

describe("renderPush", () => {
  test("ok (human) — exit 0", () => {
    const e = renderPush({ kind: "ok", items: ["FB_Motor"] }, false)
    expect(e.exitCode).toBe(0)
    expect(e.stderr).toBeUndefined()
  })

  test("rejected drift (human) — exit 2 + reason on stderr", () => {
    const e = renderPush({ kind: "rejected", reason: "drift detected: IDE has changed since last pull" }, false)
    expect(e.exitCode).toBe(2)
    expect(e.stderr).toContain("drift detected")
  })

  test("rejected (json) — exit 2 + result on stdout", () => {
    const e = renderPush({ kind: "rejected", reason: "drift detected" }, true)
    expect(e.exitCode).toBe(2)
    expect(JSON.parse(e.stdout!)).toEqual({ kind: "rejected", reason: "drift detected" })
  })
})
