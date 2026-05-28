# @opencode-ai/volt-agent

The `volt` CLI: a git-shaped verb surface that synchronizes a normal folder of PLC source files with a live PLC IDE project, via a vendor-agnostic bridge daemon.

Workspace files map 1:1 to IDE items via extension:

| Extension | Item kind | LSP language |
|---|---|---|
| `.st` | POU body in Structured Text (FB, Function, Program) | structured-text |
| `.gvl` | Global Variable List | structured-text |
| `.dut` | Data Unit Type (struct / enum / union / alias) | structured-text |
| `.itf` | Interface declaration + method/property signatures | structured-text |
| `.fbd` / `.ld` / `.sfc` / `.cfc` | POU body in graphical language (pull-only) | plc-fbd / plc-ld / plc-sfc / plc-cfc |

The structured-text extensions all share one LSP (volt-lsp-st), so hover/completion/navigation work uniformly across `.st`/`.gvl`/`.dut`/`.itf`. Graphical extensions are pull-only — the bridge serializes a placeholder body for inspection; edit graphical POUs in TwinCAT.

```
volt init                  Bind this folder to the IDE project the bridge has open;
                          also installs the CODESYS reference corpus + a SKILL.md so
                          AI sessions (opencode, Claude Code) auto-discover the language
volt pull                  Pull IDE state into the workspace                   (= git fetch + merge)
volt push                  Push workspace state to the IDE                     (= git push; refuses on drift)
volt status                Show what differs between IDE, snapshot, workspace  (= git status)
volt build                 Ask the IDE to build, print diagnostics
```

Verbs are deliberately named after git/hg — `incoming` / `outgoing`, `--dry-run`, `--porcelain`, `--force-with-lease` — so the model is self-documenting for anyone with VCS muscle memory.

## Mental model

The bridge is the only thing that talks to the IDE. The CLI is the only thing that talks to the bridge. Files on disk in your workspace are normal source files (.st / .gvl / .dut / .itf for ST-grammar content; .fbd / .ld / .sfc / .cfc for graphical) — your editor (VS Code, opencode, Claude, whatever) edits them like any other source file.

```
  user / AI editor              volt CLI                  vendor bridge              IDE
  ────────────────              ───────                   ─────────────              ───
  edit POUs/FB_X.st     ───▶  volt push     ──▶  POST /push (atomic batch    ───▶  COM
  read POUs/FB_X.st     ◀───  volt pull     ◀──    with ifVersion guards)
                              volt status   ──▶  GET /refs
                              volt build    ──▶  POST /build                 ───▶  vendor build
```

The bridge never sees a git operation. The CLI never speaks COM. Clean split.

## Workspace anatomy

After `volt init`, your folder contains:

```
my-workspace/
├── POUs/                                       # your `.st` files, mirroring the IDE's tree
│   └── PLC_PRG.st
├── docs/codesys-reference/                     # local mirror of the CODESYS ST language reference
│   ├── 00-index.md                             #   AI sessions read these on demand
│   └── ... (13 sections)
├── .claude/skills/st-reference/SKILL.md        # discovery shim — opencode + Claude Code load
│                                               #   this when working on .st files
├── .gitattributes                              # auto-created; pins .st to LF for clean diffs
├── .volt-lsp-st-version                        # records which corpus version is installed
└── .volt/                                      # Volt's internal state — invisible to your editor
    ├── config.json                             #   workspace ↔ IDE binding (platform, project name, port)
    └── snapshot/                               #   bare git repo: HEAD = last-pulled IDE state
```

The `docs/codesys-reference/` + SKILL.md pair makes AI sessions in this workspace authoritative on CODESYS ST. Without them, the AI relies on pretraining alone — usable for simple OOP, unreliable on pragmas / lifecycle / init slots / shadowing. opencode discovers `.claude/skills/` automatically (same universal location Claude Code uses).

`.volt/` is ours. Your own `.git/` (if you `git init` the workspace yourself) is yours. They don't touch each other.

## Workflow examples

### Just-files mode (no git)

```bash
mkdir motor-controller && cd motor-controller
volt init                # binds to whatever project the bridge has open
volt pull                # populates the folder from the IDE
# ... edit POUs/FB_Motor.st in your editor of choice
volt push                # pushes back to the IDE
volt build               # build + diagnostics
```

### With git for history + remote backup

```bash
git init && volt init && volt pull
git add -A && git commit -m "initial pull"
git remote add origin git@github.com:you/motor-controller.git
git push -u origin main

# work loop
volt pull                # pull any IDE changes the engineer made
# ... edit
volt push                # push edits to the IDE
git add -A && git commit -m "tuned ramp" && git push
```

## Drift protection

`volt push` refuses if the IDE has changed since your last `volt pull` — same guard that prevents `git push` from clobbering an upstream you haven't fetched. Recovery is `volt pull` followed by `volt push`. If you really want to overwrite the engineer's work:

