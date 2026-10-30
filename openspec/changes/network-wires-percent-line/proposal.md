> FOR REVIEW (simplification), written from Sim-Assist (change `network-viewer`, 2026-10-30). DRAFT: a proposal to simplify network text, not a measured bug. Nothing is built until the owner answers. Read on volt dev `5aa22c2a09`.

## Why

A network's wires are declared in ST declaration syntax, on one line, with a type that is always `ANY`:

```
%NETWORK "Start the motor"
VAR_TEMP w1 : ANY; w2 : ANY; END_VAR
// runs while auto is on
w1 := start AND NOT stop;
```

`frontend/syntax/network/plain-st.ts` (`takeWires`, `wiresOf`, `WIRES_FORM`) reads this line by its own rules: one line,
after the `%` lines and before the comment, every type `ANY` (another type is refused). It is the only line of a network
that looks like ST but is not ST: a `VAR_TEMP` that declares no variable, with a type that is not a type.

## What changes (proposed)

- Current form: `VAR_TEMP w1 : ANY; w2 : ANY; END_VAR`
- Simpler form: `%WIRES w1, w2`: one more `%` line beside `%NETWORK`, `%DISABLED` and `%UNSUPPORTED`, which already are the
  network's lines that are not code.
- The reader accepts the old line for one release with a hint naming the new one; the writer writes the new one.

What it saves:
- the viewer and editor: adding or removing a wire edits one `%` line (a list of names), with no `: ANY;` pairs to keep and
  no `END_VAR` to place; a network's header is all `%` lines;
- users: no type that is not a type, no ST block that is not ST, and three refusals fewer (the one-line form, a type other
  than `ANY`, a `VAR_TEMP` after the comment).

## Open (for the owner)

1. Is the `VAR_TEMP` line fixed by the bridge's stored format (`StNetworkReader.WireDeclaration`), or free to change in both
   readers and the writer?

## Volt verification (2026-10-30)

**Verdict: D — a language preference, already decided by the owner (2026-10-28: "it should be VAR_TEMP actually").
Recommendation: keep `VAR_TEMP w1 : ANY; END_VAR`.**

Answer to Open 1: the line is NOT fixed by the stored format — it is free text design. Measured live (CODESYS 3.5.21.40, native
export after pushing `VAR_TEMP w1 : ANY; END_VAR` / `w1 := a AND b;` / `x := w1;` / `y := w1 AND c;`): the IDE stores one
`BoxTreeDemux VarId=1` definition and two references, with no name and no type anywhere; pulled identical, fixed point. The
completeness oracle already records that the text numbers wires by position, not by the vendor's `VarId`
(`CodesysNwlCompletenessOracleTests`, "BoxTreeDemux.VarId — changed"). So both forms would carry exactly the same fact.

Trade-off. `%WIRES w1, w2` is shorter and puts every non-code line in the `%` family; `VAR_TEMP … : ANY` keeps every line of
a network that is not a `%` line valid ST in shape, which is why the owner chose it, and it is a standing decision. The proposal's
"accept the old line for one release" also runs against the standing no-backward-compatibility rule. Nothing is broken.
