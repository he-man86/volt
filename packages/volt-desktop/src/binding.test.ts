import { expect, test } from "bun:test"
import { bindingAction } from "./binding.js"

// Exact compare — the canonical (resolve + case-fold) compare is the caller's; here we test the decision logic.
const same = (a?: string, b?: string): boolean => a === b

test("unknown holds — never binds or unbinds (cold start must not touch the binding)", () => {
  expect(bindingAction(undefined, { kind: "unknown" }, same).kind).toBe("noop")
  expect(bindingAction("/proj", { kind: "unknown" }, same).kind).toBe("noop")
})

test("dir binds on a new project, holds on the same one (this is the late-bind fix — any dir, not just chat)", () => {
  expect(bindingAction(undefined, { kind: "dir", dir: "/proj" }, same)).toEqual({ kind: "bind", dir: "/proj" })
  expect(bindingAction("/old", { kind: "dir", dir: "/proj" }, same)).toEqual({ kind: "bind", dir: "/proj" })
  expect(bindingAction("/proj", { kind: "dir", dir: "/proj" }, same).kind).toBe("noop")
})

test("none releases only when bound (the sticky-bind fix), noop otherwise", () => {
  expect(bindingAction("/proj", { kind: "none" }, same).kind).toBe("unbind")
  expect(bindingAction(undefined, { kind: "none" }, same).kind).toBe("noop")
})

test("dir equality is delegated to same() — a case-only difference on Windows must not re-bind", () => {
  const ci = (a?: string, b?: string): boolean => (a ?? "").toLowerCase() === (b ?? "").toLowerCase()
  expect(bindingAction("C:\\Proj", { kind: "dir", dir: "c:\\proj" }, ci).kind).toBe("noop")
})