- `volt push --force` — bypasses drift unconditionally
- `volt push --force-with-lease=<projectVersion>` — bypasses drift only if the bridge is still exactly at `<projectVersion>` (= what you last saw via `volt status`). Refuses if anyone else moved the bridge after you observed it. Safer.

```
$ volt push
drift detected: IDE has changed since last pull.
  local snapshot:  ca0a5402760c998b
  bridge current:  e0d91d928d025d18
run `volt pull` to bring in IDE changes, or `volt push --force` to push anyway.

$ volt pull
pulled: 3 file(s), removed: 0 file(s).

$ volt push
pushed. snapshot now @ 1f8a3d2e4b51
```

## Git-inspired flags

| Verb | Flag | Models | Behavior |
|---|---|---|---|
| `status` | `--porcelain` | `git status --porcelain` | One line per item, stable codes `iA`/`iM`/`iD` (incoming) and `oA`/`oM`/`oD` (outgoing). Empty stdout = clean. |
| `push` | `--dry-run` / `-n` | `git push --dry-run` | Compute outgoing ChangeSet, print preview, don't touch bridge/snapshot/workspace. |
| `push` | `--force-with-lease=<v>` | `git push --force-with-lease` | Bypass drift only if bridge is still at `<v>`. Stale → refused. |
| `push` | `--force` | `git push --force` | Bypass drift unconditionally. |
| `pull` | `--dry-run` / `-n` | `git fetch --dry-run` | Compute incoming ChangeSet, print preview, don't touch snapshot/workspace. |
| `pull` | `--force` | (no direct git analogue) | Discard local edits that conflict with the pull. |
| `build` | `--full` | (no direct git analogue) | Full rebuild instead of incremental. |

## AI integration (opencode / Claude Code)

`volt` is **CLI-only** — no MCP server. AI agents drive it through the host's shell tool, the same way they drive `git`. This mirrors opencode's own pattern (opencode has no dedicated git MCP either; everything goes through `bash`).

Why no MCP: opencode/Claude Code permission rules match on tool name, not arguments — a single `volt_push` MCP tool with a `force: boolean` arg can't be differentially gated. With CLI invocation, opencode's existing `permission.bash` pattern matching handles `"volt push": "ask"`, `"volt push --force": "ask"`, etc. — same UX users already know for git.

Recommended opencode permission block (`.opencode/opencode.jsonc`):

```jsonc
"permission": {
  "bash": {
    "*": "allow",
    "volt push*": "ask",
    "volt pull*": "ask",
    "volt init*": "ask"
  }
}
```

`volt status` and `volt build` are read-only — left under the default `allow`.

### Structured output for AI parsing

CLI verbs support flags that make stdout AI-parseable without prose:

| Verb | Flag | Output shape |
|---|---|---|
| `status` | `--porcelain` | one line per item, stable codes |
| `push` | `--dry-run` | preview of what would push; exit 0 means safe |
| `build` | (default) | JSON summary on stdout with `success`, `errors`, `warnings`, `diagnostics` |

The AI runs `volt status --porcelain` (or `volt push --dry-run`) first, parses the output, and decides whether to ask the human to approve the real action.

## Layout

Two layers, cleanly separated. **Engine** is pure logic; **cli** is the thin UI surface over the engine; **scripts** are process entry points.

```
src/
├── bridge/                  Vendor-agnostic HTTP client + wire types
│   ├── client.ts              BridgeClient — POSTs to /health, /refs, /fetch, /push, /build
│   ├── remote.ts              the 5-method interface every bridge satisfies
│   ├── types.ts               wire shapes
│   └── test-bridge.ts         in-process bridge stub for unit tests
│
├── engine/                  Core logic — pure functions, no UI knowledge
│   ├── config.ts              .volt/config.json — workspace binding
│   ├── snapshot.ts            .volt/snapshot/ — hidden bare repo for diff;
│   │                          ChangeSet type + computeIncoming/Outgoing
│   ├── git-cmds.ts            thin wrappers around `git` plumbing
│   ├── ops.ts                 bridge↔snapshot translation + diff→ops
│   ├── ops.test.ts            unit tests against TestBridge
│   ├── init.ts                runInit — bind workspace
│   ├── pull.ts                runPull — bridge → workspace (supports dryRun)
│   ├── push.ts                runPush — workspace → bridge (supports force,
│   │                          forceWithLease, dryRun)
│   ├── status.ts              runStatus — diff IDE / snapshot / workspace
│   └── build.ts               runBuild — bridge.build + diagnostic formatter
│
└── cli/                     CLI verbs — one file per verb, plus the executable
    ├── _shared.ts             argv flag helpers, safeVerb wrapper
    ├── index.ts               parseArgs + runVerb dispatcher + HELP string
    ├── init.ts                init verb
    ├── pull.ts                pull verb
    ├── push.ts                push verb (--force, --force-with-lease, --dry-run/-n)
    ├── status.ts              status verb (--porcelain)
    ├── build.ts               build verb (--full)
    ├── bin.ts                 `volt` executable — argv parse, call cli/index, exit
    └── conformance.ts         THE BRIDGE CONTRACT — every vendor bridge must pass this
```

