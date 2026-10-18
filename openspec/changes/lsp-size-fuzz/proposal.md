## Why

PLC Assist crashed the LSP with input nobody typed (a stack overflow on deep nesting). The fix answers one `not-analysed`
error per such document (archived `lsp-deep-input-no-stack-overflow`); the suite still only feeds friendly input, so the
next crash of this kind is again found by a client.

## What Changes

Generated deep and long inputs in the LSP suite — nesting, flat chains, long files — sized from the measured limits
(Node 24: parentheses 3000, nested `IF` 1500, flat `+`/`OR` 5000; bun: parentheses overflow at 20000, not 5000;
corpus maxima over 26451 files: parentheses 7, statement nesting 8, binary chain 29, unary chain 1). Each input asserts
the server answers (findings or one `not-analysed`), never a failed request. Run under the shipped runtime (Node), not
only bun.

## Impact

`packages/volt-lsp-iec` tests only. Split out of `volt-cli-rework` (owner, 2026-10-18).
