/**
 * VG writer — render a `VgBody` AST back to canonical VG text.
 *
 * This is a faithful re-emitter of the parsed AST: it reproduces the
 * bridge writer's *formatting* conventions (2-space statement indent,
 * `LET name := …;`, fully-parenthesised groups, `NETWORK i LANG …
 * END_NETWORK`) without re-deriving structure. Because a materialised VG
 * body is already structurally canonical (it came from the bridge's
 * `VgWriter`), writing the AST straight back reproduces it exactly —
 * `writeVgBody(parseVgText(x)) === x` for canonical input.
 *
 * It does NOT re-run the graph-level inline-vs-LET analysis the bridge's
 * `VgWriter.cs` does (that needs the graph), so it never *invents*
 * structure — only formats what the text already expresses. The bridge
 * stays the authority for deep (graph) canonicality at push time.
 */
import type {
	VgArg,
	VgBody,
	VgCore,
	VgNetwork,
	VgOperand,
	VgStatement,
} from "./ast.js";

/** Render a whole VG body to canonical text (no trailing newline). */
export function writeVgBody(vg: VgBody): string {
	return vg.networks.map(writeNetwork).join("\n");
}

function writeNetwork(net: VgNetwork): string {
	let header = `NETWORK ${net.index ?? 0} ${net.language}`;
	if (net.label !== undefined && net.label.length > 0) header += ` "${net.label}"`;
	if (net.disabled) header += " DISABLED";

	const lines: string[] = [header];
	for (const c of net.comments) lines.push(`  // ${c.text}`);
	for (const stmt of net.statements) {
		lines.push(`  ${writeStatementCore(stmt)}${needsSemicolon(stmt) ? ";" : ""}`);
	}
	lines.push("END_NETWORK");
	return lines.join("\n");
}

/** A statement gets a trailing `;` unless it is a label, a comment, or
 *  ends with `END_IF` (EN/ENO IF, conditional jump/return). */
function needsSemicolon(stmt: VgStatement): boolean {
	switch (stmt.kind) {
		case "label":
		case "comment":
		case "unknown_stmt":
		case "en_eno_if":
			return false;
		case "jump":
		case "return":
			return stmt.condition === undefined; // conditional form ends with END_IF
		default:
			return true;
	}
}

/** Render a statement WITHOUT leading indent or trailing terminator —
 *  also used to render the inner statement of an EN/ENO IF. */
function writeStatementCore(stmt: VgStatement): string {
	switch (stmt.kind) {
		case "wire_def":
			return `LET ${stmt.name.text} := ${writeOperand(stmt.producer)}`;
		case "sink":
			return `${stmt.target.text} := ${writeOperand(stmt.value)}`;
		case "fb_call":
			return `${stmt.instance.text}(${stmt.args.map(writeArg).join(", ")})`;
		case "en_eno_if":
			return `IF ${stmt.en.text} THEN ${writeStatementCore(stmt.body)}${needsSemicolon(stmt.body) ? ";" : ""} END_IF`;
		case "label":
			return `${stmt.name.text}:`;
		case "jump":
			return stmt.condition !== undefined
				? `IF ${writeOperand(stmt.condition)} THEN JMP ${stmt.target.text}; END_IF`
				: `JMP ${stmt.target.text}`;
		case "return":
			return stmt.condition !== undefined
				? `IF ${writeOperand(stmt.condition)} THEN RETURN; END_IF`
				: "RETURN";
		case "comment":
			return `// ${stmt.text}`;
		case "unknown_stmt":
			return stmt.tokens.map((t) => t.text).join(" ");
	}
}

function writeOperand(op: VgOperand): string {
	let s = writeCore(op.core);
	if (op.mods.negated) s = `NOT ${s}`;
	if (op.mods.edge === "rising") s += " RISING";
	else if (op.mods.edge === "falling") s += " FALLING";
	if (op.mods.storage === "set") s += " SET";
	else if (op.mods.storage === "reset") s += " RESET";
	return s;
}

function writeCore(core: VgCore): string {
	switch (core.kind) {
		case "group": {
			const op = core.op ?? "?";
			return `(${core.operands.map(writeOperand).join(` ${op} `)})`;
		}
		case "call":
			return `${core.callee.text}(${core.args.map(writeArg).join(", ")})`;
		case "member":
			return `${core.base.text}.${core.member.text}`;
		case "leaf":
			return core.text;
	}
}

function writeArg(arg: VgArg): string {
	const value = writeOperand(arg.value);
	return arg.pin !== undefined ? `${arg.pin.text} := ${value}` : value;
}
