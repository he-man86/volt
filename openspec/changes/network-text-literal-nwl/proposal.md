## Why

Network text is meant to be "ST transpiled directly from the NWL", and for most of a rung it already is: NWL stores a
single-consumer producer nested inside its consumer (`FanOut.TcPOU`: the AND box is the assign's `RValue`;
`ladder-demux.TcPOU`: an OR box inside an AND box's `InputItems`), so `out := ((a AND b) OR c)` is the literal tree,
and the only vendor item that names a connection is `BoxTreeDemux` (VarId). "Always LET" would therefore move the
text **away** from NWL — it names what the vendor holds as nesting.

The complexity the owner objects to ("we did a good job, but we over-engineered") lives elsewhere: in the text-only
constructs that each smuggle one NWL fact through a round trip because the text had no direct spelling for it.

| construct | NWL fact it carries | cost today |
|---|---|---|
| `LET g<VarId>` | a Demux exists (even with one consumer, C10d/D30), its VarId, its top-level position | `LET` is not ST |
| `LET m<n>` | ONE `BoxTreeAssign` with N `OutputItems` (40 in Lenze, one with 20 coils) | one item spelled as N+1 statements; `FoldableConsumers`, TwinCAT `Unhoist` |
| `LET i<n>` | one `BoxTreeOperand` whose typed text is not a token | prelude hoisting; 23 Lenze networks once parsed into boxes |
| `LET en<n>` + `IF` | EN in input slot 0 (N13), EN shown-but-unwired, rung continuing from ENO | hoist at operand position, `MergeEnableEchoes`, render-order numbering bugs (fc_CamC_CC_Base, TrayFiller) |
| Parallel as `(in AND (b1 OR b2))` | a `BoxTreeParallel` (17 in Lenze) | comes back as AND/OR boxes on any rebuild |
| `dst := MOVE(src)` for a result pin | a top-level box's own output slot | reads back as `Assign(Box)` — a different item |
| Unspellable marker | negated/edge coil bits (0 of 576 measured targets) | stays: no project needs a spelling |
| `NETWORK <n> <LANG>` | nothing (position; a body-wide property) | renumbering, per-network language refusal |

Counted at one granularity (one line per rule an implementer codes), the language has 33 concepts, eleven of
them carrying state across statements. The spec (`docs/network-text.html`, 774 lines) still describes a
consumer-count rule the code no longer has. The round trip is only guaranteed as a text fixed point, which cannot
see a fact dropped on pull.

`test-corpus/lenze-mid` — 373 of the corpus's 394 networks, 356 of them ladder — is the readability and fidelity
oracle: 573 Demux, 40 multi-coil assigns, 17 Parallels, 226 `en` LETs.

## What Changes

Network text becomes a mechanical fold over NWL: **one statement per top-level NetworkItem, owned subtrees nested
where the vendor nests them, and a name only where the vendor names something.** No `LET`.

- **Wires**: a Demux is declared in its network's own `VAR_TEMP g0, g1 : BOOL; END_VAR` block (below the header and
  comment, one per network, absent without a Demux) and defined by a native ST assignment (`g1 := (g0 AND x);`); a
  bare `g1` elsewhere is a reference. Wire-ness comes from the declaration only — never use count or name prefix.
  `g<digits>` keeps carrying the VarId (C9) and is the only legal wire name; it must not match any name in scope,
  case-insensitively, by one reserved set on write and read. The type is read off the producer: `BOOL` for a boolean
  producer, in FBD and LD alike; a data-valued wire goes to the marker until type inference exists (census 1.17);
  the gate refuses a hand-edited type that disagrees.
- **Multi-coil assign** → ST chained assignment, one statement: `a := b S= c R= value;`.
- **Opaque leaf** → backticks in place: `` `fc_dinttotime(x,2)` ``.
- **EN/ENO** → `EN :=` is an ordinary pin (slot 0; `EN := ,` shown-unwired); a consumed enabled box is suffixed
  `.ENO`. The `IF en` form, en hoists and echo merges are deleted.
