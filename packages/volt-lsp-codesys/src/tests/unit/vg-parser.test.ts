/**
 * VG parser tests — drive the parser with the spec's §12 worked examples
 * (vg-language.md) plus targeted diagnostic cases.
 *
 * Pattern: parse VG text, assert the network/statement shape, and assert
 * that valid examples produce zero diagnostics while malformed ones
 * produce the expected §10 code.
 */
import { describe, expect, it } from "bun:test";
import { parseVgText, isVgBody } from "../../vg/index.js";
import { lex } from "../../lexer/lexer.js";
import type {
	VgEnEnoIf,
	VgFbCall,
	VgGroup,
	VgJump,
	VgReturn,
	VgSink,
	VgWireDef,
} from "../../vg/ast.js";

function parse(src: string) {
	return parseVgText(src);
}

describe("vg parser: body discrimination", () => {
	it("recognises a NETWORK body as VG", () => {
		expect(isVgBody(lex("NETWORK 0 FBD\n out := (a AND b);\nEND_NETWORK"))).toBe(true);
	});
	it("rejects an ST body", () => {
		expect(isVgBody(lex("out := a + b;"))).toBe(false);
	});
	it("ignores leading trivia", () => {
		expect(isVgBody(lex("  // hi\n  (* c *)\n NETWORK 0 FBD\nEND_NETWORK"))).toBe(true);
	});
});

