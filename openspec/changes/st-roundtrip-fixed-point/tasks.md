## 0. Design gate — do this first

- [x] 0.1 (volt, 2026-10-03: confirmed; (A) FITS as an opt-in request flag, (B) does NOT fit — stable workspace diffs.) Verify the observation and confirm or refute PLCAssist's reading (see "Analyse first"); if refuted or intended, record why and stop. Then check (A) receipt text and (B) fixed point against volt's design: the canonical member order and blank line
      (`StWriter.cs:32-62`, stable workspace diffs), the receipt walk, the CLI baseline. Record FITS, or CONFLICTS +
      why + the volt-native alternative. Build only what fits.

## 1. Reproduce

- [ ] 1.1 Engine test: push the W1 text (body ending directly at `END_FUNCTION_BLOCK`, PROPERTY before ACTION), fetch
      it, and record the difference: one blank line before the END line, ACTION before PROPERTY.

## 2. Test red

- [ ] 2.1 For the chosen route: the push answer's text (A), or the fetched text (B), equals the canonical text a fetch
      gives, for an FB with members and for a GVL/DUT.

## 3. Build

- [ ] 3.1 The chosen route; regenerated docs.

## 4. Verify

- [ ] 4.1 Live on CODESYS: create, then fetch; the text equals what the push answer held (A) or what was pushed (B).
- [ ] 4.2 Full C# suites and `bun run check` green.
