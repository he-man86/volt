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
    rule: "a body's declaration ends at a whole line `IMPLEMENTATION ST|LD|FBD`, outside every comment, with nothing else on it",
    home: "format/implementation-line",
    gap: false,
    fixtures: [],
    tests: [
      {
        file: "src/frontend/syntax/format/implementation-line.test.ts",
        title: "only a whole line is the boundary: a keyword with anything else on its line states no language",
      },
      {
        file: "src/frontend/syntax/format/implementation-line.test.ts",
        title: "a keyword line inside a declaration's block comment is no boundary",
      },
      // the stated language is the one signal for the reader (2.4.7)
      {
        file: "src/frontend/syntax/format/implementation-line.test.ts",
        title: "a method's and an accessor's stated language select their reader too",
      },
      {
        file: "src/frontend/syntax/format/implementation-line.test.ts",
        title: "the line is taken out of the body: the code starts under it, and it is not ST",
      },
      // …and a body without the line is the push's refusal, which the server reports (2.4.7)
      {
        file: "test/lsp/implementation-keyword-diagnostics.test.ts",
        title: "a body with no IMPLEMENTATION line is a diagnostic naming the item and `volt pull`, and read by neither reader",
      },
    ],
    design: "`implementation-line.test.ts` (from implementation-keyword.test.ts)",
  },
  {
    id: "FMT2",
    area: 2,
    section: "2.10",
    rule: "`IMPLEMENTATION <LANG> UNSUPPORTED` states an unshown body (always for CFC/SFC/IL; never for ST); the body under it is empty",
    home: "format/implementation-line",
    gap: false,
    fixtures: [],
    tests: [
      {
        file: "src/frontend/syntax/format/implementation-line.test.ts",
        title:
          "an UNSUPPORTED line states a body read by neither parser, on every language but ST, and its empty body is clean",
      },
      // "never for ST" and "the body under it is empty" (2.4.7: the second written here). By the grammar alone (openspec
      // bridge-refusal-review D9) a line that only looks like one — UNSUPPORTED after ST, words after UNSUPPORTED — is no
      // boundary, and is named as the hint of a body stating no language.
      {
        file: "src/frontend/syntax/format/implementation-line.test.ts",
        title: "a line that only looks like the boundary is none, and is named as the hint of a body stating no language",
      },
      {
        file: "src/frontend/syntax/format/implementation-line.test.ts",
        title: "code, a comment or a pragma under an UNSUPPORTED line is refused naming the line, and read by neither reader",
      },
    ],
    design: "`implementation-line.test.ts`",
  },
  {
    id: "FMT3",
    area: 2,
    section: "2.10",
    rule:
      "a bare `IMPLEMENTATION CFC|SFC|IL` is no boundary (openspec bridge-refusal-review D9): the body states no language, and the finding names the line to write",
    home: "format/implementation-line",
    gap: false,
    fixtures: [],
    tests: [
      {
        file: "src/frontend/syntax/format/implementation-line.test.ts",
        title: "a bare CFC, SFC or IL line is no boundary: the body states no language, and the hint names the line to write",
      },
      {
        file: "test/lsp/implementation-keyword-diagnostics.test.ts",
        title:
          "a body whose line only looks like the boundary states no language, and the finding names the line and what it lacks",
      },
    ],
    design: "`implementation-line.test.ts`",
  },
  {
    id: "FMT4",
    area: 2,
    section: "2.10",
    rule: "a look-alike (in a comment, after code on the line, or a line that is no boundary by the grammar — `Implementation` alone, `Implementation OR b`) is not the boundary",
    home: "format/implementation-line",
    gap: false,
    fixtures: [],
    tests: [
      {
        file: "src/frontend/syntax/format/implementation-line.test.ts",
        title: "only a whole line is the boundary: a look-alike inside an ST body switches no reader",
      },
      // openspec bridge-refusal-review D9 (4.9): the identifier on a line of its own is code
      {
        file: "src/frontend/syntax/format/implementation-line.test.ts",
        title: "an identifier spelled Implementation on a line of its own is code, not a second boundary",
      },
      {
        file: "src/frontend/syntax/format/implementation-line.test.ts",
        title: "a keyword line inside a comment opened mid-line or nested is no boundary",
      },
    ],
    design: "`implementation-line.test.ts`",
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
    rule: "a retired `(* @volt-… *)` comment is a comment: nothing is reported, and in a body that states no language it is that finding's hint (bridge-refusal-review 1.4/2.1)",
    home: "format/retired-comments",
    gap: false,
    fixtures: ["rcc_retired_comment_in_body", "pwh_gvl_retired_volt_comment"],
    tests: [
      {
        file: "src/frontend/syntax/format/retired-comments.test.ts",
        title: "a (* @volt-… *) comment in a file that states its bodies is a comment: nothing is reported",
      },
      {
        file: "src/server/handlers/diagnostics.test.ts",
        title: "server: without a manifest, a file an older Volt pulled is told to `volt pull` naming its comment — its ladder is not ST errors",
      },
    ],
    design: "rcc_retired_comment_in_body, `retired-comments.test.ts`",
  },
  {
    id: "FMT8",
    area: 2,
    section: "2.10",
    rule: "network text under IMPLEMENTATION ST is ST: the build's syntax errors and no Volt finding (bridge-refusal-review 1.1); IMPLEMENTATION is a name like any other (review 4b, 1.2)",
    home: "format/implementation-line",
    gap: false,
    fixtures: ["rcc_st_body_network", "rcc_implementation_variable", "rcc_implementation_method", "rcc_implementation_enum_value"],
    tests: [
      {
        file: "src/frontend/syntax/format/implementation-line.test.ts",
        title: "the stated language wins over what the text looks like: network text under ST is read as ST",
      },
      {
        file: "test/lsp/implementation-keyword-diagnostics.test.ts",
        title: "IMPLEMENTATION is a name like any other, in every file and every naming position: no diagnostic",
      },
      {
        file: "src/frontend/types/network/network-parse.test.ts",
        title: "the header carries LABEL, TITLE and DISABLED, and a title spells ST's escapes",
      },
      { file: "src/frontend/types/network/network-parse.test.ts", title: "an unclosed network is NETWORK_NOT_CLOSED" },
    ],
    design: "rcc_st_body_network, rcc_implementation_variable",
  },
]
