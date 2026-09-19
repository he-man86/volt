/**
 * `__TRY` / `__CATCH` / `__FINALLY` / `__ENDTRY` — the one construct that changes the FAULT MODEL.
 *
 * `interp/values.ts` records what stops a CODESYS task: dividing by zero, and the logarithm of zero. Nothing else —
 * an infinity is an ordinary value. "Stops" means the scan never completes and the application is dead.
 *
 * Except that pro2193 wraps every top-level call in `__TRY … __CATCH(…) … __ENDTRY` and counts the exceptions, so
 * a real project plainly expects to SURVIVE one. That is a different fault model for the code inside the block, and
 * it is the third-largest `sole` blocker in the corpus — six POUs stopped by `stmt-try`, three of them by nothing
 * else.
 *
 * `op_sys_try_catch` asked once and asked wrong: it wrote `__CATCH(exc)` with no such variable and recorded
 * "Identifier 'exc' not defined". The operand is an EXISTING variable that receives the code, typed
 * `__SYSTEM.ExceptionCode` — pro2193 declares `ARRAY[0..50] OF __SYSTEM.ExceptionCode` for exactly this.
 *
 * So, measured one question at a time:
 *
 *   DOES THE BLOCK RUN AT ALL when nothing faults, and is the CATCH skipped?
 *   DOES A FAULT REACH THE CATCH — a divide by zero, and the logarithm of zero, the two the model knows?
 *   DOES THE SCAN COMPLETE afterwards, and does code after `__ENDTRY` run?
 *   DOES `__FINALLY` run both ways?
 *   WHAT IS THE CODE the catch operand receives?
 *
 * Each probe sets a BOOL or an INT the recorder can read, so "the scan completed" and "the catch ran" cannot be
 * confused — a case whose scan never completes records an error instead of values.
 */
import type { LanguageTest } from "../../types.js"

function probe(slug: string, decls: string, body: string, feature: string): LanguageTest {
  const pou = `FB_LANG_${slug}`
  return {
    name: slug,
    pouName: pou,
    kind: "function_block" as const,
    feature,
    fromDoc: "03-operators.md",
    plcPrgVar: `inst : ${pou};`,
    plcPrgBody: "inst();",
    source: `FUNCTION_BLOCK ${pou}\nVAR\n${decls}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n`,
  }
}

/** Every probe carries the same three readings: what ran, what the catch saw, and that the scan finished. */
const STATE = "\tran : INT;\n\tcaught : BOOL;\n\tfinallyRan : BOOL;\n\tafterEndtry : BOOL;\n\tcode : DWORD;\n\tec : __SYSTEM.ExceptionCode;\n\tzero : INT;\n\tseed : LREAL;"

export const TRY_CATCH_TESTS: readonly LanguageTest[] = [
  probe(
    "try_no_fault",
    STATE,
    "__TRY\n\tran := 1;\n__CATCH(ec)\n\tcaught := TRUE;\n\tcode := ANY_TO_DWORD(ec);\n__ENDTRY\nafterEndtry := TRUE;",
    "a __TRY block that does not fault — does the body run and the catch stay out?",
  ),
  probe(
    "try_divide_by_zero",
    STATE,
    "__TRY\n\tran := 10 / zero;\n\tran := 7;\n__CATCH(ec)\n\tcaught := TRUE;\n\tcode := ANY_TO_DWORD(ec);\n__ENDTRY\nafterEndtry := TRUE;",
    "THE QUESTION: does a divide by zero reach the catch, and does the scan then complete?",
  ),
  probe(
    "try_log_of_zero",
    STATE,
    "seed := 1.0;\n__TRY\n\tseed := LN(seed - seed);\n\tran := 7;\n__CATCH(ec)\n\tcaught := TRUE;\n\tcode := ANY_TO_DWORD(ec);\n__ENDTRY\nafterEndtry := TRUE;",
    "the model's other fault — the logarithm of zero, computed at RUN TIME so the compiler cannot fold it",
  ),
  probe(
    "try_finally_no_fault",
    STATE,
    "__TRY\n\tran := 1;\n__CATCH(ec)\n\tcaught := TRUE;\n__FINALLY\n\tfinallyRan := TRUE;\n__ENDTRY\nafterEndtry := TRUE;",
    "__FINALLY with nothing to catch",
  ),
  probe(
    "try_finally_on_fault",
    STATE,
    "__TRY\n\tran := 10 / zero;\n__CATCH(ec)\n\tcaught := TRUE;\n\tcode := ANY_TO_DWORD(ec);\n__FINALLY\n\tfinallyRan := TRUE;\n__ENDTRY\nafterEndtry := TRUE;",
    "__FINALLY when the block faulted — does it run, and in which order?",
  ),
  probe(
    "try_catch_only_on_fault",
    STATE,
    "__TRY\n\tran := 1;\n__CATCH(ec)\n\tran := 99;\n__ENDTRY\nafterEndtry := TRUE;",
    "the catch block must NOT run when the body completes — `ran` says which one wrote it",
  ),
  probe(
    "try_nested",
    STATE,
    "__TRY\n\t__TRY\n\t\tran := 10 / zero;\n\t__CATCH(ec)\n\t\tran := 1;\n\t__ENDTRY\n\tran := ran + 10;\n__CATCH(ec)\n\tcaught := TRUE;\n__ENDTRY\nafterEndtry := TRUE;",
    "a fault caught by the INNER block — does the outer one see it?",
  ),
  probe(
    "try_one_line",
    STATE,
    "__TRY ran := 10 / zero; __CATCH(ec) caught := TRUE; __ENDTRY\nafterEndtry := TRUE;",
    "THE CORPUS SHAPE, on one line, as pro2193 writes it over every top-level call",
  ),
]
