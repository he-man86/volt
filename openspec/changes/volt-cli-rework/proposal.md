## Why

Owner 2026-10-16: once LD/FBD is fully implemented in the app (`ld-fbd-coverage` archived), rework every project in
`packages/volt-cli`. The toolchain grew through many changes — PLCopen transport removed, HTTP wire replaced by pipes,
volt-bridge + volt-git merged, network text rewritten twice — and the owner expects legacy code, hidden bugs and hidden
(undocumented) features to have accumulated, and code to sit in the wrong project.

## What Changes

A multi-agent workflow (owner opted in) over every volt-cli project — `Volt.Engine`, `Volt.Cli`, `Volt.Ide.Codesys`,
`Volt.Ide.Twincat`, the connector, `Volt.Contracts`, `scripts/`, and the test projects:

- **Placement.** Every piece of code lives in the project that owns its concern, not scattered: vendor-neutral logic in
  an IDE host moves to `Volt.Engine`; only irreducible vendor glue stays in a host (ARCHITECTURE.md). The asymmetries
  recorded in `Ide/DIALECT.md` are load-bearing and stay where they are.
- **Legacy.** Code, comments and docs serving removed designs or old formats are deleted (no users, no backward compat).
- **Hidden bugs.** Fallbacks that mask a broken state, silent defaults, untested branches — each found bug gets a
  failing test first, then the fix.
- **Hidden features.** Behaviour no doc or test states is either documented + tested, or deleted (owner decides).
- **Refactor or reimplement.** A project is refactored in place; one found to be a tangle is reimplemented — only with
  the owner's OK, behind the same tests.

Not implemented now: this change is a spec only until `ld-fbd-coverage` AND `multi-application-tree` close (2026-10-17:
the path-identity change reshapes the same wire, Sync and drivers — rework after it, not across it).

## Impact

All of `packages/volt-cli` (src, test, scripts, docs). The pipe wire stays byte-identical on both vendors (parity
boundary); a wire change is a separate owner decision. Starting input: the 2026-10-16 read-only simplify reviews
(`input/engine.md`, `input/cli-bridges.md`) minus what was already applied that day. `cli-bridges.md` section B (silent
fallbacks made loud, ~105 lines) and the "used to…" history-comment sweep need the owner's OK.
