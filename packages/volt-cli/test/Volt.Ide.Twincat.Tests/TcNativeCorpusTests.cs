using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Format.Network;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// THE NATIVE CORPUS (openspec twincat-inproc-host 2.2): networks TwinCAT itself serialized, made in volume so the
/// archive's rules are LEARNED rather than guessed — member order, <c>cet</c>/<c>t=</c>, the Id / VarId / BranchCounter
/// / ValidIds minting, the TypeList.
///
/// <para><b>How it is made.</b> This file states each shape and writes the PLCopen document for it; the live half,
/// <c>scripts/tc-native-corpus.ps1</c>, imports every document into a scratch POU of a running XAE and records the
/// archive TwinCAT answers (<c>&lt;name&gt;.nwl.xml</c>). PLCopen is used ONLY as an authoring tool here: the recorded
/// archive is the vendor's own serialization of what its importer built, which is what makes it a template.</para>
/// <list type="bullet">
/// <item><b>FBD shapes</b> are network text, lowered by the PLCopen writer Volt then shipped — every shape it could say,
/// at several sizes, nestings, pin counts, fan-outs and network counts, plus edited variants.</item>
/// <item><b>Hand shapes</b> are PLCopen bodies the lowering has no form for (LD power rails, contacts, coils, parallel
/// branches; FBD negated / edge / set pins), written here as plain TC6 so the importer can be asked for them.</item>
/// </list>
/// <para>The documents are committed; re-made on another TwinCAT version by re-running the script over them.
/// <c>VOLT_WRITE_TC_CORPUS=1</c> rewrites the hand-written ones.</para>
/// </summary>
public sealed class TcNativeCorpusTests
{
    internal static string Dir => Path.Combine(TcArchiveIdentityTests.RepoDir(), "test", "fixtures", "tc-native-corpus");

    private const string Vars =
        "a : BOOL; b : BOOL; c : BOOL; d : BOOL; e : BOOL; go : BOOL; out : BOOL; out1 : BOOL; out2 : BOOL; out3 : BOOL; " +
        "i1 : INT; i2 : INT; i3 : INT; i4 : INT; n : INT; sv : INT; r : REAL; t1 : TON; t2 : TOF; pt : TIME; el : TIME; " +
        "c1 : CTU; rt : R_TRIG; sr1 : SR; w : WORD; dw : DWORD; x : REAL; y : REAL; s1 : STRING; s2 : STRING; tm : TIME; " +
        "fb1 : FB_Custom; rs1 : RS; ft : F_TRIG; ctd1 : CTD; ctud1 : CTUD; tp1 : TP; li : LINT; ui : UINT; by : BYTE;";

