import { expect, test } from "bun:test"
import { bindingAction, classifySignal, parseRequest } from "./binding.js"

const exists = () => true // opencode always sends real, existing project paths in these cases

// Both encodings, split by HTTP METHOD — read out of the installed opencode's own client transform (1.18.3): it
// early-returns for anything that isn't GET/HEAD, and only on GET/HEAD moves the header into the query and deletes
// it. Read one encoding and you lose the other half of the traffic; these two pin that.
test("parseRequest: a GET carries ?directory= (the client rewrote its header into the query)", () => {
  const r = parseRequest("http://127.0.0.1:4096/session?directory=C%3A%5CUsers%5Cme%5CMyMachine", {})
  expect(r).toEqual({ pathname: "/session", dir: "C:\\Users\\me\\MyMachine" })
})

test("parseRequest: a POST carries the x-opencode-directory header and NO query — chat traffic is all POST", () => {
  const r = parseRequest("http://127.0.0.1:4096/session/abc/message", {
    "x-opencode-directory": "C%3A%5CUsers%5Cme%5CMyMachine",
  })
  expect(r).toEqual({ pathname: "/session/abc/message", dir: "C:\\Users\\me\\MyMachine" })
})

test("parseRequest: no directory anywhere (assets, registry endpoints) reports none", () => {
  expect(parseRequest("http://127.0.0.1:4096/global/config", {})).toEqual({ pathname: "/global/config", dir: undefined })
})

test("classifySignal: opencode's /global/ path prefix is the home/global (no-project) signal", () => {
  expect(classifySignal("/global/event", undefined, exists)).toEqual({ kind: "none" })
  expect(classifySignal("/global/config", undefined, exists)).toEqual({ kind: "none" })
})

test("classifySignal: a real project directory binds (however parseRequest found it — query or header)", () => {
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

// The bug this exists to prevent, seen live: sitting on opencode's HOME page, its client still stamped the LAST
// project's directory on /mcp, /lsp, /config, /project/current… Sticky binding took it, binding auto-connects, and
// the connector ended up SERVING a project the user had never opened. The route decides whether a project is open;
// the request stream only says which one.
test("bindingAction: on the home route a project directory NEVER binds", () => {
  const sig = { kind: "dir", dir: "C:\\proj" } as const
  expect(bindingAction(undefined, sig, same, true)).toEqual({ kind: "noop" })
  expect(bindingAction("C:\\other", sig, same, true)).toEqual({ kind: "unbind" }) // leaving a project releases it
  expect(bindingAction(undefined, sig, same, false)).toEqual({ kind: "bind", dir: "C:\\proj" }) // in a project: binds
})

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
