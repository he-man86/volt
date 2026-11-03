> Written from Sim-Assist (review of `plc-add-dialogs`, 2026-10-31). Valid; built 2026-11-03.

## Why

A project may hold several PROGRAMs: the entry program calls the others (`Prog2();`) and may read their variables in ST
(`n := Prog2.count;`, runs). A host reading live values cannot: the runner's path lookup leaves every global of section
`program` out (`transpile/ir/path.ts` `pathRoot`, `g.section === "program" ? [] : …`).

Measured with Sim-Assist's bundle of volt dev (Main calling `Prog2`, `Prog2` declaring `a : BOOL`):

| call | result |
|---|---|
| `runner.get("Prog2.a")` | `no variable Prog2.a in Main` |
| `pou.globals` | `{ name: "Prog2", section: "program", type: { kind: "function_block", name: "Prog2" } }` |
| `pou.layouts.get("PROG2")` | `a`, and for an LD body its network state `__nw1_w1` |

So the lowered POU knows the program's frame, but no path reaches it. Sim-Assist cannot show a second program's live
values (ST inline values, the LD/FBD network view), trace them or force them, and shows none for now.

## What Changes

- The runner resolves `<Program>.<member>` (and deeper: `Prog2.t1.Q`, `Prog2.arr[1]`, `Prog2.__nw1_w1`) to the called
  program's frame, for `get` and `set`, the same way it resolves an FB instance's members.
- A program's frame exists from the first scan, also when the entry program has not called it yet (initial values).

## Impact

- `packages/volt-lsp-iec/src/transpile/ir/path.ts` (`pathRoot`), runner `get`/`set`; colocated tests.
- Sim-Assist: lists `section: "program"` globals' members as `<Program>.<name>` and passes the program's name as the
  network view's instance.