- **Result pin** → `MOVE(src, => dst);` (the box's own slot) is distinct from `dst := MOVE(src);` (an Assign).
- **Output slots** → the model carries each output's slot index and the slot a consumer is connected to; no suffix
  is the main output (`MainOutputIndex`), `.ENO` is ENO, any other slot is the marker; positional `=> v` pins fill
  the remaining slots in order; ENO is never an `=>` slot. Call heads are the BoxType verbatim (keywords included) or
  the instance; a non-token instance, target or `=>` target is backticked.
- **Parallel** → `PARALLEL([IN := feed,] b1, b2, …)`. Ordinary series/parallel contacts stay AND/OR — that is how the
  vendor stores them. **Ladder keeps the shared expression form**; no separate rung grammar. Which of lenze-mid's 54
  `X AND (a OR b)` shapes are its 17 Parallels is census 1.3; no example or golden fixes that spelling before it.
- **Coil bits** → unchanged: negated/edge coils (0 of 576 targets) keep the existing marker. A small detector keeps
  routing them, and rungs with several control-flow targets (coil + jump, two jumps), to it.
- **EXECUTE** → `EXECUTE[(EN := c)] … END_EXECUTE;`, with a value form `… END_EXECUTE.ENO` where the box is consumed
  (its only output is ENO, so `.ENO` needs no EN).
- **Edges** → `R_EDGE(x)` / `F_EDGE(x)`, IEC's edge words, spelling the IFlags bit — not an `R_TRIG` box, which would
  add an instance the IDE never had. `NOT R_EDGE(x)` is the one order with negation.
- **Terminators** → every statement ends with `;` (`END_IF;`, `END_EXECUTE;`); the empty item is the empty statement
  `;` on its own line; `value;` is a top-level item with no target.
- **Parentheses are structural** → each pair is one box; `NOT a`/`NOT (a AND b)` are the modifier, `NOT(a)`/
  `NOT((a AND b))` the NOT box — tokens decide, not whitespace.
- **Header** → `NETWORK [LABEL:] [TITLE:] [DISABLED]`, no order number, ends at its newline; the `//` comment lines
  follow it (`//` plus one space is syntax, the rest text); the language moves to a per-body marker
  `(* @volt-implementation LD *)`; ST bodies keep the bare marker.
- **Labels and jumps** → the gate refuses only what the IDE cannot hold; a jump to a missing label, a label on a
  DISABLED network and a duplicate label follow a live census (1.15), with LSP parity.
- **Pull never throws** → a shape the writer cannot spell (pin flags on CODESYS, item flags, nested Demux, a data
  wire, a backtick in operand text, a newline in a TITLE) materializes the existing marker; push refuses by name.
- **Wire validity** → undefined, undeclared, storage-op, chained, forward-referenced, non-`g<digits>` or wrongly typed
  wires are `NETWORK_BAD_EXPRESSION`; a wire declared or defined twice or matching a name in scope is
  `NETWORK_DUPLICATE_NAME`.
- **Gate** → token fixed point (layout is free, so long calls can be one pin per line), plus a model-level oracle
  `Read(Write(m)) ≅ m` that sees pull-side loss. After a push the CLI adopts the IDE's canonical re-materialization,
  so a hand layout never returns as an IDE-side change. `NETWORK_NOT_CANONICAL` reports token differences only.
- **MATERIALIZATION 2 → 3**; v1 text (`LET`, numbered headers) is refused with a "re-pull" message; no dual reader.

Concepts: 33 → 28 at equal granularity. The count is not the gain; the four LET families, the hoists, echo merges
and use counts — every rule carrying state across statements except the wire set — are. Remaining non-literal
mappings (infix sugar with absent ≡ default formals, FB type from the declaration, `.ENO`/ENO, item-level jump bit, RETURN's `???`, network
position/Ids, wire collision rename, marker-only rungs, the marker for unmeasured facts, TwinCAT structural edits via PLCopen) are listed and
justified in `docs/network-text-next.html#not-one-to-one`.

## Decisions the owner may veto

From the 2026-09-26 reviews; each is argued on the design page (`#decisions`).

1. Edges spelled `R_EDGE(x)`/`F_EDGE(x)` (was `x RISING`/`x FALLING`); a POU or instance with either name is refused.
2. No `NOT(` whitespace rule; parentheses are structural; `((a AND b))` is refused.
3. Every statement ends with `;`; the empty statement is the empty item (rejected: an `EMPTY;` keyword).
4. `S=`/`R=` and chained assignment stay (native ExST, level semantics).
5. Unmeasured vendor facts go to the marker on pull; push refuses by name; pull never throws.
6. Wires in a per-network `VAR_TEMP` typed `BOOL` from the producer (rejected: a `WIRE:` header field; a pseudo-type
   `WIRE`, lossless but not ST; a writer-inferred data type, which needs declarations the writer lacks).

## Risks

- **CODESYS pin flags are unmeasured** (`InputFlags` is never read). Until census 1.13, a pulled pin flag sends the
  body to the marker; `Input.Flags` stays in the model.
- **TwinCAT structural edits.** 66 of lenze-mid's 139 wires are fed by a leaf. If TwinCAT ladder is alike, refusing a
  Demux of a leaf in a structurally changed network blocks about half of rung edits until 4.4 measures the import;
  the refusal names the network and the reason.
- **Data wires.** If census 1.17 finds data-valued wires in real code, those bodies stay on the marker until the
  writer can infer types.

## What this is not

- Not "always LET". A named intermediate for every producer would add items the IDE never had (C10d, D30, C25) or
  need a fifth name family the reader re-nests — the opposite of a direct transcript.
- Not a separate ladder grammar. NWL stores a rung as nesting; one reader serves FBD and LD.
- Not a change to TwinCAT's import path: every create AND every structural edit on TwinCAT goes through PLCopen
  import, whose quirks (D22c, D25, D30, C25, C20) stay. The bijection holds there for value edits only; `PARALLEL`, a
  Demux of a leaf and a result pin in a structurally changed TwinCAT network are refused until measured live.
- Not a new marker class: the marker-only shapes (a coil and a jump on one rung, two jumps on one rung, negated/edge
  coils, Mux) use the existing unsupported-marker path.
- Not a v1 translator.

## Impact

- `packages/volt-cli/src/Volt.Engine/Format/Network/` — `NetworkTextWriter` becomes one fold (the m/i/en arms,
  prelude, counters, Unspellable deleted); `NetworkTextReader` becomes a token-stream recursive descent
  (`MergeEnableEchoes`, `Build` classification, `Resolve`/`Combine`, `ReferencesToDemux`, `FoldableConsumers` deleted);
  `NetworkTextGate` compares tokens; `NetworkModel` gains output slot indices and a connection slot;
  `NetworkModel.Input.Flags` deleted only if census 1.13 finds it empty on CODESYS; the Unspellable detector shrinks
  to the marker-only shapes plus the marker routing for unmeasured facts.
- `ImplementationMarker` (today an exact match on the bare marker), `StReader` and the LSP body detection — the
  per-body `FBD|LD` argument; `BodyMarker` (`@volt-graphical`) unchanged.
- `Volt.Cli` sync — after a push, adopt the IDE's canonical re-materialization as `volt/ide` and the working tree.
- `Volt.Ide.Codesys` — builds `BoxTreeParallel` and the unnamed output-slot operand from text.
- `Volt.Ide.Twincat` — `TcNetworkWriter.Unhoist`'s legacy fold deleted; the D25 component count stays; refusals for
  `PARALLEL`, a leaf Demux and a result pin in a structurally changed network.
- `packages/volt-lsp-iec/src/network-text`, `src/network` — the `VAR_TEMP` wire block, chained targets, backticks,
  `.ENO`, `=> v`, EN on any call, `R_EDGE`/`F_EDGE`, structural parentheses, PARALLEL, EXECUTE value form, label
  diagnostics at build parity; LET, `parseEnEnoIf`, `isEnBinding` deleted; wire
  semantic-token class; `collectVoidCallTargets`, `isBoxOutput`, `checkHoles` learn `=> v` and `.ENO`.
- `volt-vscode` — TextMate rules for backticks, a network's `VAR_TEMP` and the edge words.
- Tests: ~30 C# goldens, ~16 e2e body lines, ~25 LSP goldens, the graphical conformance fixtures rewritten for the
  same NWL shapes; six corpora re-pulled; the live e2e graphical suite on both vendors.
- Docs: `docs/network-text-next.html` (this design) replaces `docs/network-text.html` when the change lands; it
  keeps the anchors ~27 code/test/doc comments link to, and joins the docs nav as "Network text (next)" until then.
- Users: pending graphical edits must be pushed before upgrading (v1 text is refused after MATERIALIZATION 3); CLI,
  LSP and volt-vscode ship together, with a version check that names a mismatch.
