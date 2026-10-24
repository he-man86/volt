Requires: `volt-cli-rework` (archived 2026-10-24). Nothing below starts before the owner has read `design.md` and
answered its two questions (or let the recommended answers stand).

## 1. Before any code

- [x] 1.1 Blind foreign-client review of the DRAFTED shape: an agent given only `design.md` sections 1–7 and the current
      `wire.html`/OpenRPC (no repo), writing a client on paper; fold its findings into `design.md`.
- [x] 1.2 Measure the frame encoding (BOM, `\n` vs `\r\n` on both bridges' writers and readers) and state it.
- [ ] 1.3 Owner review of `design.md`; record the answers to its two questions.

## 2. Measurements the design depends on

- [ ] 2.1 `languages`: the shown set per bridge from its `LanguageRegistry` (expected `ST`, `LD`, `FBD` on both).
- [ ] 2.2 `kinds`: each bridge's `KindRegistry` rows with their writable flag; equal to `items.html`'s table.
- [ ] 2.3 `ProjectEntry.version`: who sets it, on which vendor; define it or delete it.
- [ ] 2.4 Project-name case on TwinCAT: can one solution hold two PLC projects differing only by case? (CODESYS: no.)
- [ ] 2.5 `dirty`: when each IDE fails to answer (both hosts), so the absent case has a test of its own.
- [ ] 2.6 `build.success` vs "no `error` diagnostic" on both vendors over the e2e build cases: one rule if they agree.
- [ ] 2.7 Each vendor's severity words seen in the corpora and recordings: the host's declared word table.

## 3. Build, test-first (offline)

- [ ] 3.1 Contract types (`Volt.Contracts/Wire`) to the new shape; `Vendors.cs` and the per-vendor pipe minters out of
      Contracts (vendor ids from `VendorRegistry`); every change red first in `Volt.Contracts.Tests`.
- [ ] 3.2 Envelope: `protocol` required, `PROTOCOL_MISMATCH` before the body is read (`PipeServer`), protocol 1.
- [ ] 3.3 `health`: `languages`, `kinds`, optional `dirty` (both hosts, no fallback), status enum.
- [ ] 3.4 `refs`/`fetch`: `code` on unreadable entries; `knownApplications` required with `knownItems`.
- [ ] 3.5 `push`: `accepted` and `currentProjectVersion` deleted; lease as an error frame; `removed` in the receipt;
      `existing` on ITEM_EXISTS; `code` required.
- [ ] 3.6 `build`: severity absent when unmapped; positions optional and 1-based; `durationMs`.
- [ ] 3.7 `grep`: `name`.
- [ ] 3.8 The CLI, `volt-control`, the relay and the VS Code extension read the new shape (their offline suites).
- [ ] 3.9 OpenRPC generator: enums from the declarations, `ProgressFrame`, `BridgeErrorCode`/`ConflictCode`, the common
      error set, the channel column; `wire.html` rewritten to current behaviour only (no history, no counts).
- [ ] 3.9a INTERNAL_ERROR only for a Volt bug (owner 2026-10-24: "before this refactor we got a lot of internal errors
      back .. this is not very clean"). Census every uncoded throw reachable from the wire (`WireVocabularyTests`
      `UncodedThrow`: 164 before the rework, 177 at 1464605aaf — the refusals the rework added were mostly coded, but each
      uncoded one is answered INTERNAL_ERROR by PipeServer / ConflictFor). Classify each: a request or an IDE state gets
      its own code (BAD_REQUEST, UNSUPPORTED, UNREADABLE, PLC_DISCONNECTED, …) behind a test; only an invariant guard (a
      state Volt itself must never reach) stays INTERNAL_ERROR. The census becomes a ratchet that only goes down, and the
      contract suite gains a case per reclassified site where a request can reach it. Report before → after.
- [ ] 3.10 All C# suites, `bun test test/unit`, typecheck, lint, `bun run check` green.

## 4. Live

- [ ] 4.1 The OpenRPC contract suite updated to the new shape and green on both vendors.
- [ ] 4.2 The wire transcripts re-recorded ONCE for the new shape (`release:matrix --record-transcripts`), then compared
      identical on a second run.
- [ ] 4.3 The mixed-version cell against the previous release (protocol stays 1, owner 2026-10-24): its client sends no
      `protocol` and is refused by name before any op; our client's `protocol` member is refused by its strict reader by
      name. Both directions refused by name, never misread.
- [ ] 4.4 Small matrix per push (`--only codesys-3.5.22.40-64,twincat-32,vendor-parity --jobs 1`).

## 5. Close

- [ ] 5.1 `plcassist-note.md` final, sent to PLC Assist with the release.
- [ ] 5.2 The full release matrix once, green; docs match the code; archive.
