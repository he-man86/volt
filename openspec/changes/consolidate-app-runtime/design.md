# Design — consolidate the app runtime + storage

## 1. Current runtime topology (what actually runs)

Two worlds joined over HTTP. This is the load-bearing structure — read it before proposing to "merge processes."

```
        AGENT WORLD (bun / JS)                         PLC WORLD (.NET)
  ┌───────────────────────────────┐          ┌──────────────────────────────────┐
  │ frontend (ONE active):        │          │ connector  VoltConnector.exe      │
  │  • Electron GUI  Volt.exe      │  HTTP    │  (always-on tray gateway,         │
  │  • terminal TUI  volt.exe      │ 8555/6   │   start-at-login, supervises)     │
  │  • editor ext (VS Code/…)      │◀────────▶│   ├─ CODESYS bridge  net48 DLL    │
  │        │ spawns/embeds         │          │   │   loaded IN-PROC by the IDE   │
  │        ▼                        │          │   └─ TwinCAT bridge  net8 exe     │
  │ opencode server (agent backend)│          │       standalone, COM-attach      │
  │ LSP  volt-lsp-iec.exe (per ed.)│          └──────────────────────────────────┘
  └───────────────────────────────┘
```

| Process | Runtime | Lifetime | Why it's separate |
|---|---|---|---|
| Frontend (GUI / TUI / ext) | Electron / bun / editor | user session | the three UIs a user picks between |
| opencode server (sidecar) | bun | per frontend | opencode's backend; desktop spawns it, CLI embeds it |
| LSP (`volt-lsp-iec`) | bun | per editor session | standard LSP client-spawns-server |
| **connector** | .NET (net8) | **always-on** | the ONE shared bridge gateway — reachable by ext/CLI without the GUI |
| CODESYS bridge | .NET (net48) | with the IDE | must load in-process (reflection object model, any 3.5.x) |
| TwinCAT bridge | .NET (net8) | with the connector | must be a process that COM-attaches to TwinCAT |

**Why the boundaries are correct (and we will NOT change them):**
- The bridges MUST be .NET — they live on IDE COM / reflection. bun/node cannot host that. So the bun↔.NET HTTP
  seam is fundamental, not sprawl.
- The connector MUST be able to run without any GUI (the extension and CLI need the bridge). So it is a separate,
  shared, long-lived process by necessity — a single gateway, not per-frontend spawns.
- The terminal CLI MUST run headless — it can't be the Electron app. So `volt.exe` standalone is justified.
- opencode's server model (single-instance per frontend) is upstream and reused — out of scope to restructure.

**Honest conclusion:** the process *count* is mostly justified. The maintainability pain is NOT the topology —
it is that the Volt layer's **storage, update path, and branding were never unified**, and the model is
undocumented. That is what this change fixes.

## 2. The scatter (from the on-disk audit)

| Location | Size | Owner | Problem |
|---|---|---|---|
| `~/.local/share/opencode` | ~900 MB | opencode | session DBs + snapshots, unbounded, no prune |
| `~/.config/opencode`, `~/.cache/opencode` | 48 + 116 MB | opencode | home-XDG on Windows; separate from everything Volt |
| `%APPDATA%\ai.opencode.desktop` | 31 MB | Electron | userData under an **opencode** appId — branding leak |
| `%APPDATA%\ai.opencode.desktop.dev` | 436 MB | Electron | stale dev-channel userData |
| `%LOCALAPPDATA%\@opencode-aidesktop-updater` | 231 MB | electron-updater | opencode-named, malformed, likely stale |
| `%LOCALAPPDATA%\volt-updater` | 228 MB | Volt updater | second updater cache — redundant |
| `%LOCALAPPDATA%\Volt\logs` | small | VoltLog | ✅ already the one consolidated log store |
| `%LOCALAPPDATA%\volt-bridge`(+`-new`) | ~1 MB | old bridge | stale pre-consolidation dirs |

Three brand namespaces (`opencode`, `Volt`, `ai.opencode.desktop`), two updater caches, unbounded session
growth, stale per-channel dirs. Uninstall leaves almost all of it behind.

## 3. Target design — "two worlds, one install, one data root, one updater"

**Single data root** — everything Volt-owned under one tree:

```
%LOCALAPPDATA%\Volt\
  data\        ← XDG_DATA_HOME  (opencode session DBs, snapshots, auth)
  config\      ← the bundled OPENCODE_CONFIG_DIR view (read-only agent config)
  cache\       ← XDG_CACHE_HOME (downloaded binaries, model catalog)
  state\       ← XDG_STATE_HOME (locks)
  logs\        ← VoltLog (already here)
  updater\     ← the ONE electron-updater cache
  desktop\     ← Electron userData (was %APPDATA%\ai.opencode.desktop)
%LOCALAPPDATA%\Programs\Volt\   ← the read-only install bundle (unchanged)
```

