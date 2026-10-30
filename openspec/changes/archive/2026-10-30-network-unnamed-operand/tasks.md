> Written from Sim-Assist; built in volt-lsp-iec 2026-10-30.

## 1. Front-end

- [x] 1.1 `???` in an operand position of a network body becomes an identifier `???` with its span (`???` is one identifier token wherever it stands in a network, as `StNetworkReader` lexes it)
- [x] 1.2 Each such operand gets the build's errors at its span, no `syntax-error`: the recorded pair "Expression expected instead of '?'" + "Unexpected token '?' found" (`network_unnamed_input_pin`, `network_unnamed_group_operand`, both vendors), code `network-unnamed-target`

## 2. Test

- [x] 2.1 The repro of proposal.md: all three statements are in `sourceStatements`, each `???` is an identifier node
- [x] 2.2 `x := ??? AND a;` gives the build's pair on `???` and nothing elsewhere in the statement
- [x] 2.3 A plain ST body with `x := ??? AND a;` keeps today's syntax error

## 3. Consumers

- [x] 3.1 Sim-Assist regenerates its bundle and writes `???` placeholders at once (drops its pending-insert workaround) — handed to Sim-Assist
