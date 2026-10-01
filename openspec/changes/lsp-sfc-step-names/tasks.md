## 1. Test red

- [ ] 1.1 Conformance fixture: an SFC program with steps, whose ST (transitions/actions/other POU code) reads
      `<Step>.x` and `<Step>.t`. Today: `unknown-member`. CODESYS build: clean.

## 2. Fix

- [ ] 2.1 Resolve step names (and implicit step members) for SFC POUs; or, where the chart is not available, do not
      report `unknown-member` on possible step names. Record which in DIALECT.md.

## 3. Verify

- [ ] 3.1 Fixture clean; a real typo (`S_Bot`) still reported if the chart is available.
- [ ] 3.2 Conformance suite green.
