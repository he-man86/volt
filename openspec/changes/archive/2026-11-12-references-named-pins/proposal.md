> DRAFT, written from Sim-Assist (change `model-io-refactor`, 2026-11-10). Measured, not started. Three gaps in
> references and rename, found while Sim-Assist refactors a program after a scene model's rename (it renames an instance,
> a function block type or a pin of it in every PLC file, by `references`).

## Why

Sim-Assist renames a scene model's global, its generated function block type and its pins in the user's program with
volt's `references` (the walk volt's `rename` makes), so comments, strings, a field of the same name and a local that
hides the global stay. Three kinds of occurrence are left out or resolve to the wrong symbol, and each leaves a project
the compiler refuses after a rename (volt's own `renameRefusal` doc: "Written over every occurrence, anything else leaves
a project the compiler refuses"). CODESYS's Refactoring > Rename renames all three.

Measured on volt dev `a29144ee50` (Sim-Assist's vendored bundle), `references(docs, project, doc, offset, true)`:

```
BoxBeltConveyor.pou:
FUNCTION_BLOCK BoxBeltConveyor
VAR_INPUT
	Velocity : REAL;
END_VAR
VAR_OUTPUT
	Actual_Velocity : REAL;
END_VAR
END_FUNCTION_BLOCK

BoxPhotoEye.pou:
FUNCTION_BLOCK BoxPhotoEye
VAR_OUTPUT
	Active : BOOL;
END_VAR
END_FUNCTION_BLOCK

Scene.gvl:
VAR_GLOBAL
	Infeed : BoxBeltConveyor;
	PE1 : BoxPhotoEye;
END_VAR

Main.pou:
PROGRAM Main
VAR
	v : REAL;
END_VAR
Infeed(Velocity := 0.4, Actual_Velocity => v);
END_PROGRAM

Cell.pou:
PROGRAM Cell
VAR
	av : REAL;
	y : BOOL;
END_VAR
%LANGUAGE LD
%NETWORK
Infeed(EN := RAIL(), Velocity := av, Actual_Velocity => av);
%NETWORK
ASSIGN(PE1().Active, Q_INVERTED => y);
%NETWORK
AND(PE1(Active_INVERTED => y), TRUE);
END_PROGRAM
```

| # | References asked at | Measured | Expected |
|---|---|---|---|
| A | `PE1` in `Scene.gvl` (its declaration) | the list `Scene` (its whole span; `Scene.gvl` 0:0, `Scene.PE1` in a body) | the global `PE1`: its declaration and every use |
| B | `Velocity` in `BoxBeltConveyor.pou` (its declaration) | `Infeed.Velocity` uses only | also `Infeed(Velocity := 0.4, …)` in Main and `Velocity := av` in Cell's box |
| B | `Active` in `BoxPhotoEye.pou` | members only | also the marked output `Active_INVERTED => y` (its first six characters) |
| C | `Active` in `BoxPhotoEye.pou` | no occurrence in `PE1().Active` | `Active` of `PE1().Active` (`resolveAt` resolves it there through `boxMember`, `findReferences` does not) |

- **A**: `symbolDefinedAt` returns the first project-level symbol whose span holds the offset; the `gvl_block` symbol's
  span is the whole list (`bind-globals.ts`), so it wins over the `gvl_var` declared inside it. References and rename at a
  global's declaration act on the list (measured); definition and hover take the same `resolveAt`.
- **B**: `findReferences` walks member chains, `.g` and bare identifiers; a call argument's formal name (`CallArg.param`)
  is none of them. In a network body a pin may carry a mark after its name (`Q_INVERTED`, `Q1_SET`), which `networkBox`
  reads (`coil`); a rename must keep the mark (`On_INVERTED`).
- **C**: `findReferences`' member path resolves `resolveMemberChain(e)` with the call as base, which has no FB type;
  `resolveAt` first swaps the base for `boxMember(...).box.instance`.

## What Changes

- A cursor on a GVL variable's declaration resolves the variable (a narrower span wins over the list's).
- `findReferences` counts a call's named argument as an occurrence of the callee's member (inputs `:=`, outputs `=>`,
  in ST and in network bodies), a marked output's name part included, and a box output read through its call.

## Impact

- `services/navigation/references.ts`, `frontend/symbols/scope-nav.ts` (`symbolDefinedAt`), their tests.
- Sim-Assist finds B and C itself until then (`plc/refactor/scene-references.ts`, `walkedPins`) and asks A at a use
  instead of the declaration; it drops both when a bundle carries this change.