describe("vg parser: §12 worked examples parse cleanly", () => {
	it("1. simple operator (inlined)", () => {
		const b = parse(`NETWORK 0 FBD
  out := (a AND b);
END_NETWORK`);
		expect(b.diagnostics).toEqual([]);
		expect(b.networks).toHaveLength(1);
		const n = b.networks[0]!;
		expect(n.index).toBe(0);
		expect(n.language).toBe("FBD");
		expect(n.statements).toHaveLength(1);
		const sink = n.statements[0] as VgSink;
		expect(sink.kind).toBe("sink");
		expect(sink.target.text).toBe("out");
		const grp = sink.value.core as VgGroup;
		expect(grp.kind).toBe("group");
		expect(grp.op).toBe("AND");
		expect(grp.operands).toHaveLength(2);
	});

	it("2. nested, fully parenthesised", () => {
		const b = parse(`NETWORK 0 FBD
  out := ((a AND b) OR c);
END_NETWORK`);
		expect(b.diagnostics).toEqual([]);
		const sink = b.networks[0]!.statements[0] as VgSink;
		const outer = sink.value.core as VgGroup;
		expect(outer.op).toBe("OR");
		const inner = outer.operands[0]!.core as VgGroup;
		expect(inner.op).toBe("AND");
	});

	it("3. fan-out named with LET", () => {
		const b = parse(`NETWORK 0 FBD
  LET g1 := (a AND b);
  out  := g1;
  out2 := g1;
END_NETWORK`);
		expect(b.diagnostics).toEqual([]);
		const stmts = b.networks[0]!.statements;
		expect(stmts).toHaveLength(3);
		const wire = stmts[0] as VgWireDef;
		expect(wire.kind).toBe("wire_def");
		expect(wire.name.text).toBe("g1");
		expect(wire.isEnBinding).toBe(false);
		expect((stmts[1] as VgSink).kind).toBe("sink");
	});

	it("4. opaque leaf", () => {
		const b = parse(`NETWORK 0 FBD
  LET i1 := NOT b;
  out := (a AND i1);
END_NETWORK`);
		expect(b.diagnostics).toEqual([]);
		const wire = b.networks[0]!.statements[0] as VgWireDef;
		expect(wire.kind).toBe("wire_def");
		expect(wire.producer.mods.negated).toBe(true);
		expect(wire.producer.core.kind).toBe("leaf");
	});

	it("5. EN/ENO into a sink", () => {
		const b = parse(`NETWORK 0 FBD
  LET en1 := a;
  IF en1 THEN out := (b AND c); END_IF
END_NETWORK`);
		expect(b.diagnostics).toEqual([]);
		const stmts = b.networks[0]!.statements;
		const enWire = stmts[0] as VgWireDef;
		expect(enWire.isEnBinding).toBe(true);
		const enif = stmts[1] as VgEnEnoIf;
		expect(enif.kind).toBe("en_eno_if");
		expect(enif.en.text).toBe("en1");
		expect((enif.body as VgSink).kind).toBe("sink");
	});

	it("6. EN/ENO whose result fans out", () => {
		const b = parse(`NETWORK 0 FBD
  LET en1 := a;
  IF en1 THEN LET g1 := (b OR c); END_IF
  out  := g1;
  out2 := g1;
END_NETWORK`);
		expect(b.diagnostics).toEqual([]);
		const enif = b.networks[0]!.statements[1] as VgEnEnoIf;
		expect(enif.kind).toBe("en_eno_if");
		expect((enif.body as VgWireDef).kind).toBe("wire_def");
		expect((enif.body as VgWireDef).name.text).toBe("g1");
	});

	it("7. timer FB: instance call + output reads", () => {
		const b = parse(`NETWORK 0 FBD
  t1(IN := start, PT := pt);
  done := t1.Q;
  et   := t1.ET;
END_NETWORK`);
		expect(b.diagnostics).toEqual([]);
		const stmts = b.networks[0]!.statements;
		const call = stmts[0] as VgFbCall;
		expect(call.kind).toBe("fb_call");
		expect(call.instance.text).toBe("t1");
		expect(call.args).toHaveLength(2);
		expect(call.args[0]!.pin?.text).toBe("IN");
		const done = stmts[1] as VgSink;
		expect(done.value.core.kind).toBe("member");
	});

	it("8. EN-gated FB call", () => {
		const b = parse(`NETWORK 0 FBD
  LET en1 := enable;
  IF en1 THEN t1(IN := start, PT := pt); END_IF
  done := t1.Q;
END_NETWORK`);
		expect(b.diagnostics).toEqual([]);
		const enif = b.networks[0]!.statements[1] as VgEnEnoIf;
		expect((enif.body as VgFbCall).kind).toBe("fb_call");
	});

	it("9. ladder branch + series", () => {
		const b = parse(`NETWORK 0 LD
  out := ((a OR b) AND c);
END_NETWORK`);
		expect(b.diagnostics).toEqual([]);
		expect(b.networks[0]!.language).toBe("LD");
	});

	it("10. multiple networks", () => {
		const b = parse(`NETWORK 0 LD
  out1 := (a AND b);
END_NETWORK
NETWORK 1 LD
  out2 := (c OR d);
END_NETWORK`);
		expect(b.diagnostics).toEqual([]);
		expect(b.networks).toHaveLength(2);
		expect(b.networks[1]!.index).toBe(1);
	});

	it("11. variable feedback", () => {
		const b = parse(`NETWORK 0 FBD
  iCount := (1 + iCount);
END_NETWORK`);
		expect(b.diagnostics).toEqual([]);
		const grp = (b.networks[0]!.statements[0] as VgSink).value.core as VgGroup;
		expect(grp.op).toBe("+");
	});

	it("12. control flow", () => {
		const b = parse(`NETWORK 0 FBD
  IF done THEN RETURN; END_IF
  step := (step + 1);
END_NETWORK`);
		expect(b.diagnostics).toEqual([]);
		const ret = b.networks[0]!.statements[0] as VgReturn;
		expect(ret.kind).toBe("return");
		expect(ret.condition).toBeDefined();
	});
});

describe("vg parser: control flow forms", () => {
	it("label + unconditional jump", () => {
		const b = parse(`NETWORK 0 FBD
  myLabel:
  JMP myLabel;
END_NETWORK`);
		expect(b.diagnostics).toEqual([]);
		expect(b.networks[0]!.statements[0]!.kind).toBe("label");
		const jmp = b.networks[0]!.statements[1] as VgJump;
		expect(jmp.kind).toBe("jump");
		expect(jmp.target.text).toBe("myLabel");
		expect(jmp.condition).toBeUndefined();
	});

	it("conditional jump", () => {
		const b = parse(`NETWORK 0 FBD
  IF cond THEN JMP done; END_IF
  done:
END_NETWORK`);
		expect(b.diagnostics).toEqual([]);
		const jmp = b.networks[0]!.statements[0] as VgJump;
		expect(jmp.kind).toBe("jump");
		expect(jmp.condition).toBeDefined();
	});
});

