# Mapping an IDE's stored model

How a fact about what an IDE stores, builds and runs becomes known to Volt. The NWL map
(`test/fixtures/nwl-schema/map.3.5.21.40.json`) is the one source for LD/FBD on CODESYS; this guide is how it is kept and
how another model gets one.

## The method

1. **Census.** Every class, member, flag and slot the model can store, read from the vendor's own DLL
   (`NwlSchemaCensus`, generated into `model-map.<version>.txt`, `VOLT_WRITE_NWL_SCHEMA=1`).
2. **Fixture state.** Each state is created in the IDE, by the editor's own commands where one draws it, by the object
   model where none does, as its own PROGRAM in a committed fixture project (`Codesys{Box,Assign,Class}States.<version>.project`)
   and recorded in `{box,assign,class}-states.<version>.json`: id, language, what, its pull.
3. **Measure**, against the editor's form of the same thing at the same place:
   - **build** — does the IDE compile it, which code;
   - **code** — same generated code as the editor's form;
   - **run** — run the program and compare the outputs;
   - **picture** — what the editor draws;
   - **persist** — save, close, reopen: does it come back as stored.
4. **Map row.** One row per member and option (below), citing the states that measured it.
5. **A new spelling** goes to the owner with its rows before it is built. A state that changes the program gets a
   spelling; every other state a refusal by name.

A fact only a Volt push produces (what the push writes, then what the IDE stores, builds and keeps) is measured by
`scripts/vendor-facts.ts` and becomes a `pushed` row citing that fact.

## The row

```json
{"model": "NWL", "class": "BoxTreeBox", "member": "OutputItems", "kind": "FB",
 "option": "['z','x','k'] root, names [ENO,q1,q2] en=True eno=True, bmFB2",
 "source": "created", "picture": "differs", "code": "differs", "run": "differs", "persists": "not-measured",
 "status": "refused-gap", "text": "a variable on the ENO pin", "fixture": "box-states#0059,0089"}
```

| Field | Holds |
|---|---|
| `model`, `class`, `member`, `kind`, `option` | where the option lives and its stored value; `class`+`member` must exist in the census |
| `source` | `census` (only the census knows it), `editor` (the editor's own form), `created` (stored through the object model), `pushed` (stored by a Volt push) |
| `picture`, `code`, `run`, `persists` | `same`, `differs`, `faults`, `not-measured` |
| `status` | see below |
| `text` | the pull: the network text, or the refusal's wording |
| `fixture` | the evidence: `box-states#<ids>`, `assign-states#<ids>`, `class-states#<ids>`, `<recording>#fault:<i>`, or `vendor-facts#<fact>,…` for `pushed` |

| Status | Meaning |
|---|---|
| `spelled` | the text states it |
| `lost-inert` | held, no text, no refusal: a pull shows another state's text; nothing builds or runs apart |
| `refused-inert` | refused by name; code and run equal the editor's form |
| `refused-gap` | refused by name; it changes the code or the run and has no text |
| `refused-fault` | refused by name; the IDE does not build it or faults on it |
| `cannot-store` | the object model cannot hold it |
| `not-measured` | stays refused by name, never counted as known; its cells may not say `same`/`differs` |

The gates (`test/Volt.Engine.Tests/format/network/schema/`):

- `NwlMapTests` — every census member and option has a row; every row is well formed and unique; a row that is not
  `not-measured` names its fixture; every recorded state and fault is cited by a row whose `text` is its pull; a `pushed`
  row cites facts of `scripts/vendor-facts.codesys.json` recorded on the map's IDE build, `code same` only where every
  build of the fact is clean, `persists same` only where the pull after reload equals the pull after the push.
- `NwlSchemaGateTests` — every generated shape (`shapes.v2`) has one spelling or a refusal by name, a spelled text reads
  back as itself, and no shape is spelled where the map refuses one of its states.
- The live twins: e2e `nwl-{box,assign,class}-states` re-pull every `live` state from the fixture IDE; the offline
  `Codesys{Box,Assign,Class}StatesTests` replay every state.

## Rules learned from what went wrong

- **A read-back is not a measurement; a build and a run are.** A pushed network pulled back equal while CODESYS refused
  to build it (C0032: the reader numbered wire VarIds per network, `1,1,1`, where CODESYS compiles one variable per VarId
  in the body). Every `pushed` row needs its fact's build.
- **A writer or reader change makes recordings stale.** Re-record every fact and state the change touches and let the
  gates diff them; never edit a recording by hand.
- **Real-project counts decide nothing.** How often a shape appears in a customer project is no argument for or against
  a row. A real project is a check at the end, and a surprise there becomes a row and a fixture.
- **Measure the stored form, never guess it.** Measure the form the editor draws before concluding the IDE ignores a
  stored form.
- **A new fact is a new row**, never a new probe, a DIALECT row or a side list.
- **Name what was not run.** A result on one vendor or version says nothing about the others.

## Machine rules

- `%TEMP%\volt-ide-hold` exists: start no IDE; re-check every 5 minutes. Never delete it.
- One IDE at a time, on its own `ide.ps1` instance, on a copy of a committed fixture; close what you start (`down`).
- Measure only on CODESYS 3.5.21.40 (the map's build; `vendor-facts.ts` refuses a snapshot from another build).
- Never press Yes on an upgrade or conversion dialog: it rewrites the fixture for another version. Any modal dialog stops
  the batch; record it as a fault.
- Before a batch: check free RAM and disk, and that no other heavy work runs.
- Each created object gets a unique id.
- A probe is single-use: record the fact as a row, then delete the probe.
- A batch persists each fact as soon as it is measured (`vendor-facts.ts --only <fact>` re-records one), so a dialog
  or a crash loses one fact, not the run.