    /// <summary>Network-text shapes: name, then the body under <c>IMPLEMENTATION FBD</c>.</summary>
    public static readonly (string Name, string Body)[] FbdShapes =
    {
        ("leaf_assign", "NETWORK\n  out := a;\nEND_NETWORK\n"),
        ("literal_assign", "NETWORK\n  out := TRUE;\nEND_NETWORK\n"),
        ("int_literal_assign", "NETWORK\n  n := 42;\nEND_NETWORK\n"),
        ("and2", "NETWORK\n  out := a AND b;\nEND_NETWORK\n"),
        ("and2_edit_rename", "NETWORK\n  out := a AND c;\nEND_NETWORK\n"),
        ("and3", "NETWORK\n  out := a AND b AND c;\nEND_NETWORK\n"),
        ("and8", "NETWORK\n  out := a AND b AND c AND d AND e AND go AND out1 AND out2;\nEND_NETWORK\n"),
        ("or2", "NETWORK\n  out := a OR b;\nEND_NETWORK\n"),
        ("xor2", "NETWORK\n  out := a XOR b;\nEND_NETWORK\n"),
        ("not_box", "NETWORK\n  out := `NOT`(a);\nEND_NETWORK\n"),
        ("nest2", "NETWORK\n  out := (a AND b) OR c;\nEND_NETWORK\n"),
        ("nest3", "NETWORK\n  out := ((a AND b) OR (c AND d)) AND e;\nEND_NETWORK\n"),
        ("nest_not", "NETWORK\n  out := `NOT`((a OR b));\nEND_NETWORK\n"),
        ("add2", "NETWORK\n  n := i1 ADD i2;\nEND_NETWORK\n"),
        ("add4", "NETWORK\n  n := i1 ADD i2 ADD i3 ADD i4;\nEND_NETWORK\n"),
        ("sub", "NETWORK\n  n := i1 SUB i2;\nEND_NETWORK\n"),
        ("mul_add", "NETWORK\n  n := (i1 ADD i2) MUL i3;\nEND_NETWORK\n"),
        ("div", "NETWORK\n  n := i1 DIV i2;\nEND_NETWORK\n"),
        ("gt", "NETWORK\n  out := i1 GT i2;\nEND_NETWORK\n"),
        ("eq", "NETWORK\n  out := i1 EQ i2;\nEND_NETWORK\n"),
        ("ne_and", "NETWORK\n  out := (i1 NE i2) AND a;\nEND_NETWORK\n"),
        ("max2", "NETWORK\n  n := MAX(i1, i2);\nEND_NETWORK\n"),
        ("max3", "NETWORK\n  n := MAX(i1, i2, i3);\nEND_NETWORK\n"),
        ("min2", "NETWORK\n  n := MIN(i1, i2);\nEND_NETWORK\n"),
        ("limit", "NETWORK\n  n := LIMIT(i1, i2, i3);\nEND_NETWORK\n"),
        ("sel", "NETWORK\n  n := SEL(a, i1, i2);\nEND_NETWORK\n"),
        ("move", "NETWORK\n  n := MOVE i1;\nEND_NETWORK\n"),
        ("move_stmt", "NETWORK\n  `MOVE`(a, b);\nEND_NETWORK\n"),
        ("abs", "NETWORK\n  n := ABS(i1);\nEND_NETWORK\n"),
        ("int_to_real", "NETWORK\n  r := INT_TO_REAL(i1);\nEND_NETWORK\n"),
        ("shl", "NETWORK\n  w := SHL(w, 2);\nEND_NETWORK\n"),
        ("ton_call", "NETWORK\n  t1 : TON(IN := a, PT := pt);\nEND_NETWORK\n"),
        ("ton_call_t3s", "NETWORK\n  t1 : TON(IN := a, PT := T#3S);\nEND_NETWORK\n"),
        ("ton_unwired", "NETWORK\n  t1 : TON(IN := , PT := );\nEND_NETWORK\n"),
        ("ton_in_box", "NETWORK\n  t1 : TON(IN := a AND b, PT := pt);\nEND_NETWORK\n"),
        ("ton_q_assign", "NETWORK\n  out := t1 : TON(IN := a, PT := pt).Q;\nEND_NETWORK\n"),
        ("ton_then_read", "NETWORK\n  t1 : TON(IN := a, PT := pt);\n  out := t1.Q;\nEND_NETWORK\n"),
        ("tof_call", "NETWORK\n  t2 : TOF(IN := a, PT := pt);\nEND_NETWORK\n"),
        ("ctu_call", "NETWORK\n  c1 : CTU(CU := a, RESET := b, PV := i1);\nEND_NETWORK\n"),
        ("rtrig_call", "NETWORK\n  rt : R_TRIG(CLK := a);\nEND_NETWORK\n"),
        ("sr_call", "NETWORK\n  sr1 : SR(SET1 := a, RESET := b);\nEND_NETWORK\n"),
        ("member_read", "NETWORK\n  out := t1.Q AND c1.Q;\nEND_NETWORK\n"),
        ("targets2", "NETWORK\n  out1 := out2 := a AND b;\nEND_NETWORK\n"),
        ("targets3", "NETWORK\n  out1 := out2 := out3 := a OR b;\nEND_NETWORK\n"),
        ("fanout2", "NETWORK\n  split1 := a AND b;\n  out1 := split1;\n  out2 := split1;\nEND_NETWORK\n"),
        ("fanout3", "NETWORK\n  split1 := a AND b;\n  out1 := split1;\n  out2 := split1;\n  out3 := split1;\nEND_NETWORK\n"),
        ("fanout_int", "NETWORK\n  split1 := i1 ADD i2;\n  n := split1;\n  sv := split1;\nEND_NETWORK\n"),
        ("fanout_leaf", "NETWORK\n  split1 := a;\n  out1 := split1;\n  out2 := split1;\nEND_NETWORK\n"),
        ("fanout_into_box", "NETWORK\n  split1 := a AND b;\n  out1 := split1 OR c;\n  out2 := split1;\nEND_NETWORK\n"),
        ("fanout_two_wires", "NETWORK\n  split1 := a AND b;\n  split2 := c OR d;\n  out1 := split1 AND split2;\n  out2 := split1 OR split2;\nEND_NETWORK\n"),
        ("jump_cond", "NETWORK\n  JMP L1 := a;\nEND_NETWORK\nNETWORK LABEL: L1\n  out := a OR b;\nEND_NETWORK\n"),
        ("jump_uncond", "NETWORK\n  JMP L1 := ;\nEND_NETWORK\nNETWORK LABEL: L1\n  out := a AND b;\nEND_NETWORK\n"),
        ("return_cond", "NETWORK\n  RETURN := a;\nEND_NETWORK\nNETWORK\n  out := a AND b;\nEND_NETWORK\n"),
        ("return_uncond", "NETWORK\n  out := a AND b;\nEND_NETWORK\nNETWORK\n  RETURN := ;\nEND_NETWORK\n"),
        ("enable_and", "NETWORK\n  out := a AND b ENO EN go;\nEND_NETWORK\n"),
        ("networks2", "NETWORK\n  out1 := a AND b;\nEND_NETWORK\nNETWORK\n  out2 := b OR c;\nEND_NETWORK\n"),
        ("networks3", "NETWORK\n  out1 := a;\nEND_NETWORK\nNETWORK\n  out2 := b AND c;\nEND_NETWORK\nNETWORK\n  t1 : TON(IN := out2, PT := pt);\nEND_NETWORK\n"),
        ("networks5", string.Concat(Enumerable.Range(1, 5).Select(k => $"NETWORK\n  out{(k % 3) + 1} := a AND b;\nEND_NETWORK\n"))),
        ("two_rungs", "NETWORK\n  out1 := a AND b;\n  out2 := c OR d;\nEND_NETWORK\n"),
        ("mixed_big", "NETWORK\n  out := (((i1 ADD i2) GT i3) AND a) OR (b AND `NOT`(c));\nEND_NETWORK\n"),
        // Every standard operator and function the shapes above do not hold: which CallType TwinCAT stores for each.
        ("op_mod", "NETWORK\n  n := i1 MOD i2;\nEND_NETWORK\n"),
        ("op_mul", "NETWORK\n  n := i1 MUL i2;\nEND_NETWORK\n"),
        ("op_ge", "NETWORK\n  out := i1 GE i2;\nEND_NETWORK\n"),
        ("op_le", "NETWORK\n  out := i1 LE i2;\nEND_NETWORK\n"),
        ("op_lt", "NETWORK\n  out := i1 LT i2;\nEND_NETWORK\n"),
        ("op_shr", "NETWORK\n  w := SHR(w, 1);\nEND_NETWORK\n"),
        ("op_rol", "NETWORK\n  w := ROL(w, 3);\nEND_NETWORK\n"),
        ("op_ror", "NETWORK\n  w := ROR(w, 3);\nEND_NETWORK\n"),
        ("op_mux", "NETWORK\n  n := MUX(i1, i2, i3, i4);\nEND_NETWORK\n"),
        ("op_sqrt", "NETWORK\n  y := SQRT(x);\nEND_NETWORK\n"),
        ("op_ln", "NETWORK\n  y := LN(x);\nEND_NETWORK\n"),
        ("op_log", "NETWORK\n  y := LOG(x);\nEND_NETWORK\n"),
        ("op_exp", "NETWORK\n  y := EXP(x);\nEND_NETWORK\n"),
        ("op_expt", "NETWORK\n  y := EXPT(x, y);\nEND_NETWORK\n"),
        ("op_sin", "NETWORK\n  y := SIN(x);\nEND_NETWORK\n"),
        ("op_cos", "NETWORK\n  y := COS(x);\nEND_NETWORK\n"),
        ("op_tan", "NETWORK\n  y := TAN(x);\nEND_NETWORK\n"),
        ("op_asin", "NETWORK\n  y := ASIN(x);\nEND_NETWORK\n"),
        ("op_acos", "NETWORK\n  y := ACOS(x);\nEND_NETWORK\n"),
        ("op_atan", "NETWORK\n  y := ATAN(x);\nEND_NETWORK\n"),
        ("op_trunc", "NETWORK\n  n := TRUNC(x);\nEND_NETWORK\n"),
        ("op_real_to_int", "NETWORK\n  n := REAL_TO_INT(x);\nEND_NETWORK\n"),
        ("op_bool_to_int", "NETWORK\n  n := BOOL_TO_INT(a);\nEND_NETWORK\n"),
        ("op_word_to_dword", "NETWORK\n  dw := WORD_TO_DWORD(w);\nEND_NETWORK\n"),
        ("op_time_to_lint", "NETWORK\n  li := TIME_TO_LINT(tm);\nEND_NETWORK\n"),
        ("op_to_uint", "NETWORK\n  ui := TO_UINT(i1);\nEND_NETWORK\n"),
        ("op_adr", "NETWORK\n  dw := ADR(n);\nEND_NETWORK\n"),
        ("op_sizeof", "NETWORK\n  n := SIZEOF(n);\nEND_NETWORK\n"),
        ("fn_len", "NETWORK\n  n := LEN(s1);\nEND_NETWORK\n"),
        ("fn_concat", "NETWORK\n  s1 := CONCAT(s1, s2);\nEND_NETWORK\n"),
        ("fn_left", "NETWORK\n  s2 := LEFT(s1, 3);\nEND_NETWORK\n"),
        ("fn_user", "NETWORK\n  n := F_Custom(i1, i2);\nEND_NETWORK\n"),
        ("fn_user_named", "NETWORK\n  n := F_Custom(A := i1, B := i2);\nEND_NETWORK\n"),
        ("fb_user", "NETWORK\n  fb1 : FB_Custom(A := a, B := i1);\nEND_NETWORK\n"),
        ("fb_rs", "NETWORK\n  rs1 : RS(SET := a, RESET1 := b);\nEND_NETWORK\n"),
        ("fb_ftrig", "NETWORK\n  ft : F_TRIG(CLK := a);\nEND_NETWORK\n"),
        ("fb_ctd", "NETWORK\n  ctd1 : CTD(CD := a, LOAD := b, PV := i1);\nEND_NETWORK\n"),
        ("fb_ctud", "NETWORK\n  ctud1 : CTUD(CU := a, CD := b, RESET := c, LOAD := d, PV := i1);\nEND_NETWORK\n"),
        ("fb_tp", "NETWORK\n  tp1 : TP(IN := a, PT := T#500MS);\nEND_NETWORK\n"),
        // Sizes and nestings: boxes on every pin, a deep chain, literals, wide reads, mixed networks.
        ("ton_boxes_on_pins", "NETWORK\n  t1 : TON(IN := (a AND b) OR c, PT := SEL(a, pt, T#2S));\nEND_NETWORK\n"),
        ("chain_deep", "NETWORK\n  n := ((((i1 ADD 1) MUL 2) SUB 3) DIV 4) MOD 5;\nEND_NETWORK\n"),
        ("literals", "NETWORK\n  n := LIMIT(0, i1, 16#FF);\nEND_NETWORK\n"),
        ("member_assign", "NETWORK\n  out := t1.Q OR t2.Q OR c1.Q OR rt.Q;\nEND_NETWORK\n"),
        ("networks_mixed4", "NETWORK\n  out1 := a AND b;\nEND_NETWORK\nNETWORK\n  t1 : TON(IN := out1, PT := pt);\nEND_NETWORK\nNETWORK\n  n := MAX(i1, i2);\nEND_NETWORK\nNETWORK\n  out2 := t1.Q;\nEND_NETWORK\n"),
        ("enable_move", "NETWORK\n  out := MOVE i1 ENO EN a;\nEND_NETWORK\n"),
        ("fanout_box_to_two_boxes", "NETWORK\n  split1 := MAX(i1, i2);\n  n := split1 ADD 1;\n  sv := split1 MUL 2;\nEND_NETWORK\n"),
        ("targets_after_box", "NETWORK\n  out1 := out2 := out3 := (a AND b) OR (c AND d);\nEND_NETWORK\n"),
        // Edits of shapes above: the same network after one change, to see what an edit moves.
        ("and3_edit_pin_removed", "NETWORK\n  out := a AND c;\nEND_NETWORK\n"),
        ("nest2_edit_inner_op", "NETWORK\n  out := (a OR b) OR c;\nEND_NETWORK\n"),
        ("networks2_edit_swapped", "NETWORK\n  out2 := b OR c;\nEND_NETWORK\nNETWORK\n  out1 := a AND b;\nEND_NETWORK\n"),
        ("ton_call_edit_pt", "NETWORK\n  t1 : TON(IN := a, PT := T#10S);\nEND_NETWORK\n"),
    };

