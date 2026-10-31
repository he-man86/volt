> Owner, 2026-10-31 (relayed by Sim-Assist): "make sure the LSP is updated with the network tokens so they are detected
> as language things".

## Why

The network spellings decided with Sim-Assist (`network-rail-and-pin-negation`, "Decided by Volt + Sim-Assist") read
and run, but the editor did not know them: `RAIL()` coloured as an unresolved variable, a mark before a receiver
(`RISING IN := a`, `NOT y := a`) as a variable, the label of `JMP.l` as a variable, a network's `l:` as nothing. No
completion offered them and hover said nothing. Sim-Assist's Monaco network editor kept its own word list, which drifts
from Volt's.

## What Changes

- One list of the network words, read off what the network-text front-end already produces (`plainStText`'s `%` lines
  and receiver marks, `sourceStatements`' labels) and the body's tokens: `services/shared/network-words.ts`. The parser
  is not touched.
- Semantic tokens: the `%LANGUAGE`/`%NETWORK`/`%DISABLED`/`%UNSUPPORTED` words and every receiver mark (stacked ones
  each) are `keyword`; `RAIL`, `BRANCH`, `BRANCH_SHORTCIRCUIT`, `EXECUTE`, `OPERAND` and a value's `RISING(`/`FALLING(`
  are `function`; `JMP` and a target `RETURN` are `keyword`; the jump's label and a network's `l:` are `label` — a
  standard LSP token type, added last to the legend so every other index stays.
- Completion in a network body only: the mark words before a receiver, the body's labels after `JMP.`, `RAIL()` and
  the network's boxes where a value or a call stands.
- Hover: one line per network word saying what it runs as, from ONE table (`services/shared/network-meanings.ts`) that
  the generated "What it runs as" table (`network-rail-and-pin-negation` task 2.3) replaces.
- `networkTokens(text)` (exported from `services/`): the semantic-token classification of a file's text as
  `[{start, length, kind}]`, `kind` a semantic token type name, for a highlighter that is no LSP client.

## Impact

- `packages/volt-lsp-iec/src/services/` only (shared, structure, assist). The legend gains `label`; volt-vscode needs no
  declaration for a standard type.
- Sim-Assist: add `"networkTokens"` to the `services/index.ts` entry of `EXPORTS` in `scripts/build-volt.mjs`, then
  `npm run build:volt` (its task, not Volt's).
