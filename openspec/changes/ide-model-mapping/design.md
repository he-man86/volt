## The method

Every IDE, every model, in this order:

1. **Census.** Everything the model can store, read from the vendor's own DLL or schema, committed as a generated file.
2. **Editor reference.** The IDE itself creates each object (NWL: the real `InsertBox`), and what it stores is recorded. A
   pushed object must store what the editor would.
3. **Fixture per state.** Every stored state is created by us and committed, including states no project is known to hold.
4. **Measure.** Build it, run it, compare the picture, save and reopen. A preview or a pull is not proof: the run is.
5. **Map.** One row per option (format below).
6. **Completeness gate.** A test fails when the census holds something the map does not.
7. **Language last.** Derived from the map: a state that changes the program gets a spelling, the rest a refusal by name.

## The row

| Field | Holds |
|---|---|
| `model`, `class`, `member`, `kind` | Where the option lives; `kind` is the object kind where it matters (NWL box: FUNCTION, FB, PROGRAM, operator, comparison, Execute) |
| `option` | The stored value or state |
| `source` | `census`, `editor` or `created` |
| `picture`, `code`, `run`, `persists` | `same`, `differs`, `not-measured`; `faults` where the IDE raises an error on it |
| `status` | `spelled`, `refused-inert`, `refused-fault`, `cannot-store`, `not-measured` |
| `text` | The spelling or the refusal's wording |
| `fixture` | The test that pins it |

`not-measured` is a real status: such a state stays refused by name and is listed, never counted as known. Nothing in the row
format names a vendor except `model`. A verification on another IDE of the same model adds its own column of results to the row.

## The order

1. **CODESYS SP21.** The map is built and the language derived there.
2. **TwinCAT.** It stores the same NWL in another format, so the same rows and fixtures are replayed on it. Each row is confirmed or
   gets a measured difference. A form with no measured archive stays refused by name until then, and this step is where each
   such refusal is measured and lifted or kept.
3. **Other IDEs, in the future.** See "A new IDE".

## One source of truth

A language-behaviour question is answered by the map and its fixtures. A new fact becomes a row, not a probe, a DIALECT row or a
side list. Tests of Volt's own code (e2e, exec twins, release matrix) stay: they check the code against the map and do not define
the language. ST oracles (`record:exec`, `record:language`, the build recordings) stay: they cover ST, not the stored model.

Limit, stated: the gate proves every declared option has a row. Behaviour inside the compiler can only be sampled, so a row
covers what was run, and combinations cover what the shape generator reaches.

## Old patterns this rules out

- Designing the language first and finding gaps from outside.
- Arguing from how often a shape appears in real projects. A real project is a check at the end, never an argument.
- Guessing a stored form instead of measuring it.
- Trusting a preview or a pull instead of running the program.
- A new probe or list per fact.
- Calling something unmeasured without checking the map, or measured without a fixture.
- Running one vendor's or one version's tests and assuming the rest: a change names what it did not run.

## Machine rules for measuring

A full measurement needs a quiet machine and free disk (other sessions' heavy work paused, disk checked), and a dialog stops a
batch at once, because a modal dialog blocks the IDE and hides what follows. Every created object gets a unique id.

## A new IDE

1. Find what plays NWL's part: the stored model, how to read it, how to create objects through the IDE, how to run the result.
2. Run the method on one small object kind end to end before anything else, and write down what did not fit.
3. Only then extract shared code, and only what both models actually repeated.

## Open

- **Is there one language or one per model?** The language is being fitted to NWL as closely as possible, and another vendor's
  model may not fit it 1:1. Either each model gets its own close-fitting language by this method, or one language gives up some
  fit. To decide when a second model has been mapped, with the owner.
