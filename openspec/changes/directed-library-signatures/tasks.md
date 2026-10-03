## 0. Design gate — do this first

- [ ] 0.1 Verify the observation and confirm or refute PLCAssist's reading (see "Analyse first"); if refuted or intended, record why and stop. Then check each item of the proposal against volt's design: the `onlyItems` directed-preview contract
      (`FetchService.cs:44-49`, `:249-258`), the signature path's per-version immutability (archived
      `cache-library-signatures`), the precompile cost, the CLI's read-only library folders, and any open change that
      decides the same question. Record per item: FITS, or CONFLICTS + why + the volt-native alternative. Implement only
      the FITS items; leave the rest for the owner.
- [x] 0.2 Decided (owner, 2026-10-03): (A) — a directed fetch naming `X.library` returns X's manifest and ALL its
      signatures, like any other extension; no new op, no element filter.
- [ ] 0.3 Decide whether `MATERIALIZATION` can leave a directed read's manifest without breaking the LSP's format
      check (`LibraryManifest.cs:28-47`).

## 1. Reproduce

- [ ] 1.1 On the CODESYS fixture, `fetch { onlyItems: ["Standard, <ver> (System).library"] }` and record the answer:
      expect the manifest alone, no signature items.
- [ ] 1.2 Time a full fetch with `librariesRefreshed` on the fixture and on a large project (cold and warm), for the
      cost the new route must stay under.

## 2. Test red

- [ ] 2.1 An engine test: a directed read of one library returns that library's signature items and no other's.
- [ ] 2.2 The same on TwinCAT (BeckhoffDriver's `ProduceAllLibrarySignatures`): the same item shape; fix the stale
      `DriverBase.ExtractLibrarySignatures` comment ("TwinCAT has no library signatures yet").
- [ ] 2.4 Data-driven over `ItemKind`: for EVERY kind a full fetch can return, a directed `fetch { onlyItems: [X.ext] }`
      returns the same content for X as the full fetch (engine test on both vendors' doubles); a kind with no row fails.
- [ ] 2.3 Two reads in a row with no library change run one precompile.

## 3. Build

- [ ] 3.1 The chosen route (0.2), the cache per resolution, the wire type, regenerated docs.
- [ ] 3.2 TwinCAT: the same route through `BeckhoffDriver`; both vendors' answers identical in shape.

## 4. Verify

- [ ] 4.1 Repeat 1.1 live on CODESYS: TON's pins are in the answer.
- [ ] 4.3 Live, both vendors: the 2.4 table over a fixture project — every readable extension read on its own matches
      the full fetch (LD/FBD network text rows deferred to its design work, listed as such).
- [ ] 4.2 Full C# suites and `bun run check` green.
