# Unify the agent-facing Volt config behind one shipped `OPENCODE_CONFIG_DIR`

## Why
Volt registers its agent-facing pieces by **four different mechanisms** (mapped in `design.md`): declarative `opencode.json` entries (LSP, bash-permission), auto-scanned files (`tool/*.ts`, `agent/*.md`, `themes/*.json`), a separate `.claude/skills/` scan, and runtime `ctx.ask`. Worse, they split into **dev-repo-only** (agent, theme, permissions — a real PLC project never receives them) vs **consumer-generated** (LSP, tool, skills).

The **LSP is the fragile outlier**: it's the only capability registered by an **absolute, machine-specific, gitignored path baked at `volt init`**. So "the LSP didn't load" is almost always *that project wasn't `init`'d*, the session opened a dir without the generated config, or the path went stale after an app update. The tool adds a second failure: a runtime `bun/npm install` of `@opencode-ai/plugin` that corporate **proxies break**.

## What Changes
opencode already supports **`OPENCODE_CONFIG_DIR`** (`config/flag.ts:63`, consumed at `config/config.ts:417`+`:424`): an env-pointed dir opencode treats as a **full `.opencode`-equivalent** — it loads that dir's `opencode.json` *and* scans its `tool/`, `agent/`, `command/`, `plugin/`, and theme, merging all of it into the running config. Proven: `config.ts:423` loops every config dir; `:424` gates the OPENCODE_CONFIG_DIR dir into the same `.opencode` treatment.

So: **ship ONE Volt-owned `volt-config/` dir with the app** and have the desktop sidecar + the CLI launcher set `OPENCODE_CONFIG_DIR` to it. That registers the **LSP + tool + agent + theme + permissions globally, for every project, guaranteed read, zero `volt init`.**

- LSP entry → a **bare-name** command `["volt-lsp-codesys","--stdio"]` resolved off PATH (the installer already adds `resources/volt/bin`). No absolute/stale path. *(Fallback: the desktop writes the dir at first-run with the resolved absolute path — see design.)*
- `@opencode-ai/plugin` → **vendored** into `volt-config/node_modules` (its runtime closure is just `zod`; `effect`/`sdk`/`ai-sdk` are `import type`, erased). No registry install.
- `volt init` shrinks to the genuinely per-project bits: the `.git/volt` IDE binding + the vendor-specific `.claude/skills/`.

## Impact
- **Reliability:** opening any `.st` in the Volt desktop just works — no init, no path baking, no npm.
- **Consistency:** one registration surface for the whole agent toolchain (supersedes the `harden-opencode-integration` Step-0 plugin-vendoring task).
- **Consumers gain** the agent + theme they never received.
- **Seam cost:** the desktop already controls the sidecar spawn env (`server.ts` `preferAppEnv`) — setting one env var is additive, no new opencode-source edit beyond the existing IPC seam.
