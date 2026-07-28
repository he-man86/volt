import { expect, test } from "bun:test"
import { bindingAction, classifyRoute } from "./binding.js"

const exists = () => true // the route's directory really is there
// The live route captured from opencode 1.18.3: `/<base64url(dir)>/session/<id>`.
const PROJ = "C:\\Users\\marce\\Documents\\Pro2193-94-95-96_COdesys"
const SEG = Buffer.from(PROJ, "utf8").toString("base64url")

test("classifyRoute: a project page names its own directory (base64url first segment)", () => {
  expect(classifyRoute(`/${SEG}`, exists)).toEqual({ kind: "dir", dir: PROJ })
  expect(classifyRoute(`/${SEG}/session/ses_060aa62fdffeIXZeTjyXQgmV90`, exists)).toEqual({ kind: "dir", dir: PROJ })
})

test("classifyRoute: `/` is home — the release signal", () => {
  expect(classifyRoute("/", exists)).toEqual({ kind: "none" })
  expect(classifyRoute("", exists)).toEqual({ kind: "none" })
})

// Anything we don't recognise must HOLD the binding, never guess it away: an unknown route (a settings page, or a
// scheme change in a future opencode) silently unbinding a working workspace would be worse than doing nothing.
test("classifyRoute: an unrecognised route tells us nothing (hold, don't unbind)", () => {
  expect(classifyRoute("/settings", exists)).toBeUndefined() // decodes to mojibake, not a path
  expect(classifyRoute("/new-session", exists)).toBeUndefined()
})

test("classifyRoute: a segment that decodes to a non-existent directory is ignored", () => {
  expect(classifyRoute(`/${Buffer.from("C:\\nope", "utf8").toString("base64url")}`, () => false)).toBeUndefined()
})

// opencode's `global` worktree is "/" — a route naming a filesystem root is not a project.
test("classifyRoute: a filesystem root is the global worktree, not a project", () => {
  expect(classifyRoute(`/${Buffer.from("/", "utf8").toString("base64url")}`, exists)).toBeUndefined()
  expect(classifyRoute(`/${Buffer.from("C:\\", "utf8").toString("base64url")}`, exists)).toBeUndefined()
})

// Exact compare — the canonical (resolve + case-fold) compare is the caller's; here we test the decision logic.
const same = (a?: string, b?: string): boolean => a === b

test("bindingAction: binds a new project, holds the same one, releases on home", () => {
  expect(bindingAction(undefined, { kind: "dir", dir: "C:\\a" }, same)).toEqual({ kind: "bind", dir: "C:\\a" })
  expect(bindingAction("C:\\a", { kind: "dir", dir: "C:\\a" }, same)).toEqual({ kind: "noop" })
  expect(bindingAction("C:\\a", { kind: "dir", dir: "C:\\b" }, same)).toEqual({ kind: "bind", dir: "C:\\b" })
  expect(bindingAction("C:\\a", { kind: "none" }, same)).toEqual({ kind: "unbind" })
  expect(bindingAction(undefined, { kind: "none" }, same)).toEqual({ kind: "noop" })
})

test("bindingAction: the cold-start unknown never touches the binding", () => {
  expect(bindingAction(undefined, { kind: "unknown" }, same)).toEqual({ kind: "noop" })
  expect(bindingAction("C:\\a", { kind: "unknown" }, same)).toEqual({ kind: "noop" })
})
