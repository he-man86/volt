/**
 * AN INITIALIZER IS NOT A FOLD — it is an initialisation SEQUENCE, and this measures its rules.
 *
 * `declarations/constant-folding.ts` established the shape of the question. Every CONSTANT expression folds, to
 * exactly what it computes at run time. But three of its cells are not constants and are not refused either:
 *
 *   other : INT := -7;  i : INT := ABS(other);     i = 7
 *   i : INT := ABS(other);  other : INT := -7;     i = 0   — `other` was still at its default
 *   i : INT := UserFunction()                      it RUNS, and sees a global that is already initialized
 *
 * So initializers execute, in declaration order, after the globals. That is enough to know they are a sequence and
 * not enough to model one. What is missing:
 *
 *   HOW OFTEN      once at start-up, or at the top of every scan? Everything else depends on this answer.
 *   WHERE IN THE   an FB instance's FB_Init runs in this same step. Does a scalar initializer see what an
 *   ORDER          FB_Init wrote, or does it run first?
 *   HOW FAR        `ADR(x)` is the corpus's third-largest blocking shape (180 uses). `THIS^` is the second.
 *                  A member of another variable, and a global read, are the same question at other shapes.
 *
 * Each probe reads its answer back after several scans where the count could differ, so "once" and "every scan"
 * cannot be confused.
 */
import type { LanguageTest } from "../../types.js"

function probe(slug: string, decls: string, body: string, feature: string, cycles = 3): LanguageTest {
  const pou = `FB_LANG_${slug}`
  return {
    name: slug,
    pouName: pou,
    kind: "function_block" as const,
    feature,
    fromDoc: "06-data-types.md",
    cycles,
    plcPrgVar: `inst : ${pou};`,
    plcPrgBody: "inst();",
    source: `FUNCTION_BLOCK ${pou}\nVAR\n${decls}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n`,
  }
}

/**
 * THE SAME SEQUENCE IN A PROGRAM'S OWN FRAME, which is the one place lowering can run it.
 *
 * The probes above declare inside a FUNCTION_BLOCK, because that is what most of these questions need — `THIS`,
 * and a sibling instance's FB_Init. But an FB's fields are laid out per instance, and an instance's initializers
 * run per instance, which is the FB_Init machinery rather than the POU's init step. So the shapes that do NOT
 * need an instance are asked again HERE, in PLC_PRG's own declarations, where the answer is the one the
 * implementation has to reproduce.
 */
function inProgram(slug: string, decls: string, body: string, feature: string, cycles = 3): LanguageTest {
  return {
    name: slug,
    pouName: `PRG_LANG_${slug}`,
    kind: "program" as const,
    feature,
    fromDoc: "06-data-types.md",
    cycles,
    source: "",
    plcPrgVar: decls,
    plcPrgBody: body,
  }
}

const inProgramFrame: LanguageTest[] = [
  inProgram(
    "initprg_runs_once",
    "counter : INT;\n\tcounter2 : INT := counter;" ,
    "counter := counter + 1;",
    "a PROGRAM's own initializer — once before the first scan, or every scan?",
  ),
  inProgram("initprg_reads_earlier", "other : INT := -7;\n\tired : INT := ABS(other);", ";", "reading a declaration BEFORE it"),
  // THE ONE CELL THE HARNESS CANNOT ANSWER. Asked twice, it comes back "Login failed..." rather than a value or a
  // refusal — the application does not start. Its FB twin `cfold_non_constant_argument` asks the same question and
  // answers 0, so nothing is lost; what is unknown is whether reading a LATER declaration behaves differently in a
  // PROGRAM, and this harness cannot say.
  {
    ...inProgram("initprg_reads_later", "ilate : INT := ABS(other2);\n\tother2 : INT := -7;", ";", "reading a declaration AFTER it"),
    execSkip:
      "recorded twice as \"Login failed...\" — the application does not start, which is neither a value nor a compile refusal. `cfold_non_constant_argument` is the same question in an FB and answers 0.",
  },
  inProgram("initprg_adr_of_later", "pl : POINTER TO INT := ADR(xl);\n\txl : INT := 5;\n\tthroughl : INT;", "throughl := pl^;", "ADR of a later declaration"),
  inProgram("initprg_adr_of_earlier", "xe : INT := 5;\n\tpe : POINTER TO INT := ADR(xe);\n\tthroughe : INT;", "throughe := pe^;", "ADR of an earlier one"),
  {
    ...inProgram("initprg_user_function", "iu : INT := FUN_LANG_initprg_double(3);", ";", "a user FUNCTION in a PROGRAM's initializer"),
    // the file is named after the unit its SOURCE declares — `signature-name` compares the two, and correctly
    pouName: "FUN_LANG_initprg_double",
    source: "FUNCTION FUN_LANG_initprg_double : INT\nVAR_INPUT\n\tn : INT;\nEND_VAR\nFUN_LANG_initprg_double := n * 2;\nEND_FUNCTION\n",
  },
]


