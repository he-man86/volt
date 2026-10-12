## Why

The owner (2026-10-12), after the LSP quality rating (~8.5 once `lsp-server-scheduling` and `ld-fbd-coverage` land): the
largest gap left to production LSPs (rust-analyzer, tsserver, gopls) is **editor actions** — and "it doesn't make sense not
to do". Today the LSP finds problems with compiler-recorded precision but offers ONE quick fix
(`services/assist/code-actions.ts`, 47 lines: "Wrap in `TO_<type>(…)`" on a conversion warning). Every other diagnostic
leaves the user to fix it by hand.

Also measured first, not built blind: navigation breadth (workspace symbols depth, call hierarchy completeness, rename
across libraries). Not in scope: incremental parsing inside a file — the bench puts the largest POU at ~31 ms p50, so it
would add complexity for no visible gain (revisit only if a real project measures slow).

## What Changes

- **A census first:** every diagnostic code ranked by how often it fires on the six corpora and the recorded fixtures, with
  the edit a user makes to fix it; each classified as *mechanical* (one correct edit), *choice* (several correct edits —
  offer each), or *no fix* (needs judgement).
- **Quick fixes for the mechanical and choice codes, each PROVEN by the compiler:** applying the fix to its fixture must
  make CODESYS (and TwinCAT where the code applies) build that unit clean — recorded with `record:language`. A fix the
  compiler does not accept is not shipped. Typical candidates (decided by the census, not this list): declare an
  unresolved identifier (with its inferred type), "did you mean" for a near-miss name, the missing `END_*` or `;`, wrap or
  change a conversion, remove an unused variable, add a missing return assignment, fix a CASE label out of range.
- **Source actions:** organize the VAR sections (sort/merge, per the formatter's style) and "fix all of this kind in the
  file", where the census shows value.
- **One fix model:** a fix is data on the diagnostic (`DiagnosticItem.fixes`, produced by the check that reports it, so the
  fix and the finding cannot drift); `code-actions.ts` only renders them. The existing wrap fix moves onto it.
- **Breadth census and the cheap gaps:** workspace symbols, call hierarchy and rename measured against the corpora; gaps
  that are cheap fixed, the rest filed.

## Impact

`packages/volt-lsp-iec` (`analysis/` checks gain fixes, `services/assist/code-actions.ts`, conformance fixtures + recordings
for every fix). No bridge or wire change.
