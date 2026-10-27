> Found by the language-line step-3 gate review (2026-10-27). Not started; it follows network-text-st, whose grammar
> the re-spelled push sources must use. Nothing here is a fix to make before then.

## Why

The vendor-facts snapshots are the oracle for the NWL facts Volt relies on: DIALECT's N-rows, the `NwlCompleteness`
cache citations (`nwl-item-id`, `nwl-stsnippet-line-ids`, …) and the RebuildLoss tests. 37 of their rows can no longer
be re-measured:

- CODESYS (22): `nwl-address-sentinel`, `nwl-assign-item-flags`, `nwl-bitop-stored-slot`, `nwl-box-en-eno`,
  `nwl-branch-counter`, `nwl-call-type`, `nwl-editor-refill`, `nwl-flags-fixed`, `nwl-input-flags-list`,
  `nwl-input-pin-flag`, `nwl-instance-type`, `nwl-item-id`, `nwl-keep-network-in-place`, `nwl-leaf-wire-type`,
  `nwl-nested-assign`, `nwl-operand-boolean`, `nwl-operand-type`, `nwl-output-param-names`, `nwl-param-types`,
  `nwl-rail-fed-wire`, `nwl-stsnippet-line-ids`, `nwl-super-call`.
- TwinCAT (15): the same ids but `nwl-branch-counter`, `nwl-editor-refill`, `nwl-input-pin-flag`,
  `nwl-leaf-wire-type`, `nwl-nested-assign`, `nwl-stsnippet-line-ids`, `nwl-super-call`.
- `graphical-callee-seed` (both vendors): its push source too.

Their snapshot text still holds the retired `IMPLEMENTATION LD|FBD` line, and their push sources in
`packages/volt-cli/scripts/vendor-facts.table.ts` (`%LANGUAGE` since language-line) use a network-text grammar the
current reader refuses (`bun scripts/vendor-facts.ts codesys --only nwl-editor-refill`: "'t1' is an FB instance: its
call names its type"). So `vendor-facts --write` cannot reproduce them. The grammar drifted under network text v2,
before language-line; language-line only changed the line. network-text-st replaces that grammar with plain ST, so
re-spelling the sources now would be done twice.

Open data question, no home until now: re-spelling `nwl-editor-refill` in the current grammar changes the tree the push
STORES (CallType Function, a derived OutputParam, ENO=False), measured by the language-line implementer and not kept.
Whether that is the recorder's source or a writer defect is unmeasured.

## What Changes

- Re-spell every listed row's push source in the grammar network-text-st ships.
- Re-record those rows on both vendors (`vendor-facts --write`, one run per vendor, two agreeing runs) on an `ide.ps1`
  instance of this change.
- Re-check each fact that cites a re-recorded row (DIALECT N-rows, `NwlCompleteness`, RebuildLoss) against the new
  snapshot; a fact that changed is reported, not adapted.
- Answer the `nwl-editor-refill` question by measurement.

## Impact

- `packages/volt-cli/scripts/vendor-facts.table.ts`, `vendor-facts.codesys.json`, `vendor-facts.twincat.json`.
- `packages/volt-cli/src/Volt.Engine/Ide/DIALECT.md` (only where a re-recorded fact differs).
