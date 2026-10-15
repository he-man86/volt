/**
 * What the network text shows of a network or a box it cannot build (openspec ld-fbd-coverage 1b.4), as the bridge's
 * `NetworkTextReader` reads it: a network whose trees the text has no spelling for is the one line
 * `UNSUPPORTED "<shape>";`, and a call box read through a main output that is not its first slot is `fb(…).name`. The
 * parser consumes the tokens; the rules each is held to live here.
 */
import type { NetworkDiagnosticCode, NetworkPin } from "./ast.js"
import { isWord, type Tok } from "./lexer.js"

/** A finding the parser raises at `at`. */
interface Refusal {
  at: Tok
  code: NetworkDiagnosticCode
  message: string
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/
/** What an UNSUPPORTED line's quoted shape holds: the bridge's refusal name, words separated by one space
 *  (`NetworkSpelling.UnsupportedShape`). */
const UNSUPPORTED_SHAPE = /^[A-Za-z0-9_]+( [A-Za-z0-9_]+)*$/
/** The bit operators: they store no main output (census 1.6), so none is read by name (`NetworkSpelling.BitOperators`). */
const BIT_OPERATORS: ReadonlySet<string> = new Set(["AND", "OR", "XOR", "NOT"])

export const UNSUPPORTED_NOT_ALONE =
  "a statement after an UNSUPPORTED line: the line stands for the whole network's content, and is its network's only line."

/** `UNSUPPORTED <shape>`: refused beside other content (`content`), or when the shape is no quoted phrase. */
export function unsupportedLineRefusal(kw: Tok, shape: Tok, content: boolean): Refusal | undefined {
  if (content)
    return {
      at: kw,
      code: "NETWORK_UNSUPPORTED",
      message:
        "an UNSUPPORTED line beside other statements: it stands for the whole network's content, which Volt cannot show, and is its network's only line.",
    }
  if (shape.kind !== "string" || !UNSUPPORTED_SHAPE.test(shape.text))
    return {
      at: shape,
      code: "NETWORK_PARSE",
      message:
        'an UNSUPPORTED line names the shape Volt cannot show, as a quoted phrase: UNSUPPORTED "a flag on a box input pin";',
    }
  return undefined
}

/** A word that can follow a call's `.` as the output a consumer reads: any output name; EN is an input. */
export function isOutputName(t: Tok): boolean {
  return t.kind === "word" && IDENTIFIER.test(t.text) && !isWord(t, "EN")
}

/** `.name` on a call: refused on a box nothing consumes, on a bit operator (which stores no main output), and beside a
 *  positional `=>` pin (positional pins fill the slots after the one a consumer reads, and `.name` states no slot). */
export function namedOutputRefusal(
  output: Tok,
  head: string,
  type: string,
  consumed: boolean,
  pins: readonly NetworkPin[],
): Refusal | undefined {
  const at = output
  if (!consumed)
    return {
      at,
      code: "NETWORK_BAD_EXPRESSION",
      message: `\`.${output.text}\` on '${head}', which nothing consumes: a top-level box's output goes nowhere.`,
    }
  if (BIT_OPERATORS.has(type.toUpperCase()))
    return {
      at,
      code: "NETWORK_BAD_EXPRESSION",
      message: `\`.${output.text}\` on a ${type.toUpperCase()} box: a bit operator stores no main output to read by name.`,
    }
  if (pins.some((p) => p.kind === "output" && p.name === undefined))
    return {
      at,
      code: "NETWORK_UNSUPPORTED",
      message: `a positional \`=>\` pin beside \`.${output.text}\`: positional pins fill the slots after the one a consumer reads, and \`.${output.text}\` states no slot. Name the pin.`,
    }
  return undefined
}

/** A title or comment as the drivers store it (`NetworkText.Stored`): trimmed at the end, and none where nothing is left. */
export function stored(s: string | undefined): string | undefined {
  const t = s?.trimEnd()
  return t === undefined || t.length === 0 ? undefined : t
}
