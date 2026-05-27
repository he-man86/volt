# @opencode-ai/volt-agent

The `volt` CLI: a git-shaped verb surface that synchronizes a normal folder of `.st` files with a live PLC IDE project, via a vendor-agnostic bridge daemon.

```
volt init                  Bind this folder to the IDE project the bridge has open;
                          also installs the CODESYS reference corpus + CLAUDE.md
                          pointer so AI sessions in this folder know the language
volt pull                  Pull IDE state into the workspace                   (= git fetch + merge)
volt push                  Push workspace state to the IDE                     (= git push; refuses on drift)
volt status                Show what differs between IDE, snapshot, workspace  (= git status)
volt compile               Ask the IDE to build, print diagnostics
volt grant <capability>    Issue a capability lease so AI clients can use      (sudo-style)
                          elevated parameters (e.g. push-force)
volt revoke <capability>   Kill an active capability lease before it expires
```

Verbs are deliberately named after git/hg — `incoming` / `outgoing`, `--dry-run`, `--porcelain`, `--force-with-lease` — so the model is self-documenting for anyone with VCS muscle memory.

## Mental model

The bridge is the only thing that talks to the IDE. The CLI is the only thing that talks to the bridge. Files on disk in your workspace are normal `.st` files — your editor (VS Code, opencode, Claude, whatever) edits them like any other source file.

```
  user / AI editor              volt CLI                  vendor bridge              IDE
  ────────────────              ───────                   ─────────────              ───
  edit POUs/FB_X.st     ───▶  volt push     ──▶  POST /push (atomic batch    ───▶  COM
  read POUs/FB_X.st     ◀───  volt pull     ◀──    with ifVersion guards)
                              volt status   ──▶  GET /refs
                              volt compile  ──▶  POST /compile               ───▶  vendor build
```

The bridge never sees a git operation. The CLI never speaks COM. Clean split.

## Workspace anatomy

After `volt init`, your folder contains:

```
my-workspace/
├── POUs/                       # your `.st` files, mirroring the IDE's tree
│   └── PLC_PRG.st
├── docs/codesys-reference/     # local mirror of the CODESYS ST language reference
│   ├── 00-index.md             #   AI sessions read these to learn the language
│   └── ... (13 sections)
├── CLAUDE.md                   # auto-pointer for AI sessions to the reference
├── .gitattributes              # auto-created; pins .st to LF for clean diffs
├── .volt-lsp-st-version   # records which corpus version is installed
└── .volt/                 # Volt's internal state — invisible to your editor
    ├── config.json             #   workspace ↔ IDE binding (platform, project name, bridge port)
    ├── snapshot/               #   bare git repo: HEAD = last-pulled IDE state
    └── auth/                   #   capability leases for AI-elevated ops (see below)
```

The `docs/codesys-reference/` + `CLAUDE.md` pair makes AI sessions (Claude Code, opencode, etc.) in this workspace authoritative on CODESYS ST. Without them, the AI relies on pretraining alone — usable for simple OOP, unreliable on pragmas / lifecycle / init slots / shadowing.

`.volt/` is ours. Your own `.git/` (if you `git init` the workspace yourself) is yours. They don't touch each other.

## Workflow examples

### Just-files mode (no git)