    /// <summary>Hand-written TC6 bodies for what the lowering cannot say: name, the body element's XML.</summary>
    public static readonly (string Name, string Body)[] HandShapes =
    {
        ("ld_contact_coil", Ld(Contact(2, 1, "a") + Coil(3, 2, "out") + Right(4, 3))),
        ("ld_series", Ld(Contact(2, 1, "a") + Contact(3, 2, "b") + Coil(4, 3, "out") + Right(5, 4))),
        ("ld_series3", Ld(Contact(2, 1, "a") + Contact(3, 2, "b") + Contact(4, 3, "c") + Coil(5, 4, "out") + Right(6, 5))),
        ("ld_neg_contact", Ld(Contact(2, 1, "a", negated: true) + Coil(3, 2, "out") + Right(4, 3))),
        ("ld_rising_contact", Ld(Contact(2, 1, "a", edge: "rising") + Coil(3, 2, "out") + Right(4, 3))),
        ("ld_falling_contact", Ld(Contact(2, 1, "a", edge: "falling") + Coil(3, 2, "out") + Right(4, 3))),
        ("ld_set_coil", Ld(Contact(2, 1, "a") + Coil(3, 2, "out", storage: "set") + Right(4, 3))),
        ("ld_reset_coil", Ld(Contact(2, 1, "a") + Coil(3, 2, "out", storage: "reset") + Right(4, 3))),
        ("ld_neg_coil", Ld(Contact(2, 1, "a") + Coil(3, 2, "out", negated: true) + Right(4, 3))),
        ("ld_two_coils", Ld(Contact(2, 1, "a") + Coil(3, 2, "out1") + Coil(4, 3, "out2") + Right(5, 4))),
        ("ld_parallel2", Ld(Contact(2, 1, "a") + Contact(3, 1, "b") + Coil(4, new[] { 2, 3 }, "out") + Right(5, 4))),
        ("ld_parallel3", Ld(Contact(2, 1, "a") + Contact(3, 1, "b") + Contact(4, 1, "c") + Coil(5, new[] { 2, 3, 4 }, "out") + Right(6, 5))),
        ("ld_parallel_series", Ld(Contact(2, 1, "a") + Contact(3, 2, "b") + Contact(4, 1, "c") + Coil(5, new[] { 3, 4 }, "out") + Right(6, 5))),
        ("ld_series_parallel", Ld(Contact(2, 1, "go") + Contact(3, 2, "a") + Contact(4, 2, "b") + Coil(5, new[] { 3, 4 }, "out") + Right(6, 5))),
        ("ld_parallel_then_series", Ld(Contact(2, 1, "a") + Contact(3, 1, "b") + Contact(4, new[] { 2, 3 }, "c") + Coil(5, 4, "out") + Right(6, 5))),
        ("fbd_neg_input", Fbd(In(1, "a") + In(2, "b") + Block(3, "AND", (1, "In1", "negated=\"true\""), (2, "In2", "")) + Out(4, 3, "out", ""))),
        ("fbd_rising_input", Fbd(In(1, "a") + In(2, "b") + Block(3, "AND", (1, "In1", "edge=\"rising\""), (2, "In2", "")) + Out(4, 3, "out", ""))),
        ("fbd_neg_output", Fbd(In(1, "a") + In(2, "b") + Block(3, "AND", (1, "In1", ""), (2, "In2", "")) + Out(4, 3, "out", "negated=\"true\""))),
        ("fbd_set_output", Fbd(In(1, "a") + In(2, "b") + Block(3, "AND", (1, "In1", ""), (2, "In2", "")) + Out(4, 3, "out", "storage=\"set\""))),
        ("fbd_reset_output", Fbd(In(1, "a") + Out(2, 1, "out", "storage=\"reset\""))),
        ("fbd_neg_leaf_output", Fbd(In(1, "a") + Out(2, 1, "out", "negated=\"true\""))),
    };

