> DRAFT, written from Sim-Assist. Not started.

## 1. Front-end

- [ ] 1.1 `???` in an operand position of a network body becomes an identifier `???` with its span (as `isUnnamedTarget` does for targets)
- [ ] 1.2 Each such operand gets one error at its span with CODESYS's build wording; no `syntax-error`

## 2. Test

- [ ] 2.1 The repro of proposal.md: all three statements are in `sourceStatements`, each `???` is an identifier node
- [ ] 2.2 `x := ??? AND a;` gives one error on `???` and none elsewhere in the statement
- [ ] 2.3 A plain ST body with `x := ??? AND a;` keeps today's syntax error

## 3. Consumers

- [ ] 3.1 Sim-Assist regenerates its bundle and writes `???` placeholders at once (drops its pending-insert workaround)
