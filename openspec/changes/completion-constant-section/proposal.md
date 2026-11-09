> DRAFT, written from Sim-Assist (change `network-review-fixes`, 2026-11-09). Measured, not started. For review: a gap in
> the completion detail, found through Sim-Assist's write filter.

## Why

Volt's completion gives a variable's detail as `<type> · <section>` (`REAL · VAR_INPUT`), and Sim-Assist offers a member
as an assignment's target only where its section is writable from outside (`VAR_INPUT`, `VAR_GLOBAL`). A constant's
detail drops `CONSTANT`, so a client cannot tell a constant from a variable it may write: at `G.` where a statement starts,
Sim-Assist offers the constant `G.K` as a target, which the program cannot write.

Measured on volt dev `95ead1202b` (Sim-Assist's vendored bundle), `completion(own, project, offset)`:

```
G.gvl:
VAR_GLOBAL CONSTANT
	K : INT := 3;
END_VAR
VAR_GLOBAL
	ga : INT;
END_VAR

Main.pou:
PROGRAM Main
VAR
	x : INT;
END_VAR
VAR CONSTANT
	C : INT := 1;
END_VAR
x := 1;
G.
END_PROGRAM
```

| Completion at | Item | Measured detail | Expected detail |
|---|---|---|---|
| `G.` | `K` | `INT · VAR_GLOBAL` | `INT · VAR_GLOBAL CONSTANT` |
| `G.` | `ga` | `INT · VAR_GLOBAL` | `INT · VAR_GLOBAL` |
| an identifier in Main's body | `C` | `INT · VAR` | `INT · VAR CONSTANT` |

Measured alongside, no defect: the member list after `G.` holds every variable of every `VAR_GLOBAL` section, an FB
instance (`t1 : TON`) included. A list cut short at a variable named `gt` is the reserved word GT: the GVL has a syntax
error there ("Unexpected token 'gt' found").

## What Changes

- A variable declared in a `CONSTANT` section (`VAR CONSTANT`, `VAR_GLOBAL CONSTANT`) carries the qualifier in its
  completion detail's section.

## Impact

- `services/assist/completion.ts` (the item's detail).
- Sim-Assist: its write filter reads the section from the detail (`plc/engine/volt-engine.ts` `WRITABLE_MEMBER`, which
  holds `VAR_INPUT` and `VAR_GLOBAL`); with the qualifier a constant is no longer offered as a target, with no change on
  Sim-Assist's side.
