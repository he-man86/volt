/**
 * One message, comparably spelled. A diagnostic that QUOTES source text carries that text's line breaks with it
 * (`no-op-statement`: "The code 'n;\r\n' has no effect…"), and the two sides store the same fixture differently —
 * the fixture literal is LF, CODESYS stores every POU CRLF. That is a storage convention, not a disagreement, so
 * it is normalized away on BOTH sides before comparing.
 */
export function comparable(message: string): string {
  return message.replace(/\r\n/g, "\n")
}
