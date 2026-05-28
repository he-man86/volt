# Adding a new Volt LSP

How to add a second/Nth language server to Volt (e.g. `volt-lsp-ladder` for Ladder Logic, `volt-lsp-fbd` for Function Block Diagram). The pattern is established by `packages/volt-lsp-st`. Follow these steps to keep the integration consistent.

## 1. Create the package

Use `packages/volt-lsp-st/` as the template. Required files:

```
packages/volt-lsp-<lang>/
├── package.json          name: @opencode-ai/volt-lsp-<lang>
│                          bin: { "volt-lsp-<lang>": "./dist/bin.js" }
│                          scripts.build + scripts.prepare = "tsc"
├── tsconfig.json
├── src/
│   ├── bin.ts            #!/usr/bin/env node — must accept --stdio flag
│   ├── lsp/server.ts     LSP 3.17 JSON-RPC over stdio
│   ├── init.ts           runInit() — copies docs + writes SKILL.md
│   └── init.test.ts
└── docs/
    └── <lang>-reference/
        ├── 00-index.md
        ├── 01-...md
        └── ...           reference markdown files
```

**Critical:** the bin **must** route a `--stdio` argument to the LSP server. Without it opencode (which only spawns with `--stdio`) silently fails to start the LSP. See `packages/volt-lsp-st/src/bin.ts:35` for the pattern.

## 2. Wire it into opencode

Add an entry to `.opencode/opencode.jsonc` next to the existing `volt-st`:

```jsonc
"lsp": {
  "volt-st": { ... },
  "volt-<lang>": {
    "enabled": true,
    "command": ["node", "packages/volt-lsp-<lang>/dist/bin.js", "--stdio"],
    "extensions": [".<ext>"]
  }
}
```

Use absolute paths (`node packages/.../dist/bin.js`), not bare bin names — bun on Windows does not create `.bin` symlinks for private workspace packages.

## 3. Ship a skill

Create `.claude/skills/<lang>-reference/SKILL.md` at repo root (universal location: both opencode and Claude Code discover from there). Mirror `.claude/skills/st-reference/SKILL.md`:

```yaml
---
name: <lang>-reference
description: <one-line summary of the language and what the skill provides>
license: MIT
metadata:
  language: <language-id>
  source-package: "@opencode-ai/volt-lsp-<lang>"
---
```

Body: TOC pointing to `packages/volt-lsp-<lang>/docs/<lang>-reference/`, list the most-needed-first files. Don't embed docs inline — keep single source of truth in the LSP package.

## 4. Install hook for downstream users

Add a copy step to `packages/volt-agent/src/engine/init.ts` so that when end-users run `volt init`, the new corpus + SKILL.md is installed into their workspace. Currently `tryInstallCorpus` calls `installCorpus` from `@opencode-ai/volt-lsp-st`. For multiple LSPs, this needs to fan out — install corpus from every Volt LSP package present in node_modules. Refactor when you add the second LSP; premature now.

## 5. Update the Volt agent prompt

`.opencode/agent/volt.md` should mention the new language briefly so the agent knows to use the LSP and load the skill for relevant files. Add to the "Reactive language intelligence" or "Proactive language reference" sections.

## 6. Run the integration check

```
bun script/check-volt-integration.ts
```

It currently hard-codes paths to `volt-lsp-st` only. Extend it to check the new LSP's bin and SKILL.md too. Three new lines per LSP.

## 7. Documentation

Add a "Using with opencode" section to the new LSP's README mirroring `packages/volt-lsp-st/README.md:73+`. Include the absolute-path command and skill-discovery note.

## Per-LSP estimate

3–5 hours for a new LSP if the reference corpus already exists. Most time is in writing parser + LSP handlers, not the integration plumbing (which is ~15 minutes following this recipe).

## What to NOT do

- **Don't** add a CLAUDE.md section in `init.ts`. We removed that mechanism in favor of skills.
- **Don't** put SKILL.md in `.opencode/skills/` only — use `.claude/skills/` (universal: both tools read it).
- **Don't** add a per-LSP agent persona unless the workflow genuinely differs. The single `volt` agent in `.opencode/agent/volt.md` covers all languages — extend its tools list instead.
- **Don't** rely on `node_modules/.bin` symlinks. Use absolute paths.
- **Don't** modify `packages/opencode/`. Integration is config-only — that's the upstream-safety contract.
