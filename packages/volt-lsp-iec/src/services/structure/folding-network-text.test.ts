/** folding over a network body: one fold per network, so an FBD/LD POU with many networks folds below the POU level. */
import { test, expect } from "bun:test"
import { parseSource } from "../../frontend/syntax/index.js"
import { foldingRanges } from "./folding.js"

test("each NETWORK in a graphical body is a foldable range", () => {
  const src = `FUNCTION_BLOCK FB_LD
VAR
\ta : BOOL; b : BOOL; out : BOOL;
END_VAR
%LANGUAGE LD
%NETWORK
out := a AND b;
%NETWORK
out := a OR b;
out := a;
END_FUNCTION_BLOCK`
  const folds = foldingRanges({ uri: "file:///F.pou", source: src, parseResult: parseSource(src, { networkText: true }, "codesys") })
  // unit + VAR + 2 networks; assert both networks fold (multi-line regions past the VAR section).
  const networkFolds = folds.filter((f) => f.startLine >= 4)
  expect(networkFolds).toHaveLength(2)
})