```bash
mkdir motor-controller && cd motor-controller
volt init                # binds to whatever project the bridge has open
volt pull                # populates the folder from the IDE
# ... edit POUs/FB_Motor.st in your editor of choice
volt push                # pushes back to the IDE
volt compile             # build + diagnostics
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

## AI-elevated operations (capability leases)

Some operations make sense for a human at a terminal but are risky for an AI to invoke autonomously — `force` is the canonical example. The MCP `volt_push` tool exposes a `force` parameter to the AI, but it's **gated on a filesystem capability lease** the human grants via the CLI:

```bash
$ volt grant push-force --ttl 5m --once
granted: push-force for 5m (one-shot)
expires: 2026-05-25T20:32:00.000Z (4m 59s remaining)
lease:   .volt/auth/push-force.lease
```

The AI then sees `availableCapabilities: [{ capability: "push-force", oneShot: true, ... }]` in its next `volt_status` response and can call `volt_push({ force: true })`. On success with a one-shot lease, the lease is consumed; the next force attempt fails until the human grants again. Without an active lease, AI's `force: true` is rejected with `status: "force_unauthorized"` and the exact CLI command the human must run.

Why a filesystem lease (and not a conversational "yes, do it"):
- Lease lives on disk, not in chat — prompt-injected "user approved" doesn't matter
- Lease originates from the CLI — a channel the AI cannot reach over MCP
- Auto-expires (5m default, 24h max) — latent capability doesn't accumulate
- `--once` consumes on first use — standard "I'm approving exactly one operation"

There is **no `volt_grant` MCP tool** and there must never be one — that would defeat the whole separation.

## Git-inspired flags

| Verb | Flag | Models | Behavior |
|---|---|---|---|
| `status` | `--porcelain` | `git status --porcelain` | One line per item, stable codes `iA`/`iM`/`iD` (incoming) and `oA`/`oM`/`oD` (outgoing). Empty stdout = clean. |
| `push` | `--dry-run` / `-n` | `git push --dry-run` | Compute outgoing ChangeSet, print preview, don't touch bridge/snapshot/workspace. |
| `push` | `--force-with-lease=<v>` | `git push --force-with-lease` | Bypass drift only if bridge is still at `<v>`. Stale → refused. |
| `push` | `--force` | `git push --force` | Bypass drift unconditionally (human-side; gated for AI via capability lease). |
| `pull` | `--dry-run` / `-n` | `git fetch --dry-run` | Compute incoming ChangeSet, print preview, don't touch snapshot/workspace. |
| `pull` | `--force` | (no direct git analogue) | Discard local edits that conflict with the pull. |

## Layout

Three layers, cleanly separated. **Engine** is pure logic; **tools** and **cli** are two thin UI surfaces over the same engine; **scripts** are process entry points.

```
src/
├── bridge/                  Vendor-agnostic HTTP client + wire types
│   ├── client.ts              BridgeClient — POSTs to /health, /refs, /fetch, /push, /compile
│   ├── remote.ts              the 5-method interface every bridge satisfies
│   ├── types.ts               wire shapes
│   └── test-bridge.ts         in-process bridge stub for unit tests
│
├── engine/                  Core logic — pure functions, no UI knowledge
│   ├── config.ts              .volt/config.json — workspace binding
│   ├── snapshot.ts            .volt/snapshot/ — hidden bare repo for diff;
│   │                          ChangeSet type + computeIncoming/Outgoing
│   ├── lease.ts               .volt/auth/ — capability leases (sudo-style gate
│   │                          for AI-elevated ops). KNOWN_CAPABILITIES is the
│   │                          single chokepoint for new elevated parameters.
│   ├── git-cmds.ts            thin wrappers around `git` plumbing
│   ├── ops.ts                 bridge↔snapshot translation + diff→ops
│   ├── ops.test.ts            unit tests against TestBridge
│   ├── init.ts                runInit  — bind workspace
│   ├── pull.ts                runPull — bridge → workspace (supports dryRun)
│   ├── push.ts                runPush — workspace → bridge (supports force,
│   │                          forceWithLease, dryRun)
│   ├── status.ts              runStatus — diff IDE / snapshot / workspace;
│   │                          surfaces incoming, outgoing, availableCapabilities
│   └── compile.ts             runCompile — bridge.compile + diagnostic formatter
│
├── tools/                   MCP tools — one file per tool, plus the executable
│   ├── _shared.ts             commonArgs schema, safeRun, jsonContent / errorContent helpers
│   ├── index.ts               buildServer() — registers all 5 tools
│   ├── volt_init.ts            registerVoltInit
│   ├── volt_pull.ts            registerVoltPull (exposes dryRun)
│   ├── volt_push.ts            registerVoltPush (exposes force + dryRun;
│   │                          force gated on push-force lease)
│   ├── volt_status.ts          registerVoltStatus (surfaces availableCapabilities)
│   ├── volt_compile.ts         registerVoltCompile
│   ├── bin.ts                 `volt-mcp` executable — buildServer + stdio transport
│   └── conformance.ts         MCP server conformance (covers the tool-wiring layer)
│
└── cli/                     CLI verbs — one file per verb, plus the executable
    ├── _shared.ts             argv flag helpers, safeVerb wrapper
    ├── index.ts               parseArgs + runVerb dispatcher + HELP string
    ├── init.ts                init verb
    ├── pull.ts                pull verb
    ├── push.ts                push verb (--force, --force-with-lease, --dry-run/-n)
    ├── status.ts              status verb (--porcelain)
    ├── compile.ts             compile verb
    ├── grant.ts               grant + revoke verbs (CLI-only; sudo-style lease issue)
    ├── bin.ts                 `volt` executable — argv parse, call cli/index, exit
    └── conformance.ts         THE BRIDGE CONTRACT — every vendor bridge must pass this
