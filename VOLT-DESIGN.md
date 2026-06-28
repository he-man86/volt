# Volt — design

Volt is a **white-label of opencode**: an AI agent for IEC 61131-3 PLC work (CODESYS / TwinCAT), sold as a SaaS.

## The one rule

> Own what's purely Volt's; reuse + keep in sync what *is* the product. Never *edit* an upstream
> file's contents — only *add* sibling files, *register* through a hook, or insert a *one-line mount*.

This keeps `git merge upstream/dev` near-trivial. The full surface + enforcement is the
`upstream-sync` capability.

## The design now lives in OpenSpec

Architecture, invariants, and the decision log moved into OpenSpec (validated, single source).
Browse with `openspec list` / `openspec list --specs`.

- **Capabilities (current truth)** → `openspec/specs/`: `upstream-sync` · `bridge-protocol` ·
  `ide-sync` · `language-server` · `vg-language` · `editor-surface` (+ `monetization`, forthcoming)
- **Roadmap / in-flight** → `openspec/changes/` (completed → `changes/archive/`)
- **Decision log (D1–D13, rationale + rejected alternatives)** → the archived `review-*` changes +
  `openspec/changes/.../retire-design-docs/design.md`
- **Per-package architecture** → each `packages/volt-*/README.md`
- **Fork guide** → `CLAUDE.md`
