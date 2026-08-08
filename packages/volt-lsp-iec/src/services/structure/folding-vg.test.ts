/**
 * folding over network text (graphical) bodies (P2). Folding refused graphical bodies outright, so an FBD/LD POU with
 * many networks was unfoldable below the POU level. Emit one fold per NETWORK.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../syntax/index.js"
import { foldingRanges } from "./folding.js"

test("each NETWORK in a graphical body is a foldable range", () => {
  const src = `FUNCTION_BLOCK FB_LD
VAR
\ta : BOOL; b : BOOL; out : BOOL;
END_VAR
NETWORK 0 LD
out := (a AND b);
END_NETWORK
NETWORK 1 LD
out := (a OR b);
END_NETWORK
END_FUNCTION_BLOCK`
  const folds = foldingRanges({ uri: "file:///F.fb", source: src, parseResult: parseSource(src) })
  // unit + VAR + 2 networks; assert both networks fold (multi-line regions past the VAR section).
  const networkFolds = folds.filter((f) => f.startLine >= 4)
  expect(networkFolds).toHaveLength(2)
})
