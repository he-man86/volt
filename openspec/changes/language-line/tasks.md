- [x] 1.1 design.md: the four open points decided (owner: %LANGUAGE, no line for a slotless member, no backward compat; the rest per design.md).
- [x] 1.2 Tell PLC Assist the new line and the release it lands in. (Sent 2026-10-27; they list what reads or writes `IMPLEMENTATION` on their side.)
- [x] 2.1 C#: `%LANGUAGE` in `PropertyLines` (key, value grammar, order), reader + writer, refusal of the old line by name.
- [x] 2.2 LSP: the same key in `object-properties.ts`; lexer/format reader; the false positive of family 4 gone.
  - Gate (2026-10-27), review findings, each with a failing test first:
    1. Push: an accessor's one-line `VAR … END_VAR` no longer swallows its `%LANGUAGE` line and body
       (`StReader.ClosesOnItsLine`; `LanguageLineTests.An_accessors_one_line_VAR_block_ends_at_its_END_VAR`).
    2. Push: a slotless member's declaration ends where the LSP's does — VAR blocks (the LSP's
       `VAR_SECTION_KEYWORDS`) through their `END_VAR`, wherever they stand, and trivia; a one-line block is a
       declaration, a statement between blocks or an unknown section word is code (`StReader.DeclarationOnly`; two new
       theories). `NoKindFromText` allowance 1 → 2 for the section-word list (no kind, no name).
    3. LSP: a `%`-line above the `%LANGUAGE` line is reported as a misplaced property line, as the push refuses it.
    4. LSP: the unrecorded "text above the line is no declaration" diagnostic (mapped to C0002) is REMOVED, the
       `END_VAR;` test restored to no error: what the build says about such text is not recorded — niche: accepted loss
       (0 occurrences in the corpora). Recording it was not done (design.md, "Text above the line").
    5. LSP: a no-line member is slotless only where the push can take one — a CODESYS ABSTRACT METHOD or an accessor of
       a CODESYS ABSTRACT PROPERTY; any other (not ABSTRACT, or TwinCAT) states no language, with its own message.
    6. A space or a tab separates a value's words too (`%CLASS`, `%FILE_LINK`), both grammars; `KeyEnd`'s comment says
       so. Also: `UNSUPPORTED` census in `BodyFormatGuard` 10 → 12 (the two create refusals of fix #5's push side).
    Also found: an ACTION's VAR section above its line is now reported with the push's words (`parseAction`).
  - To get the suites green the gate pulled 3.1's DATA forward: the six corpora (453 files, 2081 lines; the 12
    `IMPLEMENTATION NONE` lines dropped; 695 manifests `MATERIALIZATION 4` → 5), 17 LSP fixture files, the fixture map
    (rate:fixtures), the analysis/front-end baselines (VOLT_WRITE_BASELINE=1; two named ceiling exceptions:
    `unit_action_var_section`, `unit_method_override_public_order`, whose bodies parse now) and a `deferred.lsp` on the
    two `unit_method_override*` fixtures (niche, 0 occurrences). Not done: vendor-facts JSON, wire transcripts, docs.
    Niche, accepted: `rcc_member_name_not_identifier` (`METHOD My-Name`) lost its incidental LSP parse error.
  - Numbers (full, VOLT_REQUIRE_FULL=1, VOLT_FIXTURES unset): LSP 10392 pass / 0 fail (10854 tests, 374 files);
    C# Engine 3210 (+1 skip), Cli 377, Connector 156, Twincat 731, Codesys 518, Contracts 56, Relay 211, Repo.Gates 276
    — all green; volt-cli bun unit 225, windows 19; volt-control 149; volt-vscode 39; typecheck, lint, check green.
    Map: refused 2108 → 2106, lsp-gap 88 → 90, lowered 3626 → 3630.
- [x] 3.1 Rewrite fixtures, recordings, transcripts and corpora; regenerate the fixture map and generated docs.
  (Corpora, LSP fixtures, map and baselines landed with the step-2 gate; step 3: the vendor-facts snapshots re-recorded
  where their sources still push (diff lines: CODESYS 36, TwinCAT 98; e.g. `abstract-member-equivalence`), the five
  wire transcripts, the generated docs unchanged (DocDataTests green). The 22 CODESYS / 15 TwinCAT `nwl-*` rows and
  `graphical-callee-seed` are NOT re-recorded: their push sources use a network-text grammar the reader refused before
  this change, and network-text-st replaces it — moved to openspec `nwl-facts-rerecord`, with the open
  `nwl-editor-refill` stored-tree question.)
