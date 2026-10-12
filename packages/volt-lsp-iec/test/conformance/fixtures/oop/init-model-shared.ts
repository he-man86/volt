/**
 * the helpers `init-model.ts`'s parts share: the fixture builders and the data they are built from (openspec
 * lsp-same-standard 4.4).
 */
export const doc = "openspec transpile-restructure design.md §3.4 (task 5.1)"

/** Why a STRUCT field's dynamic initializer stays refused (design.md §3.4 step 5d). */
export const STRUCT_FIELD_DYNAMIC =
  "2026-10-09 (transpile-restructure 5.8, design.md §3.4 step 5d): a STRUCT field with a dynamic initializer — a STRUCT has no init frame, so lowering refuses it (`init-not-constant`). niche: accepted loss (0 occurrences in the corpora: every STRUCT field initializer in the six is constant; the 7 candidates are SIZEOF(THIS^))"

/** The FB_Init header every probe here declares. */
export const FB_INIT = "METHOD FB_Init : BOOL\nVAR_INPUT\n\tbInitRetains : BOOL;\n\tbInCopyCode : BOOL;\nEND_VAR\n"

/** The same with one argument `v`. */
export const FB_INIT_V = "METHOD FB_Init : BOOL\nVAR_INPUT\n\tbInitRetains : BOOL;\n\tbInCopyCode : BOOL;\n\tv : INT;\nEND_VAR\n"

/** A global counter and the FUNCTION that bumps and returns it — the stamp clock of one fixture. */
export function clock(counter: string, fn: string): string {
  return `FUNCTION ${fn} : INT\n${counter} := ${counter} + 1;\n${fn} := ${counter};\nEND_FUNCTION\n`
}

/** A target FB whose FB_Init stores its argument in `got` — and stamps itself, given a clock. */
export function target(name: string, fn?: string): string {
  const field = fn === undefined ? "" : "\n\tinitStamp : INT;"
  const stamp = fn === undefined ? "" : `\ninitStamp := ${fn}();`
  return `FUNCTION_BLOCK ${name}\nVAR\n\tgot : INT;${field}\nEND_VAR\nEND_FUNCTION_BLOCK\n\n${FB_INIT_V}got := v;${stamp}\nEND_METHOD\n`
}
