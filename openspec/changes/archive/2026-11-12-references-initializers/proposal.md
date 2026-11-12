> DRAFT, written from Sim-Assist (review of change `model-io-refactor`, 2026-11-12). Measured, not started. A gap in
> references and rename: a use in a variable's initial value is no occurrence.

## Why

Sim-Assist renames a scene model's global and its pins in the user's program with volt's `references` (the walk
volt's `rename` makes). Volt accepts a variable's initial value that names another variable (`a : INT := g;`,
`b : TIME := t.ET;`: no diagnostic), but `findReferences` walks bodies only, so a rename leaves the initial value
naming the old global, and the project no longer compiles (`renameRefusal`'s own words: "Written over every
occurrence, anything else leaves a project the compiler refuses"). CODESYS's Refactoring > Rename renames uses in
declarations too.

Measured on volt dev `03609354f4` (Sim-Assist's vendored bundle), `references(docs, project, doc, offset, false)`:

```
GVL.gvl:
VAR_GLOBAL
	g : INT;
	t : TON;
END_VAR

Main.pou:
PROGRAM Main
VAR
	a : INT := g;
	b : TIME := t.ET;
END_VAR
a := g;
END_PROGRAM
```

| # | References asked at | Measured | Expected |
|---|---|---|---|
| A | `g` in `GVL.gvl` (its declaration) | `Main.pou` 5:5 only (the body's `g`) | also `Main.pou` 2:12 (`a : INT := g;`) |
| B | `g` in Main's body | `Main.pou` 5:5 only | also 2:12 |
| C | `ET` in `b : TIME := t.ET;` | undefined (nothing resolves there) | `TON.ET`'s references, this one among them |

## What Changes

- `findReferences` walks the initial values of every declaration (POU sections, GVLs, DUT fields) as it walks bodies,
  each in the scope its declaration resolves in.
- `resolveAt` resolves a name or member in an initial value (definition, hover, references and rename at it).

## Impact

- `services/navigation/references.ts`, `services/shared/resolve-at.ts`, their tests.
- Sim-Assist's refactoring (`plc/refactor/scene-references.ts`) takes initial values with the bundle that carries this;
  it does not find them itself until then.
