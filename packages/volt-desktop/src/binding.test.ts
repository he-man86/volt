import { expect, test } from "bun:test"
import { bindingAction, classifySignal } from "./binding.js"

const exists = () => true // opencode always sends real, existing project paths in these cases

test("classifySignal: opencode's /global/ path prefix is the home/no-project release signal", () => {
  expect(classifySignal("/global/event", undefined, exists)).toEqual({ kind: "none" })
  expect(classifySignal("/global/config", undefined, exists)).toEqual({ kind: "none" })
})

test("classifySignal: a real ?directory= path binds (this is how opencode scopes a project — not the header)", () => {
  expect(classifySignal("/session", "C:\\Users\\me\\MyMachine", exists)).toEqual({ kind: "dir", dir: "C:\\Users\\me\\MyMachine" })
})

test("classifySignal: a directory that is a filesystem root is opencode's global worktree → none", () => {
  expect(classifySignal("/config", "/", exists)).toEqual({ kind: "none" })
  expect(classifySignal("/config", "C:\\", exists)).toEqual({ kind: "none" })
})

test("classifySignal: no directory and no /global/ prefix tells us nothing (registry endpoints, assets)", () => {
  expect(classifySignal("/project", undefined, exists)).toBeUndefined()
  expect(classifySignal("/provider", undefined, exists)).toBeUndefined()
})

test("classifySignal: a directory that doesn't exist is ignored, not bound", () => {
  expect(classifySignal("/session", "C:\\nope", () => false)).toBeUndefined()
})

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
