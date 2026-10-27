/**
 * The outline of a network-text body (`network-symbols.ts`): its networks under their POU.
 */
import { test, expect } from "bun:test"
import { documentSymbolsWithVg } from "./network-symbols.js"
import { doc } from "../../../test/support/network-docs.js"

const LD = `FUNCTION_BLOCK FB_LD
VAR
	a : BOOL; b : BOOL; out : BOOL;
END_VAR
%LANGUAGE LD
NETWORK
out := (a AND b);
END_NETWORK
END_FUNCTION_BLOCK`

test("network text: document outline attaches networks under their POU", () => {
  const syms = documentSymbolsWithVg(doc(LD))
  const fb = syms.find((s) => s.name === "FB_LD")
  expect(fb).toBeDefined()
  expect(fb?.children?.some((c) => c.name.startsWith("NETWORK 0"))).toBe(true)
})
