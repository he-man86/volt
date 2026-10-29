/**
 * One message, comparably spelled. A diagnostic that QUOTES source text carries that text's line breaks with it
 * (`no-op-statement`: "The code 'n;\r\n' has no effect…"), and the two sides store the same fixture differently —
 * the fixture literal is LF (or a lone CR, where a fixture asks about one), CODESYS stores every POU CRLF. That is a
 * storage convention, not a disagreement, so every line end is normalized to LF on BOTH sides before comparing.
 */
export function comparable(message: string): string {
  return message.replace(/\r\n?/g, "\n")
}
