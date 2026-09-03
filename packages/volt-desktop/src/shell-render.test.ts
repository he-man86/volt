import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * THE RENDERER, EXECUTED — the shipped `shell.html`, not a copy of it.
 *
 * `shell.html` holds ~360 lines of renderer logic that nothing typechecks, nothing bundles and, until this file,
 * no test ran. Its only assertion was that the script *constructs*. That gap is not academic: every defect found
 * during the standalone cleanup lived in this file — a project whose name contained an apostrophe had a silently
 * dead button, three destructive actions were confirmed only here, four `||` defaults stood on branches they
 * could never be reached from, and the status error the view-model carries was never displayed. Each was
 * invisible to `bun typecheck` and to the whole test suite.
 *
 * **It runs the real file rather than lifting the body-builders into a module.** That was the obvious idea and it
 * does not work: `createSurface` → `projectList` → `projectBtn` → `btn` close over module-level `busyAction`;
 * `render()` reads `busy`, `refreshing`, `moreOpen`, `collapsed` and `diag` (a separate IPC stream, not part of
 * the snapshot); and a `<script type="module">` would break every inline `onclick`, because module scope does not
 * populate globals. It would also need a second build artifact and edits to the packaging.
 *
 * So the script is `new Function`-ed with a fake `document` and `volt`, and a tail is appended that returns
 * handles into its scope. The appended code shares that scope, so it can set `snap`/`diag` and call `render()` —
 * the same entry point the app calls.
 *
 * What this buys, concretely: the state matrix below is asserted on the HTML that will actually ship, and the
 * old parse-only assertion survives as a strict subset of it.
 */

type El = {
  innerHTML: string
  className: string
  textContent: string
  style: Record<string, string>
  classList: { toggle: () => void; add: () => void; remove: () => void }
  addEventListener: () => void
  dataset: Record<string, string>
  querySelectorAll: () => unknown[]
}

function el(): El {
  return {
    innerHTML: "",
    className: "",
    textContent: "",
    style: {},
    classList: { toggle: () => {}, add: () => {}, remove: () => {} },
    addEventListener: () => {},
    dataset: {},
    querySelectorAll: () => [] as unknown[], // the renderer restores scroll positions through this
  }
}

type Rendered = { html: () => string; setSnap: (v: unknown) => void; setDiag: (d: unknown) => void; render: () => void }

/** Load, execute and drive the shipped renderer. */
function shell(): Rendered {
  const html = readFileSync(join(import.meta.dir, "..", "shell.html"), "utf8")
  const script = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1]
  if (!script) throw new Error("shell.html has no <script> block")

  const els = new Map<string, El>()
  const doc = {
    getElementById: (id: string) => {
      if (!els.has(id)) els.set(id, el())
      return els.get(id)!
    },
    querySelectorAll: () => [] as unknown[],
    addEventListener: () => {},
    body: el(),
  }
  // The renderer subscribes to three IPC streams at top level; none needs to fire for a render test.
  const volt = { onStatus: () => {}, onProgress: () => {}, onDiagnostics: () => {} }

  // The renderer rebuilds ONE element — `#panel` — so that is the whole output surface.
  const tail = `
    ; return {
      html: () => document.getElementById("panel").innerHTML,
      setSnap: (v) => { snap = v },
      setDiag: (d) => { diag = d },
      render,
    }`
  const factory = new Function("document", "volt", script + tail) as (d: unknown, v: unknown) => Rendered
  return factory(doc, volt)
}

const bound = {
  bound: true,
  initialized: true,
  mode: "ready",
  workspaceRoot: "C:/ws",
  incoming: [],
  outgoing: [],
  conflicts: [],
  health: { label: "Connected", tone: "ok", online: true },
  affordance: { caption: "connected", action: "disconnect" },
  surface: { create: [], primary: [], alternates: [] },
  onboarding: "choose-project",
  ideChanged: false,
}

test("the shipped renderer executes and draws the in-sync state", () => {
  const s = shell()
  s.setSnap({ ...bound })
  s.render()

  expect(s.html()).toContain("In sync with the IDE")
})

/** THE BUG THAT STARTED THIS. A project whose name contains an apostrophe must render a working button — the
 *  arguments ride `data-*` and are read back as text, never compiled. Before the fix this markup carried
 *  `doRebind('…','Bob&#39;s Machine')`, which the HTML parser handed to the JS compiler as a broken literal. */
test("a project name containing an apostrophe renders as data, not as code", () => {
  const s = shell()
  s.setSnap({
    ...bound,
    bound: false,
    initialized: false,
      onboarding: "choose-project",
    surface: {
      create: [{ id: "codesys::Bob's Machine:", displayName: "Bob's Machine", dirty: false, action: "init" }],
      primary: [],
      alternates: [],
    },
  })
  s.render()

  const out = s.html()
  expect(out).toContain("data-pact")
  expect(out).not.toMatch(/onclick="do(Init|Rebind)\(/) // no user text in a handler body
  expect(out).toContain("Bob&#39;s Machine") // and the name is escaped as TEXT, which is what esc is for
})

/** C9: the status error the view-model has always carried is now displayed — but only in the ready state, where
 *  the connection looks fine and the drift list is therefore silently stale. */
test("a status error is surfaced in the ready state", () => {
  const s = shell()
  s.setSnap({ ...bound, error: "volt status exited 1" })
  s.render()

  expect(s.html()).toContain("volt status exited 1")
})

test("...and is NOT stacked onto the offline state, which already explains itself", () => {
  const s = shell()
  s.setSnap({ ...bound, mode: "offline", error: "bridge offline" })
  s.render()

  const out = s.html()
  expect(out).toContain("Not connected to the IDE")
  expect(out).not.toContain("bridge offline")
})

/** The onboarding split C2 kept: connector-down and no-project must read differently, or someone with a stopped
 *  connector is sent to their IDE to fix a problem that is not there. */
test("connector-down and no-project onboarding say different things", () => {
  const s = shell()
  const unbound = { ...bound, bound: false, initialized: false, surface: { create: [], primary: [], alternates: [] } }

  s.setSnap({ ...unbound, onboarding: "no-connector" })
  s.render()
  expect(s.html()).toContain("Connector isn't running")

  s.setSnap({ ...unbound, onboarding: "no-project" })
  s.render()
  expect(s.html()).toContain("No PLC project detected")
})

test("the cold start says it is still looking, rather than claiming nothing is there", () => {
  const s = shell()
  s.setSnap({ ...bound, bound: false, initialized: false, onboarding: "probing" })
  s.render()

  expect(s.html()).toContain("Looking for open PLC projects")
})

test("a merge in progress lists each conflicted file", () => {
  const s = shell()
  s.setSnap({
    ...bound,
    mode: "merging",
    conflicts: [{ name: "FB_Motor.fb", relPath: "src/FB_Motor.fb" }],
  })
  s.render()

  expect(s.html()).toContain("FB_Motor.fb")
})

// THE SEED, not a pushed snapshot: `render()` with nothing set yet is the first paint, before the main process has
// sent anything. The window is on screen for that frame, so whatever the seed says is what a cold start reads. Seeded
// with a known empty state it asserted "No PLC project detected" — sending the user to their IDE — one layer below
// the state fix in `onboardingMode`, and invisible to every test that calls `setSnap` first.
test("the very first paint, before any status arrives, says it is still looking", () => {
  const s = shell()
  s.render()

  expect(s.html()).toContain("Looking for open PLC projects")
  expect(s.html()).not.toContain("No PLC project detected")
})
