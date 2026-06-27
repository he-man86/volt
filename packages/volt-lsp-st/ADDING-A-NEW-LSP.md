# Adding a new Volt LSP (and verifying it actually loads)

How to add a second/Nth language server to Volt (e.g. `volt-lsp-ladder`) **and** how to
prove it loads inside opencode. This package, `volt-lsp-st`, is the template.

> Verified **empirically** against the codebase 2026-06-25 — `bun volt-scripts/verify-lsp.ts`
> passes (it drives opencode's own `debug lsp` and gets `source: "volt-lsp-st"` diagnostics
> back). If a step here contradicts the code, trust the code and fix this doc.

---

## How opencode loads the LSP (the one rule that matters)

opencode **registers** every LSP from its merged config (Volt's lives in the additive
`.opencode/opencode.json` — see §2), but **spawns** it *lazily* — only when you open a
file whose extension matches, and only then does the real failure mode appear:

- It spawns the server with **`cwd = the project directory`** (`packages/opencode/src/lsp/lsp.ts:175-181`;
  the project dir is `--directory` ?? `process.cwd()`, `packages/opencode/src/cli/effect-cmd.ts:86`).
- Our `command` path is **repo-root-relative** (`./packages/volt-lsp-st/dist/bin.js`), so it
  only resolves when **opencode's project dir is the volt monorepo root**. Resolve it from
  the wrong dir and `node` gets an ENOENT and the server dies **silently** (exit 0, no log).

Two things make this look like a config bug when it isn't:

1. **"enabled" ≠ "running".** The startup log line `enabled LSP servers: …, volt-lsp-st`
   means *registered*, not *spawned*. Registration always succeeds; the spawn is where a
   bad cwd bites.
2. **Bare bin names don't work here.** The [official docs](https://opencode.ai/docs/lsp/)
   example uses `["custom-lsp-server","--stdio"]` (PATH lookup), but opencode does **not**
   add `node_modules/.bin` to PATH (`packages/opencode/src/util/process.ts`), and bun on
   Windows doesn't create `.bin` shims for private workspace packages. So we **must** use a
   path, not a bin name.

The bin **must** route `--stdio` to the server — opencode only ever spawns with `--stdio`
(`src/bin.ts:36`). Without it the server starts and does nothing.

---

## Running it — launch matrix

The single rule: **opencode's project dir must be the built monorepo root.**

| Surface | How to launch | Why |
|---|---|---|
| **CLI / TUI (from source)** | `bun volt-scripts/dev.ts` | passes repo root as the project dir so the relative LSP path resolves |
| ~~`bun run dev`~~ | **broken** | forces `--cwd packages/opencode` → relative path resolves one level too deep → silent fail. Can't be fixed at source: `package.json` is outside the fork's 6 allowed seams |
| **Desktop (from source)** | `bun run dev:desktop`, then **open the monorepo root** as the project folder | desktop runs the *same* opencode server; per-request `directory` = the opened folder, so the relative path resolves |
| **End-user (their own PLC project)** | n/a yet | a repo-relative path is meaningless outside this repo — `volt init` should write an **absolute** path to the installed LSP. Productization gap, not built yet |

**Pitfall — duplicate checkouts.** If you have the repo checked out twice (e.g. a
OneDrive-synced copy), only the one with `packages/volt-lsp-st/dist/` built will load the
LSP. Launch from the built checkout.

---

## Verifying it actually loaded

Three ways, cheapest first:

**1. One command (recommended):**

```bash
bun volt-scripts/verify-lsp.ts
```

