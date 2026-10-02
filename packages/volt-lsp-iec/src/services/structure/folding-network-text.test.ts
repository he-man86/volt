/**
 * folding over network text (graphical) bodies (P2). Folding refused graphical bodies outright, so an FBD/LD POU with
 * many networks was unfoldable below the POU level. Emit one fold per NETWORK.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../frontend/syntax/index.js"
import { foldingRanges } from "./folding.js"

test("each NETWORK in a graphical body is a foldable range", () => {
  const src = `FUNCTION_BLOCK FB_LD
VAR
\ta : BOOL; b : BOOL; out : BOOL;
END_VAR
IMPLEMENTATION LD
NETWORK
out := (a AND b);
END_NETWORK
NETWORK
out := (a OR b);
END_NETWORK
END_FUNCTION_BLOCK`
  const folds = foldingRanges({ uri: "file:///F.pou", source: src, parseResult: parseSource(src, { networkText: true }) })
  // unit + VAR + 2 networks; assert both networks fold (multi-line regions past the VAR section).
  const networkFolds = folds.filter((f) => f.startLine >= 4)
  expect(networkFolds).toHaveLength(2)
})