Set by the launchers (existing seams): the `volt` binary launcher and the desktop `main/index.ts` already set
`OPENCODE_CONFIG_DIR` + `XDG_STATE_HOME`; extend both to set `XDG_DATA_HOME` / `XDG_CACHE_HOME` (and override
Electron `userData`) under the Volt root. Purely additive env-setting; no opencode-core change.

Result: **one tree to inspect/debug/clean; uninstall removes exactly `%LOCALAPPDATA%\Volt` + `Programs\Volt`;**
the `ai.opencode.desktop` branding leak disappears (its data now lives under `Volt\desktop`) **without changing
the appId** (so no OS-integration / update-identity migration).

**Single update path** — the install is one bundle, so one updater replaces it whole: the desktop
electron-updater against Volt's feed. Disable the opencode in-sidecar self-updater for the installed product
(the desktop already silences it; make the CLI launcher do the same, since it's the same install). One
Volt-named updater cache under `Volt\updater`.

**One documented gateway** — the connector stays THE single shared always-on gateway; document its lifecycle
and the two-worlds model (this design.md becomes the reference). Assert (test) that no frontend spawns a bridge
directly — all attach via port discovery.

**Clean lifecycle** — uninstall wipes all Volt data + stale per-channel dirs; a new `volt maintenance` (or
`volt clean`) command prunes session/snapshot growth and prints per-store disk usage (so the ~900 MB creep is
visible and reclaimable without hand-deleting SQLite files).

## 4. What we deliberately do NOT do

- **Do not merge the connector into the opencode server.** bun cannot host the IDE COM/reflection; the .NET↔bun
  split is required.
- **Do not fold `volt-git` into the bridge.** `volt-git` is the on-demand CLI **client** of the bridge wire (it
  owns the git repo, file materialization, `git merge`, and the agent `volt` tool); the bridge is the C#
  **server** exposing the live IDE. They sit on opposite sides of the HTTP wire on purpose: `volt-git` runs where
  the repo/agent are — possibly a *different machine* than the IDE — so merging them would weld the git repo to
  the IDE host and move git/fs orchestration into the wrong language. The wire is also the vendor-parity boundary,
  which a thin neutral client gives for free. The TS↔C# wire-type mirror (`bridge/types.ts` ↔ the C# DTOs) is a
  **versioned contract** (`WIRE_VERSION` lockstep, guarded by `check-volt-integration.ts`), not drift; if DRY
  matters, generate one side from the other rather than merge the packages. And `volt-git` is a transient CLI,
  not a daemon — it is not part of the process/storage sprawl this change targets.
- **Do not restructure opencode's server / session / snapshot model.** Reused upstream; out of scope. (The
  unbounded-growth is an opencode concern; we surface + prune it, we don't fork it.)
- **Do not change process boundaries.** They are justified above.
- **Do not rebrand the Electron `appId`.** Redirecting userData under the Volt root solves the visible scatter;
  changing the appId would orphan installs/update identity for no added benefit.

## 5. Open decisions (recommendation in **bold**)

> **DECIDED (user, this session): Option B for branding.** The opencode-branded *data* dirs are acceptable as an
> internal detail (especially the CLI). The one firm requirement is that the **functional toolchain — config +
> LSP + `volt` CLI — ships via our installer** (already met + verified). So the full data-dir redirect (D1/D4) is
> **demoted to nice-to-have**, and D5 (migration) is moot. What stays firm/valuable and branding-independent:
> **one update path + one cache (D2), tame the unbounded session/snapshot growth, document the runtime model, and
> the shared hygiene** (dedupe caches, delete stale dirs). See §8 — the backend may still add a connector, so the
> process inventory is NOT final.


- **D1 — redirect scope.** Redirect ALL opencode XDG (data/config/cache/state) under the Volt root **[recommended]**,
  vs. only unify the Volt-specific dirs and leave opencode on home-XDG. Recommended: full redirect → one tree,
  clean uninstall, isolation from any stock-opencode the user runs.
- **D2 — single updater.** Disable the opencode in-sidecar self-updater for the installed product and update only
  via electron-updater **[recommended]**, vs. keep both. Recommended: one path, one cache.
- **D3 — connector lifetime.** Keep always-on (warm shared gateway) **[recommended]**, vs. idle-shutdown after N
  minutes with on-demand relaunch. Recommended: keep always-on; revisit if idle overhead is measured to matter.
- **D4 — appId.** Keep `ai.opencode.desktop`, move its userData under the Volt root **[recommended]**, vs. mint a
  Volt appId + migrate. Recommended: keep — the redirect already removes the visible leak.
- **D5 — migration.** On first post-change run, migrate existing `~/.local/share/opencode` +
  `ai.opencode.desktop` into the Volt root, vs. **one-time reset** (fresh dirs; user re-auths, loses old
  sessions) **[recommended for now, since we just wiped]**. Recommended: reset now, add migration only if real
  users have data to preserve at ship time.

## 6. Phasing

1. **Storage redirect** (D1/D4) — launcher + desktop env seams point all dirs under `%LOCALAPPDATA%\Volt`; verify
   a fresh install writes only there.
2. **Update unification** (D2) — one electron-updater cache under the Volt root; disable the self-updater in the
   installed product; verify one cache, one prompt.
3. **Clean lifecycle** — uninstall wipes the Volt tree + stale per-channel dirs; add `volt clean`/usage report.
4. **Document + guard** — land this two-worlds model as the reference; add a test asserting no independent bridge
   spawn and that a fresh run creates exactly the expected tree.

## 7. Governing principle, the full dir map, and the A/B choice

**Principle:** *Volt owns the **surface** — brand, data location, updater feed, product identity — through
**seams**; Volt reuses opencode's **core** (agent, server, GUI, session/DB/snapshot model) **unchanged and
tracked**. No core fork, ever. The only open question is how far the seam branding goes (A vs B below).*

### The single root cause
Every opencode-branded dir traces to ONE core line — `packages/core/src/global.ts:10` → `const app =
"opencode"` — which, with `xdg-basedir`, produces `data/config/cache/state` under `…/opencode`. It is core; we
never edit it. We override it ONLY via env (`XDG_*_HOME`, `OPENCODE_CONFIG_DIR`) — a seam, set in the launchers.

### Full dir map + who decides each (the opencode-interaction points)

| Dir | Decided by | Override seam | Today | Branded |
|---|---|---|---|---|
| data (sessions/snapshots/auth) | core `app="opencode"` → `XDG_DATA_HOME` | `XDG_DATA_HOME` (launcher) | `~/.local/share/opencode` | opencode |
| config | core, or `OPENCODE_CONFIG_DIR` | `OPENCODE_CONFIG_DIR` (both launchers already set it) | bundled `volt-config` | **Volt ✓** |
| cache (binaries/models) | core → `XDG_CACHE_HOME` | `XDG_CACHE_HOME` (launcher) | `~/.cache/opencode` | opencode |
| state (locks) | core → `XDG_STATE_HOME` | `XDG_STATE_HOME` (desktop sets it; CLI doesn't) | `~/.local/state/opencode` / userData | mixed |
| Electron userData | electron `appId` = `ai.opencode.desktop` | `app.setPath("userData", …)` (desktop) | `%APPDATA%\ai.opencode.desktop` | opencode |
| updater cache | electron-builder, from `appId` | `updaterCacheDirName` (electron-builder) | `@opencode-aidesktop-updater` + `volt-updater` | mixed |
| updater FEED | electron-builder `publish` | — | `he-man86/volt` | **Volt ✓** |
| bridge/connector logs | `VoltLog` (C#, Volt-owned) | — | `%LocalAppData%\Volt\logs` | **Volt ✓** |
| install bundle | our NSIS (`productName: Volt`) | — | `%LocalAppData%\Programs\Volt` | **Volt ✓** |

**4 are already Volt** (config, logs, install, feed); **5 are still opencode** (data, cache, state-CLI, userData,
updater-cache) — and all 5 are reachable by an env/config seam, no core edit.

**Shared hygiene (both options need this, do regardless):** collapse the two updater caches to one; delete stale
`ai.opencode.desktop.dev` (436 MB), `volt-bridge*`, and the orphan updater cache. Pure win, no design commitment.

### Option A — own the surface (finish the 5 seams)  [= what this change proposes]
Add the missing overrides in the two launcher seams that already exist:
- `volt-git/src/volt.ts` (CLI launcher — already sets `OPENCODE_CONFIG_DIR`/`PATH`/`VOLT_UPDATE_REPO`): also set
  `XDG_DATA_HOME`/`XDG_CACHE_HOME`/`XDG_STATE_HOME` → `%LocalAppData%\Volt\{data,cache,state}`.
- `desktop/src/main/index.ts` (already sets `XDG_STATE_HOME`/`OPENCODE_CONFIG_DIR`): add data/cache + override
  `userData` → `%LocalAppData%\Volt\desktop`.
- `electron-builder.config.ts`: set `updaterCacheDirName` → a Volt cache under the Volt root.
- disable the opencode in-sidecar self-updater for the installed CLI too (desktop already does).

→ **100% Volt dirs, 0% core fork**, our installer + our feed, uninstall removes one tree. Cost: ~4 seam edits
(all in already-seamed files) + a migration decision (D5). This is the principle, done.

### Option B — rely on opencode's distribution, brand only what's seen (still via our installer)
Keep our NSIS wrapper + our updater feed (both exist), but do **not** redirect the data dirs. Treat opencode's
dir layout as an internal detail the user doesn't look at; brand only the visible surface (app name, logo, tray,
installer — already done). Do the shared hygiene, skip the XDG/userData redirect.

→ **~0 new seams** (just cleanup); always inherits opencode's install/update behaviour verbatim. Cost: near
zero. **Tradeoff:** the "Volt install / opencode data" split stays — `~/.local/share/opencode`,
`%APPDATA%\ai.opencode.desktop` — so uninstall still leaves opencode data behind, and a support/curious user
sees "opencode" in paths. For a commercial product that's a papercut, not a blocker.

### Honest read + recommendation
- **Neither option is a full fork** — both keep core untouched + tracked. The only variable is how far seam
  branding reaches.
- **A** is the principle done properly (coherent product, clean uninstall) for a small, already-seamed cost.
- **B** is "do less now" — defensible if the data-dir brand is deemed invisible enough, but it *preserves the
  exact inconsistency that prompted this* and keeps uninstall leaky.
- **Recommend A**, but do the shared **hygiene first** (it's pure win and B needs it too). Fall back to B only if
  the migration (D5) proves costly with real user data at ship time.
  _(Update — user picked **B**: functional toolchain via our installer is the firm bar and is met; data-dir
  branding is nice-to-have. Scope narrows to the hygiene + one-updater + growth + docs.)_

## 8. Open: the backend/cloud model may add a connector (do NOT finalize the process inventory)

The §1 topology is the **current local** shape (agent + connector + IDE all on the engineer's machine). The
hosted/commercial backend (`monetization` / `deploy-revenue-cloud`) is **not yet scoped**, and it forks the
process model on one axis — **where the agent runs**:

- **Local-first (desktop/CLI install)** — agent + connector local; the cloud is *just endpoints* the local agent
  calls (Zen gateway for metered models, console for billing/auth). **No extra connector** — HTTP the agent
  already speaks. This is the natural fit for a PLC tool (the IDE is local anyway) and needs nothing new here.
- **Cloud/web agent (thin client, no local install)** — the agent runs in the cloud but the IDE is still local,
  so it needs a **new local relay/tunnel connector** that exposes the customer's local bridge to the cloud agent
  (reverse tunnel). This is a genuinely new long-lived component.

**Consequence for this change:** the "one shared PLC gateway" requirement is scoped to the LOCAL topology; the
process inventory is explicitly NOT declared final. If the hosted product goes cloud/web-agent, a bridge-tunnel
connector is added there and folded into the model then. The storage/updater/growth/docs work in this change is
backend-independent and safe to do now; the *process-model lock* waits on the backend decision.

## 9. Coexistence with a separately-installed stock opencode

Two parts; only one collides.

- **Desktop shell — SAFE.** Volt's `appId` is `dev.volt.desktop` (its own), distinct from opencode's
  `ai.opencode.desktop`. userData, single-instance lock, `volt://` protocol, and updater identity are all
  distinct, so both desktops coexist. (The `ai.opencode.desktop*` dirs on disk are STALE from an old appId — a
  hygiene target, not a live conflict.)
- **Agent data — COLLIDES.** opencode core resolves its data dir from the hardcoded `app = "opencode"`, and Volt
  does not redirect `XDG_DATA_HOME`, so Volt (CLI **and** the desktop sidecar) writes into the SHARED
  `~/.local/share/opencode`. `auth.json` / `account.json` are NOT channel-keyed → **login collision** with stock
  opencode; session DBs are channel-filename-isolated (`opencode-volt.db` vs `opencode.db`) so usually safe but
  fragile; config is safe (overridden by `OPENCODE_CONFIG_DIR`); cache/state shared but low-risk.

**Reclassification:** the `XDG_DATA_HOME` redirect is therefore an **isolation** fix, not just branding — it kills
the auth/session collision with stock opencode (and brands the dir as a bonus). It graduates from "nice-to-have"
to **worth doing for correctness IF the audience may also run stock opencode** (developer-users: yes; pure
PLC-engineer audience: unlikely). Cost is one env line per launcher. This is the highest-value slice of Option A;
the rest of Option A (cache/state/userData redirect) stays cosmetic. **DECIDED (user): do it (the YES path) — the
safety net is cheap and audience-independent. See §10.**

## 10. Isolation plan (the YES path — do the `XDG_DATA_HOME` redirect)

Goal: Volt's agent data (sessions, **auth**, snapshots) never shares files with a separately-installed stock
opencode, and the Volt CLI + desktop share **one** Volt identity. Achieved purely by setting XDG env in the two
existing launcher seams — no opencode-core change.

**Target layout** (opencode appends its own `opencode/` under each XDG root):
```
%LocalAppData%\Volt\data\opencode\   ← sessions DBs, auth.json, account.json, snapshots   (XDG_DATA_HOME)
%LocalAppData%\Volt\state\opencode\  ← locks                                              (XDG_STATE_HOME)
%LocalAppData%\Volt\cache\opencode\  ← downloaded binaries, model catalog                 (XDG_CACHE_HOME)
```

**Step 1 — CLI launcher** (`volt-git/src/volt.ts`, right beside the existing `OPENCODE_CONFIG_DIR`/PATH block):
```ts
const voltRoot = join(process.env.LOCALAPPDATA ?? homedir(), "Volt")
process.env.XDG_DATA_HOME  ??= join(voltRoot, "data")   // isolates auth + sessions — the critical one
process.env.XDG_STATE_HOME ??= join(voltRoot, "state")
process.env.XDG_CACHE_HOME ??= join(voltRoot, "cache")
```
`??=` so an explicit user override still wins.

**Step 2 — Desktop** (`main/index.ts`, for the sidecar — the same three vars, same `voltRoot`), so the desktop's
opencode server and the CLI resolve to the **same** Volt data root → one login, one session history across both.
(Today it only redirects `XDG_STATE_HOME`→userData; switch that to the Volt root and add DATA/CACHE. The pattern
is proven — it already redirects STATE.)

**Step 3 — Guard.** Confirm nothing in opencode core reads `~/.local/share/opencode` bypassing XDG (grep for a
hardcoded `homedir()/.local/share`; `Global.Path` is the canonical source, so this should be clean — verify).

**Step 4 — Migration.** None needed now (data was just wiped; user re-auths once into the Volt root). At ship,
decide: one-time move of an existing `~/.local/share/opencode` into `Volt\data\opencode`, or accept a re-login.

**Step 5 — Verify coexistence.** Fresh Volt run writes only under `%LocalAppData%\Volt\data`; then install stock
opencode too, log into both, and confirm the two `auth.json` files are separate and neither clobbers the other.

**Bonus:** this also delivers the data-dir branding (`Volt\data\opencode` instead of `~/.local/share/opencode`),
so the only remaining opencode-named path is the internal `opencode\` leaf under the Volt root — invisible and
harmless.

### Honest downsides (all minor, none blocking)
1. **Env-before-core-init is load-bearing (the one real trap).** `Global.Path` is computed when opencode core is
   *imported*, so `XDG_DATA_HOME` MUST be set **before** core loads, or the redirect silently no-ops (data goes to
   the default). In the CLI launcher it's set at the very top (before requiring the runtime); in the desktop the
   sidecar is a separate spawned process, so it inherits the env at spawn — safe. Mitigation: a startup assertion
   that the resolved data dir is under the Volt root, so a regression fails loudly instead of silently.
2. **One-time re-auth / migration for existing installs.** After the switch, Volt reads the (empty) Volt root →
   users re-login once and lose old session history unless we migrate `~/.local/share/opencode` → `Volt\data`.
   Moot now (we wiped); a ship-time decision (§10 step 4). Minor, one-time.
3. **`??=` vs `=`.** `??=` respects a user who set `XDG_DATA_HOME` themselves — but then isolation isn't
   *guaranteed*. On Windows almost nobody sets it, so `??=` is fine; use `=` only if we need a hard guarantee.
4. **Orphaned old dirs + a cache re-download.** The old `~/.local/share/opencode` (auth leftovers) and
   `~/.cache/opencode` become unused; opencode re-downloads its binary/model cache once into the new root. The
   hygiene tasks already sweep these — no lasting cruft.
5. **Slight divergence from opencode's default path.** A *raw* `opencode` tool run against Volt's data would look
   in the wrong place — but `volt`'s own tooling resolves correctly (it sets the env). Negligible.

Net: the only thing to get *right* is downside #1 (env timing) — and the desktop already proves the pattern by
redirecting `XDG_STATE_HOME` today. Everything else is one-time or cosmetic.
