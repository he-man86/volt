## 1. Tests red

- [ ] 1.1 Server test: a workspace of two documents, one whose `documentDiagnostics` throws (5000 nested parentheses, the
      PLC Assist item) → `workspace/diagnostic` answers both: the throwing one with exactly one `not-analysed` error
      saying its findings could not be computed, the other with its own findings. Today: the request fails.
- [ ] 1.2 The same document via `textDocument/diagnostic` → the one `not-analysed` error; a second pull in the same
      generation does not compute again.

## 2. Implement

- [ ] 2.1 `DiagnosticsPublisher.compute`: catch around `documentDiagnostics`, log the error with the URI, return the
      one `not-analysed` diagnostic with the computing-failed message (declarations still used). The quarantine message
      keeps only its own consequence. `computeDiagnostics` is unchanged.

## 3. Hand-off

- [ ] 3.1 `volt-cli-rework` task 30 (LSP size and fuzz inputs) takes this change's measurements as input: limits on Node 24
      (parentheses 3000, `IF` 1500, flat chain 5000) and corpus maxima (7, 8, 29, 1).
- [ ] 3.2 Republish `volt-lsp-iec` for PLC Assist: LEFT FOR THE OWNER.
