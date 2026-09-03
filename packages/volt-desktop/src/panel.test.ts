import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { detectedKey, snapshot } from "./panel.js"

// shell.html is the renderer — a static file loaded at runtime, so nothing type-checks or bundles it, and a
// syntax error in its <script> silently kills EVERY handler: the rail still draws (static HTML) but clicking a
// tab does nothing, so the whole IDE panel becomes unopenable. That shipped — a confirm() message written across
// two source lines put a raw newline INSIDE a string literal (must be \n), which is a SyntaxError that took down
// tab()/setOpen() and everything else. Parse the script the way the browser would; `new Function` throws on
// exactly that class without running any of it.
test("shell.html's script parses (a syntax error there makes the whole IDE panel unopenable)", () => {
  const html = readFileSync(join(import.meta.dir, "..", "shell.html"), "utf8")
  const script = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1]
  expect(script, "shell.html has no <script> block").toBeTruthy()
  expect(() => new Function(script!)).not.toThrow()
})

// AND NO USER TEXT IS COMPILED AS CODE. The same "static file nothing checks" property that let a raw newline
// ship also let a real bug live here: project ids and names come from the IDE and were interpolated into an
// inline `onclick`, as `doRebind('<id>','<name>')`. `esc` turned `'` into `&#39;` and a comment claimed that
// made it safe — but an HTML parser decodes character references in an attribute value BEFORE the handler body
// compiles as JS, so a project called "Bob's Machine" reached the compiler as `doRebind('id','Bob's Machine')`.
// A SyntaxError, and that one project's button silently did nothing while every other button worked.
//
// Asserted at the SOURCE rather than by calling `projectBtn`: it lives inside the inline <script>, which
// registers listeners at top level and so cannot be imported. The rule it pins is the one that was broken —
// arguments travel in `data-*` and are read back as text by the delegated listener, never compiled.
test("shell.html compiles no user text into handlers (project args ride data-*, not inline calls)", () => {
  const html = readFileSync(join(import.meta.dir, "..", "shell.html"), "utf8")
  const script = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? ""

  expect(script).not.toMatch(/do(Rebind|Init)\(['"`]/) // the exact shape that shipped
  expect(script).toContain("data-pact") // ...and the replacement is present, so this can't pass by deletion
})

// panel.ts is electron-free (the renderer draws the pixels); snapshot() is the pure shell → shared view-model
// projection. Smoke it so the desktop package enters the CI gate and the init surface keeps naming projects.
const proj = {
  id: "codesys::MyMachine:",
  displayName: "MyMachine",
  vendor: "codesys" as const,
  dirty: false,
  connected: true,
}

// The parity point behind the vscode fix: the desktop init surface shows the detected project NAME. The unbound
// snapshot carries the picker as `surface` (partitioned by @volt/control) — an unbound folder is a `create` surface.
test("unbound snapshot carries the detected projects as a create surface (so the init surface can name them)", () => {
  const snap = snapshot({ projects: [proj], status: undefined, connectorUp: true } as never)
  expect(snap.bound).toBe(false)
  expect(snap.surface.create.map((p) => p.displayName)).toEqual(["MyMachine"])
})

// The onboarding gap: connector-down vs no-project must be distinguishable, or the panel tells someone with a
// stopped connector that no PLC project was detected — sending them to their IDE to fix a problem that is not
// there.
//
// Retargeted from `connectorUp` to `onboarding`. The old assertion's stated premise — "so the renderer can say
// 'Connector isn't running'" — was false: the renderer never read `connectorUp`, it branches on `onboarding`
// (grep `shell.html`). So the test pinned a field nothing consumed while the decision it cared about went
// unchecked. The premise was wrong on grounds independent of the code, which is the only licence to change a
// test here; the field itself is now gone.
test("the snapshot distinguishes 'connector down' from 'connector up, no project'", () => {
  expect(snapshot({ projects: [], status: undefined, connectorUp: false } as never).onboarding).toBe("no-connector")
  expect(snapshot({ projects: [], status: undefined, connectorUp: true } as never).onboarding).toBe("no-project")
})

test("unbound snapshot exposes empty drift arrays the renderer reads unconditionally", () => {
  const snap = snapshot({ projects: [], status: undefined } as never)
  expect(snap.bound).toBe(false)
  if (!snap.bound) {
    expect(snap.incoming).toEqual([])
    expect(snap.outgoing).toEqual([])
  }
})

// The detected-project list is only pushed to the renderer when its KEY changes, so the key has to cover every
// field the picker draws — not just identity. It covered ids alone, while `projectBtn` draws `dirty` as a
// trailing asterisk and `dirty` is re-read on every health poll. A project going dirty changed nothing, so the
// panel sat contradicting the tray next to it, which redraws that same asterisk from that same field.
//
// The suppression is impure (it probes the connector and sends over a BrowserWindow), so the key is exported and
// asserted directly. Asserting "two snapshots with different dirty differ" would have passed before the fix too.
test("the detected-project key changes when dirty changes, not only when identity does", () => {
  const p = (dirty: boolean) => [{ ...proj, dirty }] as never

  expect(detectedKey(p(true))).not.toBe(detectedKey(p(false)))
})

test("...and is stable under reordering, since it is a set comparison", () => {
  const a = { ...proj, id: "codesys::A:" }
  const b = { ...proj, id: "codesys::B:" }

  expect(detectedKey([a, b] as never)).toBe(detectedKey([b, a] as never))
})