It guards that `dist/bin.js` is built, writes a deliberately-malformed `.st`, runs opencode's
`debug lsp diagnostics` against it from the repo root, and PASSes only if diagnostics tagged
`source: "volt-lsp-st"` come back. (A clean file yields `{}` — indistinguishable from "not
loaded" — so the sample plants a parse error + an undeclared identifier on purpose.)

**2. By hand** — opencode ships a non-interactive LSP debugger
(`packages/opencode/src/cli/cmd/debug/lsp.ts`); `diagnostics` calls `touchFile` (the exact
lazy-spawn trigger) then prints JSON:

```bash
# from the repo ROOT (project dir = cwd):
bun --conditions=browser packages/opencode/src/index.ts debug lsp diagnostics path/to/file.st
# loaded  -> JSON with "source": "volt-lsp-st"
# not loaded -> {}    (run the same from packages/opencode to see this silent failure)
```

**3. Live server** — `opencode serve` (unsecured on localhost) exposes
`GET /instance/lsp` (`packages/opencode/src/server/.../handlers/instance.ts:88`,
`lsp.ts:315-327`). It lists **only successfully-connected** servers, so `volt-lsp-st` in the
list = loaded, absent = not. Pass the project dir via the `x-opencode-directory` header.

---

## 1. Create the package

Use this package (`packages/volt-lsp-st/`) as the template. Required files:

```
packages/volt-lsp-<lang>/
├── package.json          name: @opencode-ai/volt-lsp-<lang>   (this package is @opencode-ai/volt-lsp)
│                          bin: { "volt-lsp-<lang>": "./dist/bin.js" }
│                          scripts.build + scripts.prepare = "tsc"
├── tsconfig.json
├── src/
│   ├── bin.ts            #!/usr/bin/env node — must route --stdio to the LSP server (see above)
│   ├── lsp/server.ts     LSP 3.17 JSON-RPC over stdio
│   ├── init.ts           runInit() — copies the corpus + writes SKILL.md into a consumer project
│   └── tests/unit/init.test.ts
└── docs/
    └── <lang>-reference/
        ├── 00-index.md
        └── ...           reference markdown files (this is what gets installed downstream)
```

## 2. Wire it into opencode

Add an entry to **`.opencode/opencode.json`** next to the existing `volt-lsp-st` — Volt's
additive config layer, which opencode deep-merges over upstream's pristine `opencode.jsonc`.
**Never edit the `.jsonc`** — that reintroduces an upstream seam (see CLAUDE.md "Fork surface").
Use a repo-root-relative **path** (not a bin name; see "How opencode loads the LSP" above):

```json
"lsp": {
  "volt-lsp-st": { ... },
  "volt-lsp-<lang>": {
    "command": ["node", "./packages/volt-lsp-<lang>/dist/bin.js", "--stdio"],
    "extensions": [".<ext>"]
  }
}
```

Then verify it the same way: extend `volt-scripts/verify-lsp.ts` (or run `debug lsp
diagnostics` by hand) against a `.<ext>` file.

## 3. Ship the language reference (corpus + skill)

The skill is **not** a file committed under `.claude/skills/`. It is generated into the
*consumer's* project at `volt init` time:

- The **corpus** lives in this package at `docs/<lang>-reference/` and is published via
  `package.json` `files: ["dist", "docs"]`.
- The **SKILL.md** is a canonical template built in code — see `buildSkillMd()` in `src/init.ts:52`.
- `runInit()` (exported as `installCorpus`, `src/index.ts:61`) copies the corpus and writes
  SKILL.md into the consumer project at `.claude/skills/<lang>-reference/`.

`.claude/skills/` (not `.opencode/skills/`) is deliberate: it's the universal location both
opencode and Claude Code discover. See the rationale comment at `src/init.ts:18`.

For a new LSP: add a `docs/<lang>-reference/` corpus and a `buildSkillMd()` template in your
package's `init.ts`. Don't hand-author a committed skill file.

## 4. Install hook for downstream users

`volt init` installs the corpus by calling `installCorpus` (= this package's `runInit`). The
call site is `packages/volt-git/src/init.ts` — `tryInstallCorpus()` invokes `installCorpus`
imported from `@opencode-ai/volt-lsp`.

Today it installs from this one package. For multiple LSPs, `tryInstallCorpus` needs to fan
out — install the corpus from every Volt LSP package present in `node_modules`. Refactor
`packages/volt-git/src/init.ts` when you add the second LSP; premature now.

## 5. Update the Volt agent prompt

`.opencode/agent/volt.md` should mention the new language briefly so the agent knows to use
the LSP and load the skill for relevant files.

## 6. Run the integration check

```
bun volt-scripts/check-volt-integration.ts
```

It currently hard-codes paths to `volt-lsp-st` only. Extend it to check the new LSP's bin and
skill template too — a few lines per LSP.

## 7. Documentation

Add a "Using with opencode" section to the new LSP's README mirroring
`packages/volt-lsp-st/README.md`. Include the command path and the skill-discovery note.

## Per-LSP estimate

3–5 hours for a new LSP if the reference corpus already exists. Most time is the parser + LSP
handlers, not the integration plumbing (~15 minutes following this recipe).

## What to NOT do

- **Don't** modify `packages/opencode/`. Integration is config-only — that's the
  upstream-safety contract (see CLAUDE.md's fork-seams rule).
- **Don't** rely on `node_modules/.bin` symlinks or bare bin names in the LSP command — use a
  path (step 2).
- **Don't** commit a `.claude/skills/` file in the repo. The skill is generated into consumer
  projects by `init.ts` (step 3).
- **Don't** add a CLAUDE.md section in `init.ts`. We ship the reference via Skills, not CLAUDE.md.
- **Don't** add a per-LSP agent persona unless the workflow genuinely differs. The single
  `volt` agent in `.opencode/agent/volt.md` covers all languages — extend its tools list instead.
