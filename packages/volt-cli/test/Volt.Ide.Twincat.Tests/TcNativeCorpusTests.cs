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

    /// <summary>Network-text shapes: name, then the body under <c>%LANGUAGE FBD</c>.</summary>
    public static readonly (string Name, string Body)[] FbdShapes =
    {
        ("leaf_assign", "%NETWORK\nout := a;\n"),
        ("literal_assign", "%NETWORK\nout := TRUE;\n"),
        ("int_literal_assign", "%NETWORK\nn := 42;\n"),
        ("and2", "%NETWORK\nout := AND(a, b);\n"),
        ("and2_edit_rename", "%NETWORK\nout := AND(a, c);\n"),
        ("and3", "%NETWORK\nout := AND(a, b, c);\n"),
        ("and8", "%NETWORK\nout := AND(a, b, c, d, e, go, out1, out2);\n"),
        ("or2", "%NETWORK\nout := OR(a, b);\n"),
        ("xor2", "%NETWORK\nout := XOR(a, b);\n"),
        ("not_box", "%NETWORK\nout := NOT(a);\n"),
        ("nest2", "%NETWORK\nout := OR(AND(a, b), c);\n"),
        ("nest3", "%NETWORK\nout := AND(OR(AND(a, b), AND(c, d)), e);\n"),
        ("nest_not", "%NETWORK\nout := NOT(OR(a, b));\n"),
        ("add2", "%NETWORK\nn := ADD(i1, i2);\n"),
        ("add4", "%NETWORK\nn := ADD(i1, i2, i3, i4);\n"),
        ("sub", "%NETWORK\nn := SUB(i1, i2);\n"),
        ("mul_add", "%NETWORK\nn := MUL(ADD(i1, i2), i3);\n"),
        ("div", "%NETWORK\nn := DIV(i1, i2);\n"),
        ("gt", "%NETWORK\nout := GT(i1, i2);\n"),
        ("eq", "%NETWORK\nout := EQ(i1, i2);\n"),
        ("ne_and", "%NETWORK\nout := AND(NE(i1, i2), a);\n"),
        ("max2", "%NETWORK\nn := MAX(i1, i2);\n"),
        ("max3", "%NETWORK\nn := MAX(i1, i2, i3);\n"),
        ("min2", "%NETWORK\nn := MIN(i1, i2);\n"),
        ("limit", "%NETWORK\nn := LIMIT(i1, i2, i3);\n"),
        ("sel", "%NETWORK\nn := SEL(a, i1, i2);\n"),
        ("move", "%NETWORK\nn := MOVE(i1);\n"),
        ("move_stmt", "%NETWORK\nMOVE(a, b);\n"),
        ("abs", "%NETWORK\nn := ABS(i1);\n"),
        ("int_to_real", "%NETWORK\n%UNSUPPORTED \"a target that is no ST variable\" #52d69dce\n"),
        ("shl", "%NETWORK\nw := SHL(w, 2);\n"),
        ("ton_call", "%NETWORK\nt1(IN := a, PT := pt);\n"),
        ("ton_call_t3s", "%NETWORK\nt1(IN := a, PT := T#3S);\n"),
        ("ton_unwired", "%NETWORK\nt1(IN := TRUE, PT := TRUE);\n"),
        ("ton_in_box", "%NETWORK\nt1(IN := AND(a, b), PT := pt);\n"),
        ("ton_q_assign", "%NETWORK\nout := t1(IN := a, PT := pt).Q;\n"),
        ("ton_then_read", "%NETWORK\nt1(IN := a, PT := pt);\nout := t1.Q;\n"),
        ("tof_call", "%NETWORK\nt2(IN := a, PT := pt);\n"),
        ("ctu_call", "%NETWORK\nc1(CU := a, RESET := b, PV := i1);\n"),
        ("rtrig_call", "%NETWORK\nrt(CLK := a);\n"),
        ("sr_call", "%NETWORK\nsr1(SET1 := a, RESET := b);\n"),
        ("member_read", "%NETWORK\nout := AND(t1.Q, c1.Q);\n"),
        ("targets2", "%NETWORK\nout1 := out2 := AND(a, b);\n"),
        ("targets3", "%NETWORK\nout1 := out2 := out3 := OR(a, b);\n"),
        ("fanout2", "%NETWORK\n%WIRES w1\nw1 := AND(a, b);\nout1 := w1;\nout2 := w1;\n"),
        ("fanout3", "%NETWORK\n%WIRES w1\nw1 := AND(a, b);\nout1 := w1;\nout2 := w1;\nout3 := w1;\n"),
        ("fanout_int", "%NETWORK\n%WIRES w1\nw1 := ADD(i1, i2);\nn := w1;\nsv := w1;\n"),
        ("fanout_leaf", "%NETWORK\n%WIRES w1\nw1 := a;\nout1 := w1;\nout2 := w1;\n"),
        ("fanout_into_box", "%NETWORK\n%WIRES w1\nw1 := AND(a, b);\nout1 := OR(w1, c);\nout2 := w1;\n"),
        ("fanout_two_wires", "%NETWORK\n%WIRES w1, w2\nw1 := AND(a, b);\nw2 := OR(c, d);\nout1 := AND(w1, w2);\nout2 := OR(w1, w2);\n"),
        ("jump_cond", "%NETWORK\nJMP(L1, a);\n%NETWORK\nL1:\nout := OR(a, b);\n"),
        ("jump_uncond", "%NETWORK\nJMP L1;\n%NETWORK\nL1:\nout := AND(a, b);\n"),
        ("return_cond", "%NETWORK\nRETURN(a);\n%NETWORK\nout := AND(a, b);\n"),
        ("return_uncond", "%NETWORK\nout := AND(a, b);\n%NETWORK\nRETURN;\n"),
        ("enable_and", "%NETWORK\nout := AND(EN := go, a, b).ENO;\n"),
        ("networks2", "%NETWORK\nout1 := AND(a, b);\n%NETWORK\nout2 := OR(b, c);\n"),
        ("networks3", "%NETWORK\nout1 := a;\n%NETWORK\nout2 := AND(b, c);\n%NETWORK\nt1(IN := out2, PT := pt);\n"),
        ("networks5", string.Concat(Enumerable.Range(1, 5).Select(k => $"%NETWORK\nout{(k % 3) + 1} := AND(a, b);\n"))),
        ("two_rungs", "%NETWORK\nout1 := AND(a, b);\nout2 := OR(c, d);\n"),
        ("mixed_big", "%NETWORK\nout := OR(AND(GT(ADD(i1, i2), i3), a), AND(b, NOT(c)));\n"),
        // Every standard operator and function the shapes above do not hold: which CallType TwinCAT stores for each.
        ("op_mod", "%NETWORK\nn := MOD(i1, i2);\n"),
        ("op_mul", "%NETWORK\nn := MUL(i1, i2);\n"),
        ("op_ge", "%NETWORK\nout := GE(i1, i2);\n"),
        ("op_le", "%NETWORK\nout := LE(i1, i2);\n"),
        ("op_lt", "%NETWORK\nout := LT(i1, i2);\n"),
        ("op_shr", "%NETWORK\nw := SHR(w, 1);\n"),
        ("op_rol", "%NETWORK\nw := ROL(w, 3);\n"),
        ("op_ror", "%NETWORK\nw := ROR(w, 3);\n"),
        ("op_mux", "%NETWORK\nn := MUX(i1, i2, i3, i4);\n"),
        ("op_sqrt", "%NETWORK\ny := SQRT(x);\n"),
        ("op_ln", "%NETWORK\ny := LN(x);\n"),
        ("op_log", "%NETWORK\ny := LOG(x);\n"),
        ("op_exp", "%NETWORK\ny := EXP(x);\n"),
        ("op_expt", "%NETWORK\ny := EXPT(x, y);\n"),
        ("op_sin", "%NETWORK\ny := SIN(x);\n"),
        ("op_cos", "%NETWORK\ny := COS(x);\n"),
        ("op_tan", "%NETWORK\ny := TAN(x);\n"),
        ("op_asin", "%NETWORK\ny := ASIN(x);\n"),
        ("op_acos", "%NETWORK\ny := ACOS(x);\n"),
        ("op_atan", "%NETWORK\ny := ATAN(x);\n"),
        ("op_trunc", "%NETWORK\nn := TRUNC(x);\n"),
        ("op_real_to_int", "%NETWORK\nn := REAL_TO_INT(x);\n"),
        ("op_bool_to_int", "%NETWORK\nn := BOOL_TO_INT(a);\n"),
        ("op_word_to_dword", "%NETWORK\ndw := WORD_TO_DWORD(w);\n"),
        ("op_time_to_lint", "%NETWORK\nli := TIME_TO_LINT(tm);\n"),
        ("op_to_uint", "%NETWORK\nui := TO_UINT(i1);\n"),
        ("op_adr", "%NETWORK\ndw := ADR(n);\n"),
        ("op_sizeof", "%NETWORK\nn := SIZEOF(n);\n"),
        ("fn_len", "%NETWORK\nn := LEN(s1);\n"),
        ("fn_concat", "%NETWORK\ns1 := CONCAT(s1, s2);\n"),
        ("fn_left", "%NETWORK\ns2 := LEFT(s1, 3);\n"),
        ("fn_user", "%NETWORK\nn := F_Custom(i1, i2);\n"),
        ("fn_user_named", "%NETWORK\nn := F_Custom(A := i1, B := i2);\n"),
        ("fb_user", "%NETWORK\nfb1(A := a, B := i1);\n"),
        ("fb_rs", "%NETWORK\nrs1(SET := a, RESET1 := b);\n"),
        ("fb_ftrig", "%NETWORK\nft(CLK := a);\n"),
        ("fb_ctd", "%NETWORK\nctd1(CD := a, LOAD := b, PV := i1);\n"),
        ("fb_ctud", "%NETWORK\nctud1(CU := a, CD := b, RESET := c, LOAD := d, PV := i1);\n"),
        ("fb_tp", "%NETWORK\ntp1(IN := a, PT := T#500MS);\n"),
        // Sizes and nestings: boxes on every pin, a deep chain, literals, wide reads, mixed networks.
        ("ton_boxes_on_pins", "%NETWORK\nt1(IN := OR(AND(a, b), c), PT := SEL(a, pt, T#2S));\n"),
        ("chain_deep", "%NETWORK\nn := MOD(DIV(SUB(MUL(ADD(i1, 1), 2), 3), 4), 5);\n"),
        ("literals", "%NETWORK\nn := LIMIT(0, i1, 16#FF);\n"),
        ("member_assign", "%NETWORK\nout := OR(t1.Q, t2.Q, c1.Q, rt.Q);\n"),
        ("networks_mixed4", "%NETWORK\nout1 := AND(a, b);\n%NETWORK\nt1(IN := out1, PT := pt);\n%NETWORK\nn := MAX(i1, i2);\n%NETWORK\nout2 := t1.Q;\n"),
        ("enable_move", "%NETWORK\nout := MOVE(EN := a, i1).ENO;\n"),
        ("fanout_box_to_two_boxes", "%NETWORK\n%WIRES w1\nw1 := MAX(i1, i2);\nn := ADD(w1, 1);\nsv := MUL(w1, 2);\n"),
        ("targets_after_box", "%NETWORK\nout1 := out2 := out3 := OR(AND(a, b), AND(c, d));\n"),
        // Edits of shapes above: the same network after one change, to see what an edit moves.
        ("and3_edit_pin_removed", "%NETWORK\nout := AND(a, c);\n"),
        ("nest2_edit_inner_op", "%NETWORK\nout := OR(OR(a, b), c);\n"),
        ("networks2_edit_swapped", "%NETWORK\nout2 := OR(b, c);\n%NETWORK\nout1 := AND(a, b);\n"),
        ("ton_call_edit_pt", "%NETWORK\nt1(IN := a, PT := T#10S);\n"),
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
        try { return StNetworkReader.Read($"%LANGUAGE {lang}\n" + body, Scope); }
        catch (StNetworkReadException e) { throw new InvalidOperationException(e.Message, e); }
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
            Assert.Equal("%LANGUAGE FBD\n" + body, File.ReadAllText(Path.Combine(Import, name + ".network.txt")).Replace("\r\n", "\n"));
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