describe("vg parser: modifiers", () => {
	it("negated sink source", () => {
		const b = parse(`NETWORK 0 FBD
  out := NOT g1;
END_NETWORK`);
		const sink = b.networks[0]!.statements[0] as VgSink;
		expect(sink.value.mods.negated).toBe(true);
	});
	it("set coil + rising edge", () => {
		const b = parse(`NETWORK 0 FBD
  out := a SET;
  clk := b RISING;
END_NETWORK`);
		expect(b.diagnostics).toEqual([]);
		expect((b.networks[0]!.statements[0] as VgSink).value.mods.storage).toBe("set");
		expect((b.networks[0]!.statements[1] as VgSink).value.mods.edge).toBe("rising");
	});
});

describe("vg parser: header forms", () => {
	it("quoted label + DISABLED", () => {
		const b = parse(`NETWORK 2 FBD "my title" DISABLED
  out := (a AND b);
END_NETWORK`);
		expect(b.diagnostics).toEqual([]);
		const n = b.networks[0]!;
		expect(n.index).toBe(2);
		expect(n.label).toBe("my title");
		expect(n.disabled).toBe(true);
	});

	it("network comments", () => {
		const b = parse(`NETWORK 0 FBD
  // a network comment
  out := (a AND b);
END_NETWORK`);
		expect(b.networks[0]!.comments).toHaveLength(1);
		expect(b.networks[0]!.comments[0]!.text).toBe("a network comment");
	});
});

describe("vg parser: diagnostics", () => {
	it("VG_NETWORK_NOT_CLOSED", () => {
		const b = parse(`NETWORK 0 FBD
  out := (a AND b);`);
		expect(b.diagnostics.map((d) => d.code)).toContain("VG_NETWORK_NOT_CLOSED");
	});

	it("VG_DUPLICATE_NETWORK", () => {
		const b = parse(`NETWORK 0 FBD
END_NETWORK
NETWORK 0 LD
END_NETWORK`);
		expect(b.diagnostics.map((d) => d.code)).toContain("VG_DUPLICATE_NETWORK");
	});

	it("VG_DUPLICATE_NAME", () => {
		const b = parse(`NETWORK 0 FBD
  LET g1 := (a AND b);
  LET g1 := (c OR d);
END_NETWORK`);
		expect(b.diagnostics.map((d) => d.code)).toContain("VG_DUPLICATE_NAME");
	});

	it("VG_BAD_EXPRESSION — mixed operators", () => {
		const b = parse(`NETWORK 0 FBD
  out := (a AND b OR c);
END_NETWORK`);
		expect(b.diagnostics.map((d) => d.code)).toContain("VG_BAD_EXPRESSION");
	});

	it("VG_BAD_EXPRESSION — partially parenthesised", () => {
		const b = parse(`NETWORK 0 FBD
  out := (a AND b) OR c;
END_NETWORK`);
		expect(b.diagnostics.map((d) => d.code)).toContain("VG_BAD_EXPRESSION");
	});

	it("VG_UNKNOWN_OPERATOR", () => {
		const b = parse(`NETWORK 0 FBD
  out := (a NAND b);
END_NETWORK`);
		expect(b.diagnostics.map((d) => d.code)).toContain("VG_UNKNOWN_OPERATOR");
	});

	it("VG_LEAF_REFERENCES_TEMP", () => {
		const b = parse(`NETWORK 0 FBD
  LET g1 := (a AND b);
  LET g2 := NOT g1;
END_NETWORK`);
		expect(b.diagnostics.map((d) => d.code)).toContain("VG_LEAF_REFERENCES_TEMP");
	});

	it("statement before any NETWORK", () => {
		const b = parse(`out := (a AND b);`);
		expect(b.diagnostics.map((d) => d.code)).toContain("VG_PARSE");
	});

	it("END_NETWORK without open NETWORK", () => {
		const b = parse(`END_NETWORK`);
		expect(b.diagnostics.map((d) => d.code)).toContain("VG_PARSE");
	});
});
