> Written from Sim-Assist (change `network-editor`, 2026-10-30); built in volt-lsp-iec 2026-10-30.

## Why

In CODESYS's LD/FBD editor, a newly inserted contact, coil or box pin shows `???` until the engineer names it. The
IDE stores `???` in the operand, and the build refuses it ("Expression expected instead of '?'"). Volt's C# reader
accepts `???` in every operand position (`StNetworkReader.TryOperandSpan`: "a literal, `???`, or a name chain").
`network-text-st` decided that the language server gives the build's error for `???` "as a target, an operand and an
instance".

The TS front-end does give that error, but it accepts `???` only as a statement's assignment target
(`frontend/syntax/network/plain-st.ts` `isUnnamedTarget`). Anywhere else `???` is a syntax error, and the whole
statement is dropped from the tree. So while one operand is unnamed, a graphical editor that reads the tree
(Sim-Assist's network editor, and later PLC Assist's viewer) loses the whole rung.

Measured on volt dev `3e4c6c4082` with a probe bundle (`parseDocument(uri, src, {networkText: true,
unicodeIdentifiers: false}, "codesys")`, then `sourceStatements`):

```
%LANGUAGE LD
%NETWORK
x := ??? AND a;
%NETWORK
??? := a;
%NETWORK
x := MOVE(EN := a, ???, OUT => ???).ENO;
```

| Network | Statements in the tree | Diagnostics |
|---|---|---|
| `x := ??? AND a;` | none (dropped) | `syntax-error` "Expression expected instead of '?'" |
| `??? := a;` | `assign`, target identifier `???` | `network-unnamed-target` "The assignment target is not specified." |
| `x := MOVE(EN := a, ???, OUT => ???).ENO;` | none (dropped) | `syntax-error` "Expression expected instead of '?'" |

Sim-Assist works around this in `plc/network/edit/actions/pending.ts`. A new element that needs an operand is held
in the editor, not in the text, until it is named, and Escape cancels the insert. Once this change lands,
Sim-Assist writes `???` at once, as CODESYS does.

## What changes

- `???` parses as the unnamed operand (an identifier expression `???` with its span) wherever network text takes an
  operand: a contact operand, a box input (positional or `IN := ???`) and an output binding (`OUT => ???`).
- The statement stays in the tree. The diagnostic stays an error at the `???`, in the build's wording, so nothing
  that did not build starts to build.
- Plain ST (not network text) is unchanged.

## Impact

- `src/frontend/syntax/network/plain-st.ts` (token rewrite) and the network checks' messages.
- Graphical consumers keep every rung while an operand is unnamed.
