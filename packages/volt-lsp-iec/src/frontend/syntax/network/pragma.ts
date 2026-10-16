/**
 * THE PRAGMA (openspec ld-fbd-coverage 2.3) — a stored member of an NWL node the text does not imply, spelled
 * `{Member := value}` directly after its node: a port of the bridge's `NetworkPragma` (the literal) and of its member
 * table's names and kinds (`NetworkMembers.OfBox`), so the editor refuses exactly the pragmas a push refuses.
 *
 *   pragma = "{" , member { "." member } , ":=" , literal | "[" literal { "," literal } "]" , "}"
 *
 * Literals are ST's: a single-quoted string (`$'`, `$$`, `$N`, `$R`, `$T`, `$L`, `$P`, `$hh`), an integer,
 * `TRUE`/`FALSE`, an enum word.
 */
import type { NetworkDiagnosticCode, PragmaValue } from "./ast.js"

export type { PragmaValue }


/** The kinds a member takes (`PragmaKind`); a list holds strings. */
type MemberKind = "list" | "text" | "bool" | "int" | "word"

/** THE BOX MEMBERS a pragma may name — `NetworkMembers.OfBox`, name and kind. */
const BOX_MEMBERS: ReadonlyMap<string, MemberKind> = new Map<string, MemberKind>([
  ["OutputParam.Names", "list"],
  ["OutputParam.Types", "list"],
])

const MEMBER_PATH = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

/** The inside of one pragma: the member and its value, or why it is none (the bridge's wording). */
export function parsePragma(inner: string): { member: string; value: PragmaValue } | { error: string } {
  const at = inner.indexOf(":=")
  if (at < 0) return { error: "a pragma is `{Member := value}`: no `:=` in it." }
  const member = inner.slice(0, at).trim()
  if (!MEMBER_PATH.test(member)) return { error: `'${member}' is no member name: a pragma names a member as \`Name\` or \`Owner.Name\`.` }
  const r = new Literal(inner, at + 2).value(false)
  if ("error" in r) return r
  const rest = inner.slice(r.end).trim()
  if (rest.length > 0) return { error: `'${rest}' after a pragma's value: a pragma holds one member and one value.` }
  return { member, value: r.value }
}

const ESCAPES: Readonly<Record<string, string>> = { $: "$", "'": "'", N: "\n", n: "\n", L: "\n", l: "\n", R: "\r", r: "\r", T: "\t", t: "\t", P: "\f", p: "\f" }

class Literal {
  constructor(
    private readonly s: string,
    private i: number,
  ) {}

  value(inList: boolean): { value: PragmaValue; end: number } | { error: string } {
    this.skip()
    const s = this.s
    if (this.i >= s.length) return { error: "a pragma with no value after `:=`." }
    const c = s[this.i]!
    if (c === "[") {
      if (inList) return { error: "a list inside a list: a pragma's list holds literals." }
      this.i++
      const items: PragmaValue[] = []
      this.skip()
      if (s[this.i] === "]") {
        this.i++
        return { value: { kind: "list", items }, end: this.i }
      }
      for (;;) {
        const item = this.value(true)
        if ("error" in item) return item
        items.push(item.value)
        this.skip()
        if (s[this.i] === ",") {
          this.i++
          continue
        }
        if (s[this.i] === "]") {
          this.i++
          return { value: { kind: "list", items }, end: this.i }
        }
        return { error: "a pragma's list is `[a, b, …]`: items are separated by `,` and closed by `]`." }
      }
    }
    if (c === "'") return this.string()
    const start = this.i
    while (this.i < s.length && /[A-Za-z0-9_-]/.test(s[this.i]!)) this.i++
    const word = s.slice(start, this.i)
    if (word.length === 0) return { error: `'${c}' where a pragma's value is expected: a string, a number, TRUE/FALSE, a word or a list.` }
    if (/^TRUE$/i.test(word)) return { value: { kind: "bool", value: true }, end: this.i }
    if (/^FALSE$/i.test(word)) return { value: { kind: "bool", value: false }, end: this.i }
    if (/^-?[0-9]+$/.test(word)) return { value: { kind: "int", value: Number(word) }, end: this.i }
    if (IDENTIFIER.test(word)) return { value: { kind: "word", word }, end: this.i }
    return { error: `'${word}' is no literal a pragma holds.` }
  }

  private string(): { value: PragmaValue; end: number } | { error: string } {
    const s = this.s
    let out = ""
    this.i++
    for (;;) {
      if (this.i >= s.length) return { error: "an unclosed string in a pragma." }
      const d = s[this.i]!
      if (d === "'") {
        this.i++
        return { value: { kind: "text", text: out }, end: this.i }
      }
      if (d === "$") {
        const e = s[this.i + 1]
        if (e === undefined) return { error: "a `$` ending a pragma's string." }
        const v = ESCAPES[e]
        if (v !== undefined) {
          out += v
          this.i += 2
          continue
        }
        const hex = s.slice(this.i + 1, this.i + 3)
        if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16))
          this.i += 3
          continue
        }
        return { error: `the escape '$${e}' in a pragma's string: ST spells $$, $', $N, $R, $T, $L, $P and $hh.` }
      }
      out += d
      this.i++
    }
  }

  private skip(): void {
    while (this.i < this.s.length && /\s/.test(this.s[this.i]!)) this.i++
  }
}

/** Whether `value` is what `kind` takes (a list: of strings), and the code and words the bridge refuses one with. */
export function pragmaRefusal(member: string, value: PragmaValue): { code: NetworkDiagnosticCode; message: string } | undefined {
  const kind = BOX_MEMBERS.get(member)
  if (kind === undefined)
    return {
      code: "NETWORK_UNSUPPORTED",
      message: `a pragma naming '${member}', which is no member of a box the text spells (the member table: ${[...BOX_MEMBERS.keys()].join(", ")}).`,
    }
  const ok = value.kind === kind && (value.kind !== "list" || value.items.every((i) => i.kind === "text"))
  if (ok) return undefined
  return {
    code: "NETWORK_BAD_EXPRESSION",
    message: `'${member}' takes ${kind === "list" ? "a list of strings" : `a ${kind}`}, not ${spell(value)}.`,
  }
}

/** A value as the text spells it (`PragmaValue.Spell`). */
export function spell(v: PragmaValue): string {
  switch (v.kind) {
    case "text":
      return "'" + [...v.text].map(quoted).join("") + "'"
    case "bool":
      return v.value ? "TRUE" : "FALSE"
    case "int":
      return String(v.value)
    case "word":
      return v.word
    case "list":
      return "[" + v.items.map(spell).join(", ") + "]"
  }
}

/** One character of a quoted string, as the bridge writes it (`PragmaValue.Quote`): `$'`, `$$`, `$N`, `$R`, `$T`, and
 *  `$hh` for any other control character — so a pragma never spans a line. */
function quoted(c: string): string {
  if (c === "'") return "$'"
  if (c === "$") return "$$"
  if (c === "\n") return "$N"
  if (c === "\r") return "$R"
  if (c === "\t") return "$T"
  const code = c.charCodeAt(0)
  return code < 0x20 || code === 0x7f ? "$" + code.toString(16).toUpperCase().padStart(2, "0") : c
}

/** The strings a list pragma holds, or undefined where `pragmas` spell no such member. */
export function pragmaStrings(pragmas: readonly { member: string; value: PragmaValue }[] | undefined, member: string): string[] | undefined {
  const p = pragmas?.find((x) => x.member === member)
  return p?.value.kind === "list" ? p.value.items.map((i) => (i.kind === "text" ? i.text : "")) : undefined
}
