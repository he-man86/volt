## 1. Tests red

- [x] 1.1 Server test: a workspace of two documents, one whose `documentDiagnostics` throws (nested parentheses, the
      PLC Assist item: 5000 overflows Node 24; the suite runs on bun, which overflows from 20000, so the test nests 20000) → `workspace/diagnostic` answers both: the throwing one with exactly one `not-analysed` error
      saying its findings could not be computed, the other with its own findings. Today: the request fails.
- [x] 1.2 The same document via `textDocument/diagnostic` → the one `not-analysed` error; a second pull in the same
      generation does not compute again.

## 2. Implement

- [x] 2.1 `DiagnosticsPublisher.compute`: catch around `documentDiagnostics`, log the error with the URI, return the
      one `not-analysed` diagnostic with the computing-failed message (declarations still used). The quarantine message
      keeps only its own consequence. `computeDiagnostics` is unchanged.

## 3. Hand-off

- [x] 3.1 `volt-cli-rework` task 30 (LSP size and fuzz inputs) takes this change's measurements as input: limits on Node 24
      (parentheses 3000, `IF` 1500, flat chain 5000) and corpus maxima (7, 8, 29, 1).
- [ ] 3.2 Republish `volt-lsp-iec` for PLC Assist: LEFT FOR THE OWNER.
