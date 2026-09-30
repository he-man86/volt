/**
 * A NETWORK-TEXT BODY'S HEADER as the file format recognizes one (rule FMT8): `NETWORK` with a header field on its
 * line, or `NETWORK` alone with an `END_NETWORK` line later — the test a body stated `IMPLEMENTATION ST` is held against
 * (network text there is reported, never re-read as a network). The network grammar itself is `network-text/`'s.
 */
import { expect, test } from "bun:test"
import { lex } from "../lex/lexer.js"
import { opensNetwork } from "./network-header.js"

const opens = (text: string): boolean => opensNetwork(lex(text, "codesys").filter((t) => t.kind !== "eof"))

test("a network opens with a fielded header, or a bare NETWORK closed by END_NETWORK", () => {
  expect(opens("NETWORK LABEL: start\nout := a;\nEND_NETWORK")).toBe(true)
  expect(opens("NETWORK TITLE: 'x'\nEND_NETWORK")).toBe(true)
  expect(opens("NETWORK\nout := a;\nEND_NETWORK")).toBe(true)
  // a name `network` in an ST statement opens nothing: no header field, and no END_NETWORK line
  expect(opens("network := 1;")).toBe(false)
  expect(opens("NETWORK\nout := a;")).toBe(false)
})
