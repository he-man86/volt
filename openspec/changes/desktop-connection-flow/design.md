# Design — desktop connection flow

## The problem restated as a state machine

The desktop needs one input — **"what project is opencode looking at right now?"** — with three values:

1. `dir` — opencode is on a specific project directory.
2. `none` — opencode is on its home / project-list / a view with no project.
3. `unknown` — we haven't learned yet (cold start, before any signal).

The current code only ever observes value **1**, and only when a chat request fires. It has no representation of **2** (so it sticks) and conflates **3** with **2** (both render "open a project", but they need different copy and different behavior: `unknown` should say "starting…" and resolve quickly; `none` is a stable state the user chose).

Everything downstream — bind, unbind, the panel's top-level branch — is a pure function of this input. Get the input right and the discomfort mostly dissolves.

## The signal is the header sniff — this is now confirmed, not assumed

I verified opencode's behavior directly (live-probed a running server + cross-checked the opencode repo — see `observations.md`). The finding resolves what was an open A/B question:

- opencode's server is **per-request directory-scoped** (`x-opencode-directory` header / `?directory=` query). It has **no global "active project" state** — `GET /project/current` with no header returns the fallback `global` project, not what the GUI is viewing. So there is nothing on the server to *query or subscribe to* for the active directory.
- The web client stamps the header on **every** request from its client-side selected directory. So the header sniff (current mechanism) is the **sanctioned, most-direct** read of the GUI's selection — the design builds on it, not around it.

That gives all three input values from the sniff alone:

- **`unknown` → `dir` (eager bind):** the header rides *every* request, not just chat traffic — navigating into a project fetches its sessions/config/events, all header-stamped. So **bind on any request that resolves to a real project directory**, not only chat-generated ones. This directly removes the "must open a chat first" wait.
- **`dir` → `none` (release):** the home / project-list view resolves to the `global` project (`worktree:"/"`) or carries no directory. A request that resolves to `global`/directory-less is the positive **no-project** signal → release, debounced. (`sameDir` already normalizes real paths.)

### The one residual observation (narrow, un-bind path only)

Confirmed by curl but not yet by driving the real GUI: does navigating opencode *to* home emit directory-less requests we can see (a positive release signal), or does the client simply go **quiet**? Task 1.1 is exactly this single check. It affects only the release path — the eager-bind path above is already settled. If home goes quiet, the release falls back to an idle/last-non-global-request rule; mark that `ponytail:` with its ceiling noted.

## Binding lifecycle (the load-bearing change)

Replace `watchActiveProject`'s "bind on different dir, never unbind" with a small reducer fed by the Phase-1 signal:

```
onSignal(next: 'dir:<path>' | 'none'):
  if next is dir and !sameDir(dir, boundRoot):  bindWorkspace(dir)
  if next is 'none' and boundRoot !== undefined: unbindWorkspace()   // NEW
```

`unbindWorkspace` is the missing half: dispose `shell.status`, clear `boundRoot`, push a `{bound:false}` snapshot. Debounce `none` (e.g. ~1.5s) so a transient directory-less request mid-navigation doesn't flap the panel. Keep `sameDir` normalization (it already prevents re-bind churn).

`unknown` (cold start, pre-signal) renders as a brief "Connecting to opencode…" rather than the onboarding copy, and resolves the moment the first signal lands.

## Onboarding: create vs open

Today `initialized` already splits the two cases — an opened folder that *is* a Volt workspace shows the connected view; one that isn't shows the init picker. The confusion is that the init picker and the "reconnect" picker look identical and the wording doesn't name which world you're in. Fix in the shared model + copy, not new mechanism:

- When **bound to an uninitialized folder**: the picker is explicitly "**Create** a Volt workspace" — the detected IDE projects are *sources to clone from*. Copy names the outcome: "Creates a new folder + git repo from this IDE project."
- When **bound to an initialized folder that's offline**: the picker is "**Reconnect / rebind**" — same list, different verb, and the matching project is visually primary (it's *your* project) with others demoted to "bind to a different project instead".
- The two share one component but carry a `mode` so copy and emphasis differ. This lives in `@volt/control` (`onboardingMode` already exists; extend it) so the VS Code view stays in step.

## One identity

Decide a canonical name and show it once:
- **Canonical = the bound project name** (`boundProjectName`) — it's what the user thinks in and what the IDE shows. The folder basename is secondary (tooltip on the repo row, as today).
- Since `init` names the folder after the project, they coincide until an IDE rename. **Only when they differ** show a one-line reconcile hint ("Folder 'OldName' · IDE project 'NewName' — rebind already matched them; rename the folder if you like") instead of two bare, unexplained names. Before that, one name.

## Vendor as a badge

`projectBtn`'s label is `${platformLabel} · ${displayName}`. Change to render `platformLabel` as a small badge/icon element (the vendor icon is already a design token candidate), and **elide it entirely when only one vendor is present in the detected list** (the common case). The label becomes just the project name. `vendorLabel` stays the single source of the human string; only its *placement* changes.

## Why not let Volt own project selection independently?

Considered and rejected: a Volt-side project switcher decoupled from opencode would be robust to opencode timing, but it creates two disagreeing "current project" states (opencode's view vs Volt's panel) — strictly more confusing than the mirror model. The product intent is "make opencode PLC-aware," i.e. *follow* it. The fix is to read opencode's state **reliably and completely** (all three values), not to stop following it.

## Test strategy

- The reducer (`dir`/`none`/`unknown` → bind/unbind/hold) is pure — unit-test it in `volt-desktop` with a sequence of signals, asserting bind/unbind calls. This is the one runnable check the lifecycle change leaves behind.
- The onboarding `mode` split and the vendor-elision are pure view-model — extend the existing `workspace.ts` / `connector.ts` tests.
- Phase-1 observation is manual (drive opencode, read the log); its output is a short recorded note in this change folder, not a test.
