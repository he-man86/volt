/**
 * the front-end's rules, area by area (`rules.ts`) — part I: 2.10.
 *
 * One slice of `rules.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a test support
 * file is held to 400 lines).
 */

import { Rule } from "./rules-shared.js"

export const RULES_I: readonly Rule[] = [
  // ── 2.10 ──
  {
    id: "FMT1",
    area: 2,
    section: "2.10",
    rule: "a body's declaration ends at its `%LANGUAGE` line — a `%`-line alone on its line, outside every comment, wherever it stands (what stands above it is the declaration's)",
    home: "format/language-line",
    gap: false,
    fixtures: [],
    tests: [
      { file: "src/frontend/syntax/format/language-line.test.ts", title: "a %LANGUAGE word that is no line — after code, in another case of the key, in a comment — is no boundary" },
      { file: "src/frontend/syntax/format/language-line.test.ts", title: "a line inside a comment is no boundary" },
      // the line wherever it stands; what stands above it is the declaration's, and draws nothing no recording backs
      { file: "src/frontend/syntax/format/language-line.test.ts", title: "text between the last END_VAR and the line is the declaration's, and draws nothing no recording backs" },
      // …but a %-line above it is the push's refusal, reported as misplaced
      { file: "src/frontend/syntax/format/language-line.test.ts", title: "a property line above the line is reported as misplaced, as the push refuses it" },
      // the stated language is the one signal for the reader (2.4.7)
      { file: "src/frontend/syntax/format/language-line.test.ts", title: "a method's and an accessor's stated language select their reader too" },
      { file: "src/frontend/syntax/format/language-line.test.ts", title: "the line is taken out of the body: the code starts under it" },
      // …and a body without the line is the push's refusal, which the server reports (2.4.7)
      { file: "test/lsp/language-line-diagnostics.test.ts", title: "a body with no %LANGUAGE line is a diagnostic naming the item and `volt pull`, and read by neither reader" },
      // …except a member with no body slot, which states none (openspec language-line, DIALECT C2n)
      { file: "src/frontend/syntax/format/language-line.test.ts", title: "a workspace METHOD and accessor with no line and nothing after the declaration have no body slot, and are clean" },
      { file: "test/lsp/language-line-diagnostics.test.ts", title: "a member with no body slot draws no diagnostic, and code after a member's declaration with no line is the finding" },
      // …and only where the push can take one: a CODESYS ABSTRACT member
      { file: "src/frontend/syntax/format/language-line.test.ts", title: "a no-line member that is not ABSTRACT, or on TwinCAT, is no member without a slot" },
    ],
    design: "`language-line.test.ts` (from implementation-keyword.test.ts)",
  },
  {
    id: "FMT2",
    area: 2,
    section: "2.10",
    rule: "`%LANGUAGE <LANG> UNSUPPORTED` states an unshown body (always for CFC/SFC/IL; never for ST); the body under it is empty",
    home: "format/language-line",
    gap: false,
    fixtures: [],
    tests: [
      {
        file: "src/frontend/syntax/format/language-line.test.ts",
        title:
          "an UNSUPPORTED line states a body read by neither parser, on every language but ST, and its empty body is clean",
      },
      // "never for ST" and "the body under it is empty" (2.4.7: the second written here): a %LANGUAGE line is never code,
      // so UNSUPPORTED after ST, or words after UNSUPPORTED, is reported naming what the line lacks.
      { file: "src/frontend/syntax/format/language-line.test.ts", title: "a line that states no body is reported naming it and what it lacks" },
      {
        file: "src/frontend/syntax/format/language-line.test.ts",
        title: "code, a comment or a pragma under an UNSUPPORTED line is refused naming the line, and read by neither reader",
      },
    ],
    design: "`language-line.test.ts`",
  },
  {
    id: "FMT3",
    area: 2,
    section: "2.10",
    rule:
      "a bare `%LANGUAGE CFC|SFC|IL` states no body: reported on its line naming the UNSUPPORTED line to write; the retired `IMPLEMENTATION` line is named where a body states none, saying to pull again",
    home: "format/language-line",
    gap: false,
    fixtures: [],
    tests: [
      { file: "src/frontend/syntax/format/language-line.test.ts", title: "a line that states no body is reported naming it and what it lacks" },
      { file: "test/lsp/language-line-diagnostics.test.ts", title: "a bare CFC, SFC or IL line is a keyword diagnostic naming the UNSUPPORTED line, and read by neither reader" },
      { file: "test/lsp/language-line-diagnostics.test.ts", title: "a body under the retired IMPLEMENTATION line states no language, and the finding says to pull again" },
    ],
    design: "`language-line.test.ts`",
  },
  {
    id: "FMT4",
    area: 2,
    section: "2.10",
    rule: "a look-alike (in a comment, after code on the line, or a line that is no boundary by the grammar — `Implementation` alone, `Implementation OR b`) is not the boundary",
    home: "format/language-line",
    gap: false,
    fixtures: [],
    tests: [
      { file: "src/frontend/syntax/format/language-line.test.ts", title: "a line inside an ST body's comment switches no reader" },
      // openspec bridge-refusal-review D9 (4.9): the identifier on a line of its own is code
      { file: "src/frontend/syntax/format/language-line.test.ts", title: "an identifier spelled Implementation on a line of its own is code, not a line" },
      { file: "src/frontend/syntax/format/language-line.test.ts", title: "a line inside a comment is no boundary" },
    ],
    design: "`language-line.test.ts`",
  },
  {
    id: "FMT5",
    area: 2,
    section: "2.10",
    rule: "`%FOLDER <path>` is read only on the line directly under a METHOD's or ACTION's keyword line, alone on its line; a property's or interface member's is peeled from the declaration's last line (`StReader.PeelFolderClosing`)",
    home: "format/object-properties",
    gap: false,
    fixtures: [],
    tests: [
      {
        file: "src/frontend/syntax/format/object-properties.test.ts",
        title: "a property's folder is the last line of its declaration",
      },
      {
        file: "src/frontend/syntax/format/object-properties.test.ts",
        title: "an interface method's folder is the line before END_METHOD, an interface property's the last before its accessors",
      },
      {
        file: "src/frontend/syntax/format/object-properties.test.ts",
        title:
          "a member's %FOLDER is read where the push peels it, and nowhere else — elsewhere it is code the IDE would get",
      },
    ],
    design: "`folder.test.ts` (from units/folder-directive.test.ts)",
  },
  {
    id: "FMT6",
    area: 2,
    section: "2.10",
    rule: 'a `%FOLDER` line anywhere else is reported ("is no folder the push reads here")',
    home: "format/object-properties",
    gap: false,
    fixtures: [],
    tests: [
      {
        file: "src/frontend/syntax/format/object-properties.test.ts",
        title: "a %FOLDER line anywhere the push does not peel it is reported, as the push refuses it",
      },
    ],
    design: "`folder.test.ts`",
  },
  {
    id: "FMT7",
    area: 2,
    section: "2.10",
    rule: "a `(* @volt-… *)` comment is a comment: nothing is reported, and a body that states no language is told to `volt pull` (bridge-refusal-review 1.4/2.1)",
    home: "format/source-object",
    gap: false,
    fixtures: ["rcc_retired_comment_in_body", "pwh_gvl_retired_volt_comment"],
    tests: [
      {
        file: "src/frontend/syntax/format/source-object.test.ts",
        title: "a POU still is — and so is text read with no object",
      },
      {
        file: "src/server/handlers/diagnostics.test.ts",
        title: "server: without a manifest, a file whose bodies state no language is told to `volt pull` — its ladder is not ST errors",
      },
    ],
    design: "rcc_retired_comment_in_body, `retired-comments.test.ts`",
  },
  {
    id: "FMT8",
    area: 2,
    section: "2.10",
    rule: "network text under %LANGUAGE ST is ST: the build's syntax errors and no Volt finding (bridge-refusal-review 1.1); IMPLEMENTATION is a name like any other (review 4b, 1.2)",
    home: "format/language-line",
    gap: false,
    fixtures: ["rcc_st_body_network", "rcc_implementation_variable", "rcc_implementation_method", "rcc_implementation_enum_value"],
    tests: [
      {
        file: "src/frontend/syntax/format/language-line.test.ts",
        title: "the stated language wins over what the text looks like: network text under ST is read as ST",
      },
      {
        file: "test/lsp/language-line-diagnostics.test.ts",
        title: "IMPLEMENTATION is a name like any other, in every file and every naming position: no diagnostic",
      },
      {
        file: "src/frontend/syntax/network/plain-st.test.ts",
        title: "networks and their % lines: the title, %DISABLED, %WIRES, an Execute box from its line to %END_EXECUTE",
      },
    ],
    design: "rcc_st_body_network, rcc_implementation_variable",
  },
]