export const INIT_SEQUENCE_TESTS: readonly LanguageTest[] = [
  ...inProgramFrame,
  // HOW OFTEN. `counter` is bumped by the body every scan and `startedAt` is initialized from it. Run three scans:
  // if `startedAt` is 0 the initializer ran ONCE before the first scan; if it tracks `counter` it runs every scan.
  probe(
    "initseq_runs_once_or_every_scan",
    "\tcounter : INT;\n\tstartedAt : INT := counter;",
    "counter := counter + 1;",
    "does an initializer run ONCE at start-up, or at the top of every scan?",
  ),
  // WHERE IN THE ORDER. `holder`'s FB_Init writes 5 into its own field; `seen` is initialized from that field.
  // 5 means the scalar initializer runs AFTER the FB_Init of an instance declared before it; 0 means before.
  {
    ...probe(
      "initseq_after_fb_init",
      "\tholder : FB_LANG_initseq_target;\n\tseen : INT := holder.started;",
      "seen := seen;",
      "does a scalar initializer see what a sibling instance's FB_Init wrote?",
    ),
    source:
      "FUNCTION_BLOCK FB_LANG_initseq_target\nVAR\n\tstarted : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n" +
      "METHOD FB_Init : BOOL\nVAR_INPUT\n\tbInitRetains : BOOL;\n\tbInCopyCode : BOOL;\nEND_VAR\nstarted := 5;\nEND_METHOD\n\n" +
      "FUNCTION_BLOCK FB_LANG_initseq_after_fb_init\nVAR\n\tholder : FB_LANG_initseq_target;\n\tseen : INT := holder.started;\nEND_VAR\nseen := seen;\nEND_FUNCTION_BLOCK\n",
  },
  // ...and the same pair with the INSTANCE declared LAST. `initseq_after_fb_init` has the instance first, so
  // declaration order alone explains its answer. If this one also sees 5, every FB_Init runs before every scalar
  // initializer; if it sees 0, the two interleave in declaration order.
  {
    ...probe(
      "initseq_fb_init_declared_last",
      "",
      "seen := seen;",
      "a scalar initializer reading an instance declared AFTER it — order, or a separate step?",
    ),
    source:
      "FUNCTION_BLOCK FB_LANG_initseq_fb_init_declared_last\nVAR\n\tseen : INT := holder.started;\n\tholder : FB_LANG_initseq_target;\nEND_VAR\nseen := seen;\nEND_FUNCTION_BLOCK\n",
  },
  // HOW FAR — the three shapes the corpus blocks on, each read through so the ADDRESS is proved rather than the
  // pointer's bits compared.
  probe(
    "initseq_adr_of_later",
    "\tp : POINTER TO INT := ADR(x);\n\tx : INT := 5;\n\tthrough : INT;",
    "through := p^;",
    "ADR(x) where x is declared AFTER — the corpus's third-largest blocking shape",
  ),
  probe(
    "initseq_adr_of_earlier",
    "\tx : INT := 5;\n\tp : POINTER TO INT := ADR(x);\n\tthrough : INT;",
    "through := p^;",
    "the same with x declared BEFORE, so ORDER is held separate from ADR",
  ),
  probe(
    "initseq_this",
    "\tself : POINTER TO FB_LANG_initseq_this := THIS;\n\tn : INT := 3;\n\tthrough : INT;",
    "through := self^.n;",
    "THIS as an initial value — the corpus's second-largest blocking shape",
  ),
  probe(
    "initseq_member_of_struct",
    "\tcfg : ST_LANG_initseq := (cap := 9);\n\tcopied : INT := cfg.cap;",
    "copied := copied;",
    "an initializer reading a MEMBER of a struct declared before it",
  ),
  {
    ...probe("initseq_reads_global", "", "fromGlobal := fromGlobal;", "an initializer reading a GLOBAL"),
    source:
      "FUNCTION_BLOCK FB_LANG_initseq_reads_global\nVAR_EXTERNAL\n\tgLimit : INT;\nEND_VAR\nVAR\n\tfromGlobal : INT := gLimit;\nEND_VAR\nfromGlobal := fromGlobal;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "initseq_struct_type",
    pouName: "ST_LANG_initseq",
    kind: "dut" as const,
    feature: "the struct the member probe reads",
    fromDoc: "06-data-types.md",
    source: "TYPE ST_LANG_initseq :\nSTRUCT\n\tcap : INT;\nEND_STRUCT\nEND_TYPE\n",
  },
  {
    name: "initseq_global_list",
    pouName: "GVL_INITSEQ",
    kind: "gvl" as const,
    feature: "the global the initializer reads",
    fromDoc: "06-data-types.md",
    plcPrgVar: "limitCopy : INT;",
    plcPrgBody: "limitCopy := GVL_INITSEQ.gLimit;",
    source: "VAR_GLOBAL\n\tgLimit : INT := 23;\nEND_VAR\n",
  },
]