    private const string Pos = "<position x=\"0\" y=\"0\" />";
    private static string Ld(string items) =>
        "<LD><leftPowerRail localId=\"1\">" + Pos + "<connectionPointOut formalParameter=\"none\" /></leftPowerRail>" + items + "</LD>";
    private static string Fbd(string items) => "<FBD>" + items + "</FBD>";
    private static string Conns(IEnumerable<int> from) =>
        "<connectionPointIn>" + string.Concat(from.Select(f => $"<connection refLocalId=\"{f}\" />")) + "</connectionPointIn>";
    private static string Contact(int id, int from, string v, bool negated = false, string edge = "none") => Contact(id, new[] { from }, v, negated, edge);
    private static string Contact(int id, int[] from, string v, bool negated = false, string edge = "none") =>
        $"<contact localId=\"{id}\" negated=\"{(negated ? "true" : "false")}\" edge=\"{edge}\" storage=\"none\">" + Pos + Conns(from) +
        $"<connectionPointOut /><variable>{v}</variable></contact>";
    private static string Coil(int id, int from, string v, bool negated = false, string storage = "none") => Coil(id, new[] { from }, v, negated, storage);
    private static string Coil(int id, int[] from, string v, bool negated = false, string storage = "none") =>
        $"<coil localId=\"{id}\" negated=\"{(negated ? "true" : "false")}\" edge=\"none\" storage=\"{storage}\">" + Pos + Conns(from) +
        $"<connectionPointOut /><variable>{v}</variable></coil>";
    private static string Right(int id, int from) => $"<rightPowerRail localId=\"{id}\">" + Pos + Conns(new[] { from }) + "</rightPowerRail>";
    private static string In(int id, string expr) =>
        $"<inVariable localId=\"{id}\">" + Pos + $"<connectionPointOut /><expression>{expr}</expression></inVariable>";
    private static string Out(int id, int from, string expr, string attrs) =>
        $"<outVariable localId=\"{id}\" {attrs}>" + Pos + Conns(new[] { from }) + $"<expression>{expr}</expression></outVariable>";
    private static string Block(int id, string type, params (int From, string Formal, string Attrs)[] inputs) =>
        $"<block localId=\"{id}\" typeName=\"{type}\">" + Pos + "<inputVariables>" +
        string.Concat(inputs.Select(i => $"<variable formalParameter=\"{i.Formal}\" {i.Attrs}>" + Conns(new[] { i.From }) + "</variable>")) +
        "</inputVariables><inOutVariables /><outputVariables><variable formalParameter=\"Out1\"><connectionPointOut /></variable></outputVariables>" +
        "<addData><data name=\"http://www.3s-software.com/plcopenxml/fbdcalltype\" handleUnknown=\"implementation\"><CallType xmlns=\"\">operator</CallType></data></addData></block>";

