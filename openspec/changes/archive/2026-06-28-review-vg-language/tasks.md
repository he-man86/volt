## 1. Implementation (shipped)

- [x] 1.1 Bridge round-trip PlcOpen XML ⇄ VG; CFC/SFC surfaced read-only
- [x] 1.2 LSP analyzes VG as a sublanguage (`NETWORK` routing, `queries/vg/`); `vg-undefined-label` quick-fix
- [x] 1.3 `volt-vscode` content-injection on the `NETWORK` token (whole files + inlined graphical methods)

## 2. Review + capture

- [x] 2.1 Verify the first-class-language + exact-round-trip + content-detection contracts (D12)
- [x] 2.2 Author `specs/vg-language/spec.md`
- [x] 2.3 `openspec validate review-vg-language`
