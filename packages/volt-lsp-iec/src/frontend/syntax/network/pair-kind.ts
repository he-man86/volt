/**
 * The pair-kind decision — what a position holds, decided by what FOLLOWS it, never by spacing: whether the pair of
 * parentheses after a word is its argument list or a group (`pairAheadHoldsOperator`), whether a position is empty, a
 * pin's name or a storage operator. Each asks the lexer standing right after the token in hand, as the bridge reader
 * (`NetworkTextReader`) asks its `NetworkLexer`; none of them moves it.
 */
import { NetworkLexer, type Tok, isOperator, isSym, isWord } from "./lexer.js"

/**
 * Whether the pair of parentheses that comes next holds an infix operator at its OWN depth — asked right after an
 * operator word, NOT or an edge word. Parentheses are structural: after `AND` a pair holding an operator is a group
 * (the word was the operator after an empty slot), any other pair is the word's argument list. Spacing plays no part.
 * Scanned on a fork through `Walk`, so backticks, titles and EXECUTE bodies inside the pair are skipped as the units
 * they are: an `AND` in a snippet's ST is not the pair's operator. Scanning raw tokens instead read that `AND` as one,
 * called the head an operator after an empty slot, and refused text the bridge's own writer emits.
 */
function pairAheadHoldsOperator(lx: NetworkLexer): boolean {
  const f = lx.fork()
  const w = new Walk(f)
  if (!isSym(w.next(), "(")) return false
  for (;;) {
    const t = w.next()
    if (t.kind === "eof") return false
    if (isSym(t, ")") && w.depth === 0) return false
    // An operator word is an infix operator here unless it is a pin's name or a CALL HEAD — a word whose own pair
    // holds no operator (the same rule, one level down).
    if (w.depth === 1 && isOperator(t) && !(t.kind === "word" && (f.pinOperatorFollows() || argumentListAhead(f)))) return true
  }
}

/** Whether an argument list comes next: a pair of parentheses holding no operator at its own depth. Asked after an
 *  operator word or NOT — such a word followed by one is a call head (`AND(EN := go, a, b)`, the NOT box). */
export function argumentListAhead(lx: NetworkLexer): boolean {
  return lx.peekChar() === "(" && !pairAheadHoldsOperator(lx)
}

/** An empty position: nothing stands where a value could. An operator word is a call head only when the pair after it
 *  is an argument list; a pair holding an operator is a group, so the word was the operator after an empty slot.
 *  Asked of the lookahead token, so the lexer stands right after it. */
export function isEmptyAt(t: Tok, lx: NetworkLexer): boolean {
  return (
    isSym(t, ",") ||
    isSym(t, ")") ||
    isSym(t, ";") ||
    isWord(t, "THEN") ||
    (isOperator(t) && !(t.kind === "word" && argumentListAhead(lx)))
  )
}

/** Whether `t` is a pin's NAME: a word with `:=` or `=>` after it. */
export function isPinNameAt(t: Tok, lx: NetworkLexer): boolean {
  return t.kind === "word" && lx.pinOperatorFollows()
}

/** `:=`, or ExST's `S=` / `R=` — a word `S` or `R` and `=`, however spaced. After a target nothing else can follow in
 *  that shape, while inside a group `(R = x)` is a comparison; so the position decides, never the spacing. */
export function isStorageAt(t: Tok, lx: NetworkLexer): boolean {
  return isSym(t, ":=") || ((isWord(t, "S") || isWord(t, "R")) && lx.equalsFollows())
}

/**
 * The tokens of a text as the reader consumes them, without reading it — the bridge's `NetworkLexer.Walk`. Every
 * EXECUTE body is entered where the reader enters one: at an `EXECUTE` that is no pin's name, no `JMP` label and no
 * header `LABEL:`, right after it or after the pin list `(EN := …)` that follows it (however deep that list nests
 * another EXECUTE), and comes out as its snippet and its `END_EXECUTE`. So an ST line inside a snippet is never lexed
 * as network tokens by a look-ahead.
 */
class Walk {
  /** Open parentheses after the last token returned. */
  depth = 0
  /** The depth an `EXECUTE(EN := …)` head's pair closes back to. */
  private readonly executeAt: number[] = []
  private readonly body: Tok[] = []
  // The two tokens returned before the one in hand: a LABEL's name follows `LABEL :`, a jump's follows `JMP`.
  private before: Tok | undefined
  private last: Tok | undefined

  constructor(private readonly lx: NetworkLexer) {}

  next(): Tok {
    const t = this.body.length > 0 ? this.body.shift()! : this.lexed()
    this.before = this.last
    this.last = t
    return t
  }

  private lexed(): Tok {
    const t = this.lx.next()
    if (isSym(t, "(")) this.depth++
    else if (isSym(t, ")")) {
      this.depth--
      if (this.executeAt.length > 0 && this.executeAt[this.executeAt.length - 1] === this.depth) {
        this.executeAt.pop()
        this.enterBody()
      }
    }
    // In VALUE position only, as the reader opens one: a pin's name (`execute :=`) and a label (`LABEL: Execute`,
    // `JMP Execute`) open no body.
    else if (
      isWord(t, "EXECUTE") &&
      !this.lx.pinOperatorFollows() &&
      !(this.last !== undefined && isWord(this.last, "JMP")) &&
      !(this.last !== undefined && isSym(this.last, ":") && this.before !== undefined && isWord(this.before, "LABEL"))
    ) {
      if (this.lx.peekOnLine() === "(") this.executeAt.push(this.depth)
      else this.enterBody()
    }
    return t
  }

  private enterBody(): void {
    const { snippet, end } = this.lx.executeBody()
    this.body.push(snippet)
    // An error has consumed its text and the lexer goes on from it, as the reader's recovery does.
    if (snippet.kind !== "error") this.body.push(end)
  }
}