- [x] 3.2 Docs: items.html, network-text.html (current implementation only); also CLAUDE.md, ARCHITECTURE.md, README.md,
  driver.html, wire.html, the e2e README, ide.ps1 and record-nwl-corpus.py comments.
  - Gate (2026-10-27), review findings:
    1. DIALECT C2r stated the deleted fold (`A1`/`A2` "both pull `IMPLEMENTATION NONE`", "`AbstractMemberFold` is a
       measured equivalence"): rewritten to the re-recorded row — `A1` `%LANGUAGE ST` empty, `A2` no line; a
       `METHOD ABSTRACT` with no line is created as `AbstractPOUMethodObject`. (Doc only, no test.)
    2. The unrecordable `nwl-*` rows had no home: new openspec change `nwl-facts-rerecord` (validates), see 3.1.
    3. `vendor-facts.ts` `folderOf` guessed the core's frame from the path's shape: now by `refs.platform` — CODESYS's
       path as the core names it, TwinCAT's under the stated application, refused by name when refs states none or the
       platform is unknown. Failing tests first (3 red): a CODESYS folder outside every application (`POUs/VltF_R.pou`),
       TwinCAT with no application, an unknown platform.
    4. items.html: a tab ends a property key too, and separates a value's words. (Doc only, no test.)
  - Numbers (full, VOLT_REQUIRE_FULL=1, VOLT_FIXTURES unset): LSP 10392 pass / 0 fail / 34 skip / 428 todo (10854
    tests, 374 files, 591 s); C# Engine 3210 (+1 skip), Cli 377, Connector 156, Twincat 731, Codesys 518, Contracts 56,
    Relay 211, Repo.Gates 276 — all green; volt-cli bun unit 225 → 231, windows 19; volt-control 149; volt-vscode 39;
    typecheck, lint, check green. No fixture or transpiler change: map not regenerated.
- [ ] 4.1 Full suites + the release matrix.
  - BLOCKED (gate 2026-10-27, nothing committed): the release matrix's `mixed-version` cell is red and cannot turn
    green without an OWNER choice. 0.1.18026 and this build both say protocol 1, yet each refuses the other's push by
    name (current CLI → old bridge: "no `IMPLEMENTATION <ST|LD|FBD>` line … Run `volt pull`"; old CLI → new bridge: the
    same refusal locally, after a pull that wrote `%LANGUAGE` texts), and the advice "pull again" loops. Nothing is
    lost, but a text-format break travels over an unchanged protocol number. Choose one: (a) protocol 1 → 2 with PLC
    Assist (proposed default: the archived `relay-protocol-tracks-wire-breaks` bump rule — "a re-meant response member
    needs one" — reads `sourceText`'s format change as a bump; design.md "Not kept" says protocol stays 1 and would
    change), (b) accept a refusal-by-name in the mixed-version judge, or (c) a recorded red cell. 4.1 stays unticked.
  - To do in the next step-4 run (review findings, after the choice):
    1. `behaviour-changes.test.ts` 4.26: KEEP the original row (GVL `VAR_GLOBAL … END_VAR\n<stmt>` with NO `%`-line,
       written whole, read back verbatim, build reports errors at the GVL — the only live proof of the slotless path)
       and ADD the refusal row (same text with `%LANGUAGE ST`: `INVALID_ST` naming the item and the line, refs state
       unchanged); the file header names both. (The working tree still holds an uncommitted edit that REPLACED the
       row with the refusal row; it must become the added row, not the replacement.)
    2. Re-run 4.26 on every matrix cell (3.5.18.30, 3.5.21 64/32, 3.5.22, twincat-32), not only 3.5.22 + Project14;
       the last `runs.jsonl` record is from 934abd81b9/2a0cc8648c, not the tree under review.
    3. design.md: add the decision line — a `%LANGUAGE` line in the declaration of a kind with no body (GVL, DUT, …)
       is refused by name (`StReader.RefusePropertyLinesIn`), as the LSP reports it (`object-properties.ts`
       `misplacedPropertyMessage`).
