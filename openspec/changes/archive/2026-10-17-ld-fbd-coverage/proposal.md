> Superseded 2026-10-30: the current network-text spelling is packages/volt-cli/docs/network-text.html.

## Why

The owner (2026-09-28): "we need to support all ld and fbd" — `IMPLEMENTATION LD|FBD UNSUPPORTED` is a temporary state to
eliminate, not a feature. Volt claims to read LD and FBD; a body it cannot show is a gap (unlike CFC, SFC and IL, which are
deliberately unsupported). Measured by the census (tasks 0.1, 2026-10-12): 12 of 46 LD/FBD bodies across the six corpora
pull UNSUPPORTED, all on CODESYS, over six shapes — a bit operator connected by a stored output slot (7 networks in 5
bodies), an assign below the top level (lenze-mid `SpeedCalculationDryer` 0, `Mach1_MIDS` 7/29/52, `Dryer` 1, `TrayFiller`
30 — 6 networks in 4 bodies; 0-based network positions), a wire of unknown type (6 in 3), a main output other than slot 0,
a call through `SUPER^`, and a flag on a box input pin (1 each).

Carried in by earlier changes:
- `vendor-fact-probe` 4.2: which deferred `probe-nwl-*` facts (and DIALECT N23, N25) become rows in
  `scripts/vendor-facts.table.ts`.
- `lsp-same-standard` 5.2: network text is the only code left on the package's shrink-only lists — `syntax/network/parser.ts`
  1372 lines (`parseNetwork` 101, `parseCall` 90), `syntax/network/lexer.ts` 414 (`next` 95),
  `analysis/checks/network/network-analysis.ts` 521, `services/network/network.test.ts` 1213; dead-export allowlist
  `TokKind`, `CONSTRUCT_WORDS`, `v1Refusal`, `resolveAnywhere`. Network text was exempt from refactoring until this change.

## What Changes

- **Census first:** every `UNSUPPORTED` reason the bridge gives for an LD or FBD body across the six corpora, per vendor,
  counted per shape (both bridges pulling the corpora; the refusal text names the shape).
- **A spelling per shape** in network text (`packages/volt-cli/docs/network-text.html`), designed against the NWL model
  (trees; only a Demux split point is named — `network-text-v2-clean-text-layer`), identical on both vendors, round-tripped
  through both IDEs and built. **The design is reviewed by the owner before any code** (it extends a file format).
- **Then build,** shape by shape, test-first: writer, reader, gate, the LSP parser and checks; each shape recorded on both
  vendors (pull → push → pull fixed point + build), until the corpora pull no LD/FBD body as UNSUPPORTED.
- **Network text brought to the package standard:** the parser, lexer, network checks and network tests split by concern;
  the shrink-only entries emptied; the dead exports gone.
- **The NWL vendor facts** that need a graphical body built through the vendor API become probe-table rows.

## Impact

`packages/volt-cli` (`Format/Network`, both drivers' NWL read/write), `packages/volt-lsp-iec` (network-text syntax, checks,
services), `docs/network-text.html`, the probe table, DIALECT N-rows. A file-format extension: bodies that pull as
UNSUPPORTED today pull as network text after it (a re-pull rewrites them).
