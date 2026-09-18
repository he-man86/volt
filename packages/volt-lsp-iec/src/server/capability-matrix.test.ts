/**
 * Client-capability matrix (behavior-conformance). For each delivery channel a client can select
 * (push-only, pull, pull+refresh) assert that exactly ONE channel carries diagnostics on every lifecycle
 * event — never both. This locks the duplicate-diagnostics fix (PR #86): a pull-capable client that also
 * happens to accept pushes must still be served pull-only.
 */
import { test, expect } from "bun:test"
import { CAPS, harness } from "./harness.js"

const URI = "file:///F.fb"
// A genuine type error (C0032) so every event has something to deliver.
const BAD = `FUNCTION_BLOCK F\nVAR\n b : BOOL; i : INT;\nEND_VAR\ni := b;\nEND_FUNCTION_BLOCK`
const BAD2 = `FUNCTION_BLOCK F\nVAR\n b : BOOL; i : INT;\nEND_VAR\ni := b; i := b;\nEND_FUNCTION_BLOCK`

test("push-only client: diagnostics arrive via push, once per event", async () => {
  const h = harness()
  await h.init(CAPS.pushOnly)
  await h.open(URI, BAD)
  expect(h.pushCount(URI)).toBe(1)
  expect(h.published(URI)?.some((d) => d.code === "C0032")).toBe(true)

  await h.change(URI, 2, BAD2)
  expect(h.pushCount(URI)).toBe(2)

  await h.save(URI)
  expect(h.pushCount(URI)).toBe(3)
  h.dispose()
})

test("pull client: server NEVER pushes; diagnostics come from the pull channel", async () => {
  const h = harness()
  await h.init(CAPS.pull)
  await h.open(URI, BAD)
  await h.change(URI, 2, BAD2)
  await h.save(URI)
  // Not one push across open/change/save…
  expect(h.pushCount(URI)).toBe(0)
  // …and the pull channel carries the diagnostic.
  expect((await h.pull(URI)).some((d) => d.code === "C0032")).toBe(true)
  h.dispose()
})

test("didChangeConfiguration reaches each client kind on its own channel", async () => {
  // push-mode: a config change re-publishes.
  const push = harness()
  await push.init(CAPS.pushOnly)
  await push.open(URI, BAD)
  const before = push.pushCount(URI)
  await push.configure({ diagnoseDeadCode: true })
  expect(push.pushCount(URI)).toBeGreaterThan(before)
  expect(push.refreshCount()).toBe(0)
  push.dispose()

  // pull+refresh mode: a config change prompts a refresh request, no push.
  const pull = harness()
  await pull.init(CAPS.pullRefresh)
  await pull.open(URI, BAD)
  await pull.configure({ diagnoseDeadCode: true })
  expect(pull.refreshCount()).toBeGreaterThan(0)
  expect(pull.pushCount(URI)).toBe(0)
  pull.dispose()
})

test("pull client: closing a document does not push (one channel, even on clear)", async () => {
  const h = harness()
  await h.init(CAPS.pull)
  await h.open(URI, BAD)
  await h.close(URI)
  expect(h.pushCount(URI)).toBe(0)
  h.dispose()
})
