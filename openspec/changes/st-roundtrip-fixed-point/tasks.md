## 0. Design gate — do this first

- [x] 0.1 (volt, 2026-10-03: confirmed; (A) FITS as an opt-in request flag, (B) does NOT fit — stable workspace diffs.) Verify the observation and confirm or refute PLCAssist's reading (see "Analyse first"); if refuted or intended, record why and stop. Then check (A) receipt text and (B) fixed point against volt's design: the canonical member order and blank line
      (`StWriter.cs:32-62`, stable workspace diffs), the receipt walk, the CLI baseline. Record FITS, or CONFLICTS +
      why + the volt-native alternative. Build only what fits.

## 1. Reproduce

- [x] 1.1 (2026-10-04: `test/Volt.Engine.Tests/sync/PushThenFetchShapeTests.cs`, 3 green on FakeIde: a created W1 fetches
      as the canonical text — 22 pushed lines → 23 fetched, the one extra the blank line before `END_FUNCTION_BLOCK`,
      ACTION Stop moved before PROPERTY Running; the receipt's `newItems` version equals the fetched version, so only
      the TEXT differs; fetch → push → fetch is stable. FakeIde fixed on the way: a content write dropped a property's
      accessors (replaced the member, never wrote GET/SET), so a pushed property read back empty.) Engine test: push the W1 text (body ending directly at `END_FUNCTION_BLOCK`, PROPERTY before ACTION), fetch
      it, and record the difference: one blank line before the END line, ACTION before PROPERTY.
- [x] 1.2 (gate 1, 2026-10-04) Review findings on step 1, each red first (`sync/FakeAccessorWriteTests.cs`, 3 red → 4 green):
      - FakeIde's accessor write kept the old body on a null `Body` (`?? acc.Implementation`) — FIXED: writes
        `Accessor.Code` (`""` for null) as CODESYS does; TwinCAT's null comes only from its own `Textual` (graphical
        body already written through the archive) and `StReader` never yields one, so no vendor asymmetry is taken.
      - the accessor body skipped `Held` — FIXED: a graphical GET/SET is held as its model (canonical layout,
        `RematerializeAs`), an UNSUPPORTED one keeps the IDE's body, as the member path.
      - an INTERFACE accessor took a declaration AND a body — FIXED: declaration only (CODESYS, D41), never a body (no
        slot on either vendor); TwinCAT's "nothing at all" is its pre-flight refusal, modelled by
        `ValidatesInterfaceAccessor` (pinned: refused, nothing written).
      - `Fetch_push_fetch_is_stable` possibly vacuous — MEASURED not vacuous: the restated canonical text IS written
        (`writecontent` count rises); the test now asserts that, and adds a canonical-form edit that is written and
        reads back byte for byte.
      - `Canonical` is StWriter + fake, not the R14 recording — ACCEPTED as stated: its doc now says R14 attests only
        the blank line before `END_FUNCTION_BLOCK` and ACTION-before-PROPERTY; 4.1 compares against a live fetch.
      Numbers: Engine 2197 pass / 1 skip, Cli 260, Connector 115, Twincat 428, Codesys 297, Contracts 39, Repo.Gates 108
      (all 0 fail); typecheck clean; `bun run check` 18/18; volt-cli `test/unit` 24/24.

## 2. Test red

- [ ] 2.1 For the chosen route: the push answer's text (A), or the fetched text (B), equals the canonical text a fetch
      gives, for an FB with members and for a GVL/DUT.

## 3. Build

- [ ] 3.1 The chosen route; regenerated docs.

## 4. Verify

- [ ] 4.1 Live on CODESYS: create, then fetch; the text equals what the push answer held (A) or what was pushed (B).
      Compare against the LIVE fetch, never against `PushThenFetchShapeTests.Canonical` (StWriter + fake; R14 attests
      only the END-line blank line and the member order).
- [ ] 4.2 Full C# suites and `bun run check` green.