**Pattern per verb:** one engine function (pure), one CLI wrapper (argv flags, stdout/stderr, exit code). Adding a 6th sync verb = add two small files, no edits to dispatchers beyond a one-line register call.

## Running

```bash
# Build
bun run build

# Single-shot invocations
node dist/cli/bin.js init
node dist/cli/bin.js pull
node dist/cli/bin.js push
node dist/cli/bin.js status
node dist/cli/bin.js build

# After `bun install` registers the bin: just `volt init`, etc.
```

## Bridge protocol

Five endpoints. The CLI maps to all of them.

| Endpoint | Used by | Shape |
|---|---|---|
| `GET /health` | `volt init`, error hints | liveness + project identifiers |
| `GET /refs` | `volt status`, `volt push` | project version + per-item versions (cheap) |
| `POST /fetch` | `volt pull` | items changed since the client's known versions |
| `POST /push` | `volt push` | atomic batch of 11 primitive ops with `ifVersion` guards |
| `POST /build` | `volt build` | build + normalized diagnostics |

The bridge does ZERO diff/merge/VCS logic. CODESYS, TIA, and any future bridge implement the same five endpoints — domain reasoning stays here.

## The bridge contract (conformance suite)

The Beckhoff bridge is the first implementation; CODESYS (IronPython) and TIA Portal are next. To keep them genuinely interchangeable from any client's perspective, there's one canonical test pack:

```
src/cli/conformance.ts
```

It runs the live `volt` CLI through scenarios covering every endpoint and every primitive op — POU/child/accessor create/update/delete/rename/move, atomic batch validation, drift detection, conflict recovery, multi-POU batches. Assertions reference only protocol behavior (item presence, folder layout, response shapes) — never vendor-specific defaults. Point it at any bridge port and any IDE-with-a-project-open; it works.

```bash
# Run against any bridge implementation
VOLT_BRIDGE_PORT=8555 bun run conformance         # CLI / wire conformance
bun run conformance:drift                          # Engineer-drift workflows + git-inspired flags
bun run conformance:errors                         # Failure-mode / negative paths
```

The three suites cover complementary surfaces:
- **`src/cli/conformance.ts`** — AI-side actions: create/update/delete/rename/move POUs, children, accessors; atomic batches; the CLI's drift-rejection behaviour.
- **`src/cli/conformance-drift.ts`** — Engineer-side actions simulated via direct `/push`: what happens when the engineer creates/deletes/renames/moves/edits things in the IDE between AI sessions, and does `volt pull` reflect it. Includes a full round-trip (`AI push → engineer edit → AI pull → AI push`) and the git-inspired flag suite (`--dry-run`, `--porcelain`, `--force-with-lease`).
- **`src/cli/conformance-errors.ts`** — Negative paths: ordering mistakes (push before init etc.), bridge unreachable, mismatched binding, the reconcile case (drift + dirty), and the no-op (`nothing to push`). Each scenario asserts the error message is friendly enough to be actionable, not just "Cannot read property of undefined."

**A new bridge is "done" when it passes the conformance suite.** That's the contract — not a TS interface, not a doc, the test pack itself. If conformance goes green against your bridge, the `volt` CLI and any AI client driving it via shell will work against it without changes on their side.

## Determinism (important)

`syncFromBridge` in `engine/ops.ts` produces a commit whose SHA depends ONLY on:
- bridge content
- a fixed author/committer/email
- a fixed epoch date (1970-01-01)
- the parent commit SHA (itself deterministic recursively)

So same IDE state → same snapshot commit SHA on every machine, every restart. This drives the no-churn shortcut in `volt pull` ("nothing changed, don't touch the workspace").

If you change the workspace materialization format (file layout, assembler output, child ordering, `.gitattributes` contents), every snapshot SHA changes too. Treat the materialization format as part of the wire contract — bump deliberately.

## Push semantics

Each `volt push` produces a SINGLE `bridge.pushBatch` call containing one op per changed top-level POU (plus child/accessor ops as needed). The bridge validates ALL ops' `ifVersion` before applying ANY — atomic. On any conflict, the whole batch is rejected and `volt push` reports the bridge's conflict info on stderr, exit 2.

## Tests

```bash
bun test                                            # unit tests (bun:test, against TestBridge)
node dist/cli/conformance.js                        # live CLI conformance (requires bridge + IDE)
```

The C# bridge has its own xUnit suite at `bridges/beckhoff/BeckhoffBridge.Tests/`. C# tests + TS unit tests + CLI conformance all run independently of each other — failures in one don't mask the others.
