# Adding a new Volt LSP

How to add a second/Nth language server to Volt (e.g. `volt-lsp-ladder` for Ladder Logic). This package, `volt-lsp-st`, is the template — follow these steps to keep the integration consistent.

> Verified against the codebase 2026-06-24. If a step here contradicts the code, trust the code and fix this doc.

## 1. Create the package

Use this package (`packages/volt-lsp-st/`) as the template. Required files:

```
packages/volt-lsp-<lang>/
├── package.json          name: @opencode-ai/volt-lsp-<lang>   (this package is @opencode-ai/volt-lsp)
│                          bin: { "volt-lsp-<lang>": "./dist/bin.js" }
│                          scripts.build + scripts.prepare = "tsc"
├── tsconfig.json
├── src/
│   ├── bin.ts            #!/usr/bin/env node — must route --stdio to the LSP server
│   ├── lsp/server.ts     LSP 3.17 JSON-RPC over stdio
│   ├── init.ts           runInit() — copies the corpus + writes SKILL.md into a consumer project
│   └── tests/unit/init.test.ts
└── docs/
    └── <lang>-reference/
        ├── 00-index.md
        └── ...           reference markdown files (this is what gets installed downstream)
```

**Critical:** the bin **must** route a `--stdio` argument to the LSP server. opencode only ever spawns with `--stdio`, so without it the LSP silently fails to start. See `src/bin.ts:36`.

## 2. Wire it into opencode

Add an entry to `.opencode/opencode.jsonc` next to the existing `volt-lsp-st`:

```jsonc
"lsp": {
  "volt-lsp-st": { ... },
  "volt-lsp-<lang>": {
    "command": ["node", "./packages/volt-lsp-<lang>/dist/bin.js", "--stdio"],
    "extensions": [".<ext>"]
  }
}
```

`command[0]` is **not** a bare bin name — opencode spawns it with `cwd = its project directory` and does not add `node_modules/.bin` to PATH (`packages/opencode/src/util/process.ts:66`; bun on Windows also doesn't create `.bin` symlinks for private workspace packages). So use a path.

The path is **repo-root-relative** (`./packages/.../dist/bin.js`), resolved against opencode's project directory. That means it only resolves when opencode runs with the **repo root** as its project dir. `bun run dev` launches with `--cwd packages/opencode`, so the relative path won't resolve there — launch opencode pointed at the repo root when developing the LSP.

## 3. Ship the language reference (corpus + skill)

The skill is **not** a file committed under `.claude/skills/`. It is generated into the *consumer's* project at `volt init` time:

- The **corpus** lives in this package at `docs/<lang>-reference/` and is published via `package.json` `files: ["dist", "docs"]`.
- The **SKILL.md** is a canonical template built in code — see `buildSkillMd()` in `src/init.ts:52`.
- `runInit()` (exported as `installCorpus`, `src/index.ts:61`) copies the corpus and writes SKILL.md into the consumer project at `.claude/skills/<lang>-reference/`.

`.claude/skills/` (not `.opencode/skills/`) is deliberate: it's the universal location both opencode and Claude Code discover. See the rationale comment at `src/init.ts:18`.

For a new LSP: add a `docs/<lang>-reference/` corpus and a `buildSkillMd()` template in your package's `init.ts`. Don't hand-author a committed skill file.

## 4. Install hook for downstream users

`volt init` installs the corpus by calling `installCorpus` (= this package's `runInit`). The call site is `packages/volt-cli/src/commands/init.ts` — `tryInstallCorpus()` (line 145) invokes `installCorpus` imported from `@opencode-ai/volt-lsp`.

Today it installs from this one package. For multiple LSPs, `tryInstallCorpus` needs to fan out — install the corpus from every Volt LSP package present in `node_modules`. Refactor `packages/volt-cli/src/commands/init.ts` when you add the second LSP; premature now.

## 5. Update the Volt agent prompt

`.opencode/agent/volt.md` should mention the new language briefly so the agent knows to use the LSP and load the skill for relevant files.

## 6. Run the integration check

```
bun volt-scripts/check-volt-integration.ts
```

It currently hard-codes paths to `volt-lsp-st` only. Extend it to check the new LSP's bin and skill template too — a few lines per LSP.

## 7. Documentation

Add a "Using with opencode" section to the new LSP's README mirroring `packages/volt-lsp-st/README.md`. Include the command path and the skill-discovery note.

## Per-LSP estimate

3–5 hours for a new LSP if the reference corpus already exists. Most time is the parser + LSP handlers, not the integration plumbing (~15 minutes following this recipe).

## What to NOT do

- **Don't** modify `packages/opencode/`. Integration is config-only — that's the upstream-safety contract (see CLAUDE.md's 5-seams rule).
- **Don't** rely on `node_modules/.bin` symlinks or bare bin names in the LSP command — use a path (step 2).
- **Don't** commit a `.claude/skills/` file in the repo. The skill is generated into consumer projects by `init.ts` (step 3).
- **Don't** add a CLAUDE.md section in `init.ts`. We ship the reference via Skills, not CLAUDE.md.
- **Don't** add a per-LSP agent persona unless the workflow genuinely differs. The single `volt` agent in `.opencode/agent/volt.md` covers all languages — extend its tools list instead.
