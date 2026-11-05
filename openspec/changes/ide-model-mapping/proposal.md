## Why

Volt's network text was designed first and checked against NWL afterwards, so gaps turned up one at a time, over months, and
facts ended up in probes, DIALECT rows, vendor-fact tables and shape lists. Mapping what the IDE stores first, then deriving
the language from the map, is the correct order (owner, 2026-11-03: "this is exacly the way"). Other IDEs may follow (Siemens,
Rockwell), and each should start from one standard method, not from what took us months to learn.

## What Changes

- One standard method for mapping an IDE's stored model, in seven steps, written down as a guide.
- One vendor-neutral row format for the map, and one gate: a stored option with no row fails a test.
- The order (owner, 2026-11-05): NWL on CODESYS SP21 first, then verified on TwinCAT, then other IDEs in the future.
- One source of truth: a language-behaviour question is answered by the map and its fixtures. The lists holding the same facts
  fold into it and the old probing tools are removed.
- The final language proposal for NWL comes after that, derived from the map.

## Not in this change

- Shared framework code for several vendors. One model is mapped so far (TwinCAT stores the same NWL in another format), so its
  shape would be a guess. Code is extracted when a second model arrives and shows what really repeats.
- Other CODESYS versions.
- Choosing a Siemens or Rockwell approach. Their stored models are unmeasured here.

## Impact

- `packages/volt-cli/test/fixtures/nwl-schema/`, `test/e2e/graphical/`, `scripts/vendor-facts.*`, `scripts/record-nwl-*.py`,
  `scripts/voltprobe.py`, `src/Volt.Engine/Ide/DIALECT.md`; the open change `nwl-facts-rerecord` is folded in and closed.
- `nwl-box-storage-map` (in progress) is step 1 of the NWL map and is written to this format.