```

**Pattern per verb:** one engine function (pure), one tool wrapper (MCP I/O — zod schema, JSON content blocks), one CLI wrapper (argv flags, stdout/stderr, exit code). Adding a 6th sync verb = add three small files, no edits to dispatchers beyond a one-line register call.

## Running

```bash
# Build
npm run build

# Single-shot invocations
node dist/cli/bin.js init
node dist/cli/bin.js pull
node dist/cli/bin.js push
node dist/cli/bin.js status
node dist/cli/bin.js compile

# After `npm install` registers the bin: just `volt init`, etc.
```

## AI integration (MCP)

`volt-mcp` is the same verb surface as the CLI, exposed as an MCP server over stdio. Any MCP client (Claude Desktop, opencode, Cursor, custom) can drive the workspace.

Tool names mirror the CLI: `volt_init`, `volt_pull`, `volt_push`, `volt_status`, `volt_compile`. Inputs mirror the flags. Outputs are structured JSON so the AI can reason about `drift_detected` / `rejected` / `nothing_to_push` / `force_unauthorized` / `would_push` (dry-run) without parsing prose.

`volt_status` returns `incoming` and `outgoing` ChangeSets (same shape as `hg incoming` / `hg outgoing`) plus `availableCapabilities` so the AI can see which elevated parameters the human has granted, without trial-and-error.

Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "volt": {
      "command": "node",
      "args": ["/abs/path/to/packages/volt-agent/dist/tools/bin.js"],
      "env": {
        "VOLT_WORKSPACE": "/abs/path/to/your/workspace",
        "VOLT_BRIDGE_PORT": "8555"
      }
    }
  }
}
```

`VOLT_WORKSPACE` is optional — tools accept a `workspace` arg per call too, in case you want one MCP server to serve multiple projects. Same for `VOLT_BRIDGE_PORT` / `port`.

Flags:

| Flag | Default | Applies to | Purpose |
|---|---|---|---|
| `--port N` | `8555` (env `VOLT_BRIDGE_PORT`) | all | bridge port |
| `--workspace DIR` | cwd | all | workspace root |
| `--force` | off | `init`, `pull`, `push` | init: repoint; pull: discard local edits; push: bypass drift (AI must hold a `push-force` lease) |
| `--force-with-lease=<v>` | off | `push` | safer force: only succeeds if bridge is still at `<v>` |
| `--dry-run` / `-n` | off | `push`, `pull` | preview without writing |
| `--porcelain` | off | `status` | machine-readable per-item output |
| `--ttl <duration>` | `5m` | `grant` | how long the lease lives (e.g. `30s`, `5m`, `1h`; max 24h) |
| `--once` | off | `grant` | lease is consumed on first successful use |
| `--full` | off | `compile` | full rebuild instead of incremental |

