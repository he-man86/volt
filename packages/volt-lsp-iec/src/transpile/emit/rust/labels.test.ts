/**
 * Jumps and labels as Rust (`labels.ts`, openspec lower-jumps-and-labels): a labeled body is a dispatch loop. That the
 * printed code builds, passes the lint policy and runs the recorded values is the replay's (`transpile-replay.test.ts`,
 * the `tr_jmp_*` and `nt_*` fixtures of `execution-g.ts`); this pins the shape.
 */
import { describe, expect, test } from "bun:test"
import { rust, wrap } from "../../../../test/support/transpile.js"

describe("emit/rust — jumps and labels", () => {
  test("several segments: a loop over a match on the segment to run next; a jump in a loop starts the dispatch over", () => {
    const code = rust(wrap("FOR i := 1 TO 10 DO\n\tIF i = 3 THEN\n\t\tJMP done;\n\tEND_IF\n\tk := k + 1;\nEND_FOR\nz := 100;\ndone:\nm := i;", "i : INT; k : INT; m : INT; z : INT;"))
    expect(code).toContain("let mut __segment_1: usize = 0;")
    expect(code).toContain("'jump_1: loop {")
    expect(code).toContain("match __segment_1 {")
    expect(code).toMatch(/__segment_1 = 1;\n\s*continue 'jump_1;/)
    expect(code).toMatch(/_ => \{\n\s*self\.m = self\.i;\n\s*break;/)
  })

  test("one segment: the loop alone, a jump `continue`", () => {
    const code = rust(wrap("again:\nn := n + 1;\ntotal := total + n;\nIF n < 5 THEN\n\tJMP again;\nEND_IF", "n : INT; total : INT;"))
    expect(code).not.toContain("__segment")
    expect(code).toMatch(/'jump_1: loop \{[\s\S]*continue 'jump_1;\n\s*\}\n\s*break;/)
  })

  test("a jump to the label at the body's end leaves it: a labeled block where nothing jumps back (`stmt_label_at_end`)", () => {
    const code = rust(wrap("IF a = 0 THEN\n\tJMP fin;\nEND_IF\nb := 2;\nJMP fin;\nb := 3;\nfin:", "a : INT; b : INT;"))
    expect(code).toMatch(/'jump_1: \{\n\s*if self\.a == 0i16 \{\n\s*break 'jump_1;\n\s*\}\n\s*self\.b = 2i16;\n\s*\}/)
    expect(code).not.toContain("loop")
    expect(rust(wrap("b := 1;\nJMP fin;\nb := 3;\nfin:", "b : INT;"))).not.toMatch(/'jump|loop|__segment/)
  })

  test("a jump last in its segment only sets the segment: no label nobody continues", () => {
    const code = rust(wrap("a := 1;\nJMP skip;\nb := 2;\nskip:\nc := 3;", "a : INT; b : INT; c : INT;"))
    expect(code).not.toContain("'jump_1")
    expect(code).not.toContain("self.b")
    expect(code).toMatch(/self\.a = 1i16;\n\s*__segment_1 = 1;/)
  })
})