    internal static string Declaration(string name) =>
        $"PROGRAM {name}\nVAR\n" + string.Concat(Vars.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Select(v => $"\t{v};\n")) + "END_VAR\n";

    internal static NetworkScope Scope => Scopes.Of(Declaration("VnCorpus"));

    /// <summary>A shape's network text read as the push reads it.</summary>
    internal static NetworkBody Model(string body, string lang = "FBD")
    {
        var read = NetworkTextReader.Read($"IMPLEMENTATION {lang}\n" + body, Scope);
        if (!read.Ok) throw new InvalidOperationException(string.Join("\n", read.Diagnostics.Select(d => d.Message)));
        return read.Body!;
    }

    private static readonly XNamespace Tc6 = "http://www.plcopen.org/xml/tc6_0200";

    /// <summary>A PLCopen document holding one program whose body is <paramref name="body"/> — the envelope the deleted
    /// <c>TcPlcOpenWriter</c> wrote, with which every FBD shape's committed document was lowered (6efc413a79).</summary>
    private static string Document(string name, XElement body)
    {
        XElement Scaling() => new(Tc6 + "scaling", new XAttribute("x", "1"), new XAttribute("y", "1"));
        var doc = new XDocument(
            new XDeclaration("1.0", "utf-8", null),
            new XElement(Tc6 + "project",
                new XElement(Tc6 + "fileHeader",
                    new XAttribute("companyName", "Beckhoff Automation GmbH"),
                    new XAttribute("productName", "TwinCAT PLC Control"),
                    new XAttribute("productVersion", "3.5.13.21"),
                    new XAttribute("creationDateTime", "1970-01-01T00:00:00")),
                new XElement(Tc6 + "contentHeader", new XAttribute("name", name),
                    new XElement(Tc6 + "coordinateInfo",
                        new XElement(Tc6 + "fbd", Scaling()), new XElement(Tc6 + "ld", Scaling()), new XElement(Tc6 + "sfc", Scaling()))),
                new XElement(Tc6 + "types",
                    new XElement(Tc6 + "dataTypes"),
                    new XElement(Tc6 + "pous",
                        new XElement(Tc6 + "pou", new XAttribute("name", name), new XAttribute("pouType", "program"),
                            new XElement(Tc6 + "interface"),
                            new XElement(Tc6 + "body", body)))),
                new XElement(Tc6 + "instances", new XElement(Tc6 + "configurations"))));
        return doc.Declaration + "\n" + doc.Root!.ToString();
    }