## Bridge protocol

Five endpoints. The CLI maps to three of them; the other two are introspection.

| Endpoint | Used by | Shape |
|---|---|---|
| `GET /health` | `volt init`, error hints | liveness + project identifiers |
| `GET /refs` | `volt status`, `volt push` | project version + per-item versions (cheap) |
| `POST /fetch` | `volt pull` | items changed since the client's known versions |
| `POST /push` | `volt push` | atomic batch of 11 primitive ops with `ifVersion` guards |
| `POST /compile` | `volt compile` | build + normalized diagnostics |

The bridge does ZERO diff/merge/VCS logic. CODESYS, TIA, and any future bridge implement the same five endpoints — domain reasoning stays here.

## The bridge contract (conformance suite)

The Beckhoff bridge is the first implementation; CODESYS (IronPython) and TIA Portal are next. To keep them genuinely interchangeable from any client's perspective, there's one canonical test pack:

```
src/cli/conformance.ts
```

It runs the live `volt` CLI through scenarios covering every endpoint and every primitive op — POU/child/accessor create/update/delete/rename/move, atomic batch validation, drift detection, conflict recovery, multi-POU batches. Assertions reference only protocol behavior (item presence, folder layout, response shapes) — never vendor-specific defaults. Point it at any bridge port and any IDE-with-a-project-open; it works.

```bash
# Run against any bridge implementation
VOLT_BRIDGE_PORT=8555 npm run conformance         # CLI / wire conformance
npm run conformance:drift                              # Engineer-drift workflows + git-inspired flags + lease flow
npm run conformance:errors                             # Failure-mode / negative paths
npm run conformance:mcp                                # MCP tool conformance (incl. dry-run + force-gating)
```

The four suites cover complementary surfaces:
- **`src/cli/conformance.ts`** — AI-side actions: create/update/delete/rename/move POUs, children, accessors; atomic batches; the CLI's drift-rejection behaviour.
- **`src/cli/conformance-drift.ts`** — Engineer-side actions simulated via direct `/push`: what happens when the engineer creates/deletes/renames/moves/edits things in the IDE between AI sessions, and does `volt pull` reflect it. Includes a full round-trip (`AI push → engineer edit → AI pull → AI push`), the git-inspired flag suite (`--dry-run`, `--porcelain`, `--force-with-lease`), and the capability-lease flow (`volt grant` / `volt revoke`).
- **`src/cli/conformance-errors.ts`** — Negative paths: ordering mistakes (push before init etc.), bridge unreachable, mismatched binding, the reconcile case (drift + dirty), and the no-op (`nothing to push`). Each scenario asserts the error message is friendly enough to be actionable, not just "Cannot read property of undefined."
- **`src/tools/conformance.ts`** — MCP wiring: tool registration, schemas, structured response shapes including the `incoming` / `outgoing` / `availableCapabilities` / `nextAction` / `summary` fields the AI relies on. Covers the AI-side `dryRun` parameter and the asymmetric-force enforcement (M08: `force` without a lease MUST be refused with `status: force_unauthorized` and the engine must not be invoked).

**A new bridge is "done" when it passes the conformance suite.** That's the contract — not a TS interface, not a doc, the test pack itself. If conformance goes green against your bridge, the `volt` CLI, the MCP server, and any future client will work against it without changes on their side.

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
npm test                                            # unit tests (vitest, against TestBridge)
node dist/cli/conformance.js                        # live CLI conformance (requires bridge + IDE)
node dist/tools/conformance.js                      # live MCP conformance (requires bridge + IDE)
```

The C# bridge has its own xUnit suite at `bridges/beckhoff/BeckhoffBridge.Tests/`. C# tests + TS unit tests + CLI conformance + MCP conformance all run independently of each other — failures in one don't mask the others.
