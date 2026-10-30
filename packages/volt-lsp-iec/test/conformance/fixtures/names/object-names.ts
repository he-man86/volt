/**
 * AN OBJECT'S NAME, AS THE IDE'S CREATE JUDGES IT (openspec lsp-field-followups 3; lsp-field-false-positives 8.3.1).
 *
 * Both IDEs refuse to CREATE an object named by a reserved word — "The name 'INT' is not valid for this object.", TwinCAT
 * "Creating the child named 'INT' is not possible on node (Name mismatch)" — before any build, so the refusal is the
 * vendor's whole answer (`vendorRefuses`). `names/word-positions.ts` asked three families there (a modifier, an IL operator
 * name, a type name); these ask the rest of the families the IDEs' refused-word lists hold (volt-cli
 * `scripts/vendor-facts.<vendor>.json`, fact `refused-names`) in every position that names an object — a keyword, an
 * operator function, a conversion function, a double-underscore name, a word in lower case — and a name past ASCII,
 * which the project's "Unicode identifiers" option decides (off in the recording project, DIALECT C28b).
 */
import type { LanguageTest } from "../../types.js"
import { OBJECT_POSITIONS, WORD_POSITIONS } from "./word-positions.js"

const doc = "openspec lsp-field-followups 3 — a reserved word, or a name past ASCII, as an object's name"

/** Each family's word, and the slug its fixtures are named by. The accepted control is `word-positions.ts`'s GET, which
 *  names an object in every one of these positions on both vendors. */
const WORDS: readonly { word: string; slug: string }[] = [
  { word: "CASE", slug: "case" },
  { word: "ABS", slug: "abs" },
  { word: "INT_TO_BOOL", slug: "int_to_bool" },
  { word: "a__b", slug: "double_underscore" },
  { word: "int", slug: "int_lower" },
  { word: "名前", slug: "cjk" },
  { word: "Größe", slug: "latin1" },
]

export const OBJECT_NAME_TESTS: readonly LanguageTest[] = [...OBJECT_POSITIONS].flatMap((position) =>
  WORDS.map(({ word, slug }): LanguageTest => {
    const name = `on_${position}_${slug}`
    const t: LanguageTest = {
      name,
      feature: `\`${word}\` as ${position.replace(/_/g, " ")}`,
      fromDoc: doc,
      ...WORD_POSITIONS[position]!(word, name),
      vendorRefuses: {
        codesys: `The name '${word}' is not valid for this object.`,
        twincat: `Creating the child named '${word}' is not possible on node (Name mismatch)`,
      },
      execSkip: `NOTHING TO MEASURE — neither IDE creates an object called '${word}', so there is no program to run`,
    }
    if (t.plcPrgBody === undefined) delete t.plcPrgBody
    return t
  }),
)