    private static XElement Tc6Body(string xml)
    {
        var e = XElement.Parse(xml);
        foreach (var x in e.DescendantsAndSelf().Where(x => x.Name.Namespace == XNamespace.None && x.Name.LocalName != "CallType"))
            x.Name = Tc6 + x.Name.LocalName;
        return e;
    }

    private static string Import => Path.Combine(Dir, "import");

    /// <summary>THE FBD SHAPES' DOCUMENTS ARE COMMITTED INPUT: lowered by the PLCopen writer Volt shipped until the native
    /// writer replaced it (6efc413a79), and kept so the corpus can be re-recorded on another TwinCAT version. Each shape has
    /// its document and its text — or is listed as one the lowering refused.</summary>
    [Fact]
    public void Every_FBD_shape_has_its_committed_document_and_text()
    {
        var refused = File.ReadAllLines(Path.Combine(Import, "REFUSED.txt")).Where(l => l.Length > 0)
            .Select(l => l.Substring(0, l.IndexOf(':'))).ToHashSet(StringComparer.Ordinal);
        foreach (var (shape, body) in FbdShapes)
        {
            var name = "Vn_" + shape;
            if (refused.Contains(name)) continue;
            Assert.True(File.Exists(Path.Combine(Import, name + ".plcopen.xml")), $"{name}: no committed document");
            Assert.Equal("IMPLEMENTATION FBD\n" + body, File.ReadAllText(Path.Combine(Import, name + ".network.txt")).Replace("\r\n", "\n"));
        }
    }

