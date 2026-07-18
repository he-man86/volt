/**
 * Canonical ST source builders for every top-level kind and POU child, reused across the whole e2e
 * suite. Non-INT return/base types on purpose (function/alias) so round-trips prove type fidelity.
 * Interface members live INSIDE the INTERFACE…END_INTERFACE block; child sub-folders ride as a
 * `%FOLDER <path>` directive at the top of the child body.
 */

// ── top-level kinds ───────────────────────────────────────────────────────────
export const fb = (name: string, opts: { vars?: string; body?: string; children?: string } = {}) =>
	`FUNCTION_BLOCK ${name}\n${opts.vars ?? "VAR\n\tx : INT;\nEND_VAR"}\n\n${opts.body ?? "x := x + 1;"}\nEND_FUNCTION_BLOCK\n${opts.children ?? ""}`
export const func = (name: string) => `FUNCTION ${name} : BOOL\nVAR_INPUT\n\ta : INT;\nEND_VAR\n\n${name} := a > 0;\nEND_FUNCTION\n`
export const prog = (name: string, body = "n := n + 1;") => `PROGRAM ${name}\nVAR\n\tn : INT;\nEND_VAR\n\n${body}\nEND_PROGRAM\n`
export const iface = (name: string, members = "") => `INTERFACE ${name}\n${members}END_INTERFACE\n`
export const gvl = (name: string) => `VAR_GLOBAL\n\t${name}_g : INT := 7;\nEND_VAR\n`
export const structDut = (name: string) => `TYPE ${name} :\nSTRUCT\n\ta : INT;\n\tb : BOOL;\nEND_STRUCT\nEND_TYPE\n`
export const enumDut = (name: string) => `TYPE ${name} :\n(\n\tRed,\n\tGreen,\n\tBlue\n);\nEND_TYPE\n`
export const unionDut = (name: string) => `TYPE ${name} :\nUNION\n\ti : INT;\n\tr : REAL;\nEND_UNION\nEND_TYPE\n`
export const aliasDut = (name: string) => `TYPE ${name} : DWORD;\nEND_TYPE\n`

// ── POU children ──────────────────────────────────────────────────────────────
export const METHOD = (n: string, body?: string) => `\nMETHOD ${n} : INT\nVAR_INPUT\n\td : INT;\nEND_VAR\n${body ?? `${n} := d;`}\nEND_METHOD\n`
export const ACTION = (n: string, body = "x := 1;") => `\nACTION ${n}\n${body}\nEND_ACTION\n`
export const PROPERTY = (n: string, get = true, set = true) =>
	`\nPROPERTY ${n} : INT\n` + (get ? `GET\n\t${n} := x;\nEND_GET\n` : "") + (set ? `SET\n\tx := ${n};\nEND_SET\n` : "") + `END_PROPERTY\n`

/** Kinds that support the full textual CRUD lifecycle (create/edit/rename/move/delete). The `edit`
 *  builder produces a second, content-different version so the content-edit delta is observable. */
export type LifecycleKind = {
	key: string
	kind: string                       // expected wire `kind`
	create: (name: string) => string
	edit: (name: string) => string
	editToken: RegExp                  // appears in the edited source, proving the edit landed
	/** Whether the POU NAME appears in the materialized source (so a rename changes the item version).
	 *  True for FB/program/function/DUTs (`FUNCTION_BLOCK X`, `TYPE X`); false for a GVL (`VAR_GLOBAL`
	 *  carries no name). Empirically established by the lifecycle test. */
	nameInSource: boolean
}

export const LIFECYCLE_KINDS: LifecycleKind[] = [
	{ key: "fb", kind: "function_block", create: n => fb(n, { body: "x := 1;" }), edit: n => fb(n, { body: "x := 999;" }), editToken: /x := 999/, nameInSource: true },
	{ key: "prog", kind: "program", create: n => prog(n, "n := 1;"), edit: n => prog(n, "n := 888;"), editToken: /n := 888/, nameInSource: true },
	{ key: "gvl", kind: "gvl", create: n => gvl(n), edit: n => `VAR_GLOBAL\n\t${n}_g : INT := 42;\nEND_VAR\n`, editToken: /42/, nameInSource: false },
	{ key: "struct", kind: "structure", create: n => structDut(n), edit: n => `TYPE ${n} :\nSTRUCT\n\ta : INT;\n\tb : BOOL;\n\tc : REAL;\nEND_STRUCT\nEND_TYPE\n`, editToken: /c : REAL/, nameInSource: true },
	{ key: "enum", kind: "enumeration", create: n => enumDut(n), edit: n => `TYPE ${n} :\n(\n\tRed,\n\tGreen,\n\tBlue,\n\tAmber\n);\nEND_TYPE\n`, editToken: /Amber/, nameInSource: true },
	{ key: "union", kind: "union", create: n => unionDut(n), edit: n => `TYPE ${n} :\nUNION\n\ti : INT;\n\tr : REAL;\n\tb : BYTE;\nEND_UNION\nEND_TYPE\n`, editToken: /b : BYTE/, nameInSource: true },
	{ key: "alias", kind: "alias", create: n => aliasDut(n), edit: n => `TYPE ${n} : LWORD;\nEND_TYPE\n`, editToken: /LWORD/, nameInSource: true },
	{ key: "fbChildren", kind: "function_block", create: n => fb(n, { children: METHOD("Accelerate") + ACTION("Start") + PROPERTY("Speed") }), edit: n => fb(n, { body: "x := 5;", children: METHOD("Accelerate") + ACTION("Start") + PROPERTY("Speed") }), editToken: /x := 5/, nameInSource: true },
]