    /// <summary>The hand-written documents are this file's; <c>VOLT_WRITE_TC_CORPUS=1</c> rewrites them (then re-record).</summary>
    [Fact]
    public void The_hand_documents_are_todays()
    {
        foreach (var (shape, body) in HandShapes)
        {
            var path = Path.Combine(Import, "Vn_" + shape + ".plcopen.xml");
            var doc = Document("Vn_" + shape, Tc6Body(body)).Replace("\r\n", "\n");
            if (Environment.GetEnvironmentVariable("VOLT_WRITE_TC_CORPUS") == "1") File.WriteAllText(path, doc);
            Assert.True(File.Exists(path) && File.ReadAllText(path).Replace("\r\n", "\n") == doc,
                $"Vn_{shape}.plcopen.xml is not today's document — VOLT_WRITE_TC_CORPUS=1, then re-record (scripts/tc-native-corpus.ps1)");
        }
    }

    /// <summary>Every committed document has TwinCAT's answer recorded beside it: the archive, or the importer's refusal.</summary>
    [Fact]
    public void Every_document_has_its_recording()
    {
        foreach (var doc in Directory.EnumerateFiles(Import, "*.plcopen.xml"))
        {
            var name = Path.GetFileName(doc).Replace(".plcopen.xml", "");
            Assert.True(File.Exists(Path.Combine(Import, name + ".nwl.xml")) || File.Exists(Path.Combine(Import, name + ".refused.txt")),
                $"{name}: no recording — scripts/tc-native-corpus.ps1");
        }
    }
}
