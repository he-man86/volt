using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// THE NATIVE BUILDER, OFFLINE (openspec twincat-inproc-host 3): every body TwinCAT wrote — the native corpus and the
/// vendor fixtures — read as a model and built back by <see cref="TcArchiveBuilder"/> must read back as the same model,
/// and every element the builder writes must carry a member list TwinCAT itself wrote for that type.
/// </summary>
public sealed class TcArchiveBuilderTests(Xunit.Abstractions.ITestOutputHelper output)
{
    private static readonly Lazy<IReadOnlyList<TcArchiveIdentityTests.Archive>> Vendor = new(() =>
        TcArchiveIdentityTests.All()
            .Where(a => a.Root == "NWLImplementationObject" && TcArchiveIdentityTests.Mismatch(a) is null)
            .ToList());

    /// <summary>A vendor body as the model a pull hands the push, or null where the reader refuses it.</summary>
    private static NetworkBody? Model(TcArchiveIdentityTests.Archive a)
    {
        var impl = TcArchiveWriter.ParseObject(a.Object);
        var language = string.Equals(TcArchive.ViewMode(impl), "Ld", StringComparison.OrdinalIgnoreCase) ? BodyLanguage.Ld : BodyLanguage.Fbd;
        try { return TcNetworkReader.Read(impl, language); }
        catch (UnrepresentableBodyException) { return null; }
    }

    private static NetworkBody ReadBack(string body)
    {
        var impl = TcArchive.Root(body) ?? throw new Xunit.Sdk.XunitException("the built body is no NWL archive");
        var language = string.Equals(TcArchive.ViewMode(impl), "Ld", StringComparison.OrdinalIgnoreCase) ? BodyLanguage.Ld : BodyLanguage.Fbd;
        return TcNetworkReader.Read(impl, language);
    }

    /// <summary>THE SHAPES THE NWL COMPLETENESS GATE SPELLED (nwl-schema-completeness-gate, 2026-10-31), offline: each text
    /// builds an archive that reads back to its model — the operand comment in the archive's <c>Comment</c>. A mark on the
    /// assignment item is refused by name as every shape no TwinCAT build measured (a negated coil, a parallel branch).</summary>
    [Theory]
    [InlineData("a;")]
    [InlineData("INVERT(AND(a, b));")]
    [InlineData("RAIL();")]
    [InlineData("ASSIGN(COMMENT(a, 'why'), Q => COMMENT(y, 'it$'s'));")]
    [InlineData("MOVE(COMMENT(a, 'why'), OUT => COMMENT(x, 'why'));")]
    public void A_spelled_shape_builds_back_to_its_model(string code)
    {
        var text = $"%LANGUAGE LD\n%NETWORK\n{code}\n";
        var scope = NetworkModelScopes.ScopeOf(StNetworkReader.Read(text, NetworkScope.Empty));
        var model = StNetworkReader.Read(text, scope);
        var back = ReadBack(TcArchiveBuilder.Body(model, scope));
        Assert.Equal(text, StNetworkWriter.Write(back, scope));
    }

    [Fact]
    public void A_mark_on_the_assignment_item_is_refused_by_name_as_unmeasured()
    {
        var text = "%LANGUAGE LD\n%NETWORK\nASSIGN(INVERT(a), Q => y);\n";
        var scope = NetworkModelScopes.ScopeOf(StNetworkReader.Read(text, NetworkScope.Empty));
        Assert.Contains("a mark on the assignment item",
            Assert.Throws<NetworkTextException>(() => TcArchiveBuilder.Body(StNetworkReader.Read(text, scope), scope)).Message);
    }

    /// <summary>An Execute box hiding its ENO (F13) has no measured TwinCAT archive form: refused under the code every
    /// unbuildable network takes, <c>NETWORK_UNSUPPORTED</c> — it reached the push as a bare <c>UNSUPPORTED</c> (release
    /// matrix 2026-11-01, twincat-32).</summary>
    [Fact]
    public void An_Execute_box_hiding_its_ENO_is_refused_as_an_unsupported_network()
    {
        var text = "%LANGUAGE FBD\n%NETWORK\nEXECUTE(EN := go, 'n := 1;');\n";
        var scope = new NetworkScope(new[] { "go", "n" }, Array.Empty<string>(), new Dictionary<string, string>());
        // no text states it (the Execute box's ENO is shown by type, network-language rule 4): the model a vendor reader gives
        var read = NetworkText.Validate(text, scope);
        var hidden = read with { Networks = read.Networks.Select(n => n with { Trees = n.Trees.Select(t => (Node)(((Box)t) with { HasEnoOutput = false })).ToList() }).ToList() };
        var e = Assert.Throws<NetworkTextException>(() => TcArchiveBuilder.Body(hidden, scope));
        Assert.Equal(Volt.Contracts.ConflictCodes.NetworkUnsupported, e.Code);
        Assert.Contains("an Execute box that shows no ENO", e.Message);
    }

    [Fact]
    public void Every_vendor_body_builds_back_to_the_model_it_was_read_as()
    {
        var failures = new List<string>();
        var refused = new SortedDictionary<string, int>(StringComparer.Ordinal);
        int built = 0, unread = 0;
        foreach (var a in Vendor.Value)
        {
            if (Model(a) is not { } model) { unread++; continue; }
            string body;
            try { body = TcArchiveBuilder.Body(model, TcText.ScopeOf(model)); }
            catch (Exception e) when (e is NotSupportedException or NetworkTextException)
            {
                var key = e.Message.Length > 90 ? e.Message.Substring(0, 90) : e.Message;
                refused[key] = refused.TryGetValue(key, out var c) ? c + 1 : 1;
                continue;
            }
            built++;
            var back = ReadBack(body);
            if (NetworkModelEquality.FirstDifference(model, back) is { } diff) failures.Add($"{a}: {diff}");
        }
        output.WriteLine($"{built} built, {unread} the reader refuses, refused by the builder: " +
                         string.Join("; ", refused.Select(kv => $"{kv.Value}x {kv.Key}")));
        Assert.True(built >= 100, $"only {built} bodies built");
        Assert.True(failures.Count == 0, $"{failures.Count} bodies read back different:\n" + string.Join("\n", failures.Take(15)));
    }

    /// <summary>A built body's archive object, as the identity gate parses one.</summary>
    private static XElement Graph(string body)
    {
        var start = body.IndexOf("<o xml:space=", StringComparison.Ordinal);
        var end = body.LastIndexOf("</o></Data>", StringComparison.Ordinal) + "</o>".Length;
        return TcArchiveWriter.ParseObject(body.Substring(start, end - start));
    }

    /// <summary>Member lists: the census of every object in every vendor NWL archive, by type.</summary>
    private static readonly Lazy<Dictionary<string, HashSet<string>>> Signatures = new(() =>
    {
        var map = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        foreach (var a in Vendor.Value) Census(TcArchiveWriter.ParseObject(a.Object), map);
        return map;
    });

    private static void Census(XElement root, Dictionary<string, HashSet<string>> map)
    {
        foreach (var o in root.DescendantsAndSelf("o"))
        {
            var type = TcArchive.TypeOf(o) ?? "?";
            if (!map.TryGetValue(type, out var set)) map[type] = set = new HashSet<string>(StringComparer.Ordinal);
            set.Add(Signature(o));
        }
    }

    /// <summary>An object's member list: each member's element kind and name, in order, with its type where it states one.</summary>
    private static string Signature(XElement o) =>
        string.Join(",", o.Elements().Select(m =>
            m.Name.LocalName + ":" + ((string?)m.Attribute("n") ?? "") +
            ((string?)m.Attribute("t") is { } t && m.Name.LocalName == "v" ? "/" + t : "")));

    [Fact]
    public void Every_element_built_has_a_member_list_TwinCAT_wrote()
    {
        var seen = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        foreach (var a in Vendor.Value)
        {
            if (Model(a) is not { } model) continue;
            try { Census(Graph(TcArchiveBuilder.Body(model, TcText.ScopeOf(model))), seen); }
            catch (Exception e) when (e is NotSupportedException or NetworkTextException) { }
        }
        foreach (var shape in TcNativeCorpusTests.FbdShapes.Concat(BeyondTheImport))
        {
            try { Census(Graph(TcArchiveBuilder.Body(TcNativeCorpusTests.Model(shape.Body), TcNativeCorpusTests.Scope)), seen); }
            catch (Exception e) when (e is NotSupportedException or InvalidOperationException or NetworkTextException) { }
        }
        var unknown = seen.SelectMany(kv => kv.Value
                .Where(sig => !Signatures.Value.TryGetValue(kv.Key, out var vendor) || !vendor.Contains(sig))
                .Select(sig => $"{kv.Key}: {sig}"))
            .ToList();
        Assert.True(unknown.Count == 0, "member lists TwinCAT never wrote:\n" + string.Join("\n", unknown));
    }

    [Fact]
    public void The_CallType_table_is_what_TwinCAT_stores()
    {
        var mismatches = new List<string>();
        foreach (var a in Vendor.Value)
            foreach (var box in TcArchiveWriter.ParseObject(a.Object).Descendants("o").Where(o => TcArchive.TypeOf(o) == "BoxTreeBox"))
            {
                var type = TcArchive.Str(box, "BoxType") ?? "";
                var stored = box.Elements("v").FirstOrDefault(v => (string?)v.Attribute("n") == "CallType")?.Value;
                if (stored is null || stored is "None" or "FunctionBlock" or "Function" or "Conversion") continue;
                if (!TcArchiveBuilder.Operators.TryGetValue(type, out var known) || known != stored)
                    mismatches.Add($"{a}: {type} stores {stored}, the table says {known ?? "nothing"}");
            }
        Assert.True(mismatches.Count == 0, string.Join("\n", mismatches.Distinct()));
    }

    /// <summary>THE SHAPES THE PLCOPEN IMPORT COULD NOT CREATE (each was refused or reshaped on the old route, proposal
    /// "Why"), in both languages: built natively, each must pull back as the text that was pushed. The live half is
    /// <c>test/e2e/graphical/native-writer.test.ts</c>.</summary>
    public static readonly (string Name, string Body)[] BeyondTheImport =
    {
        ("single_consumer_branch", "%NETWORK\nVAR w1 : ANY; END_VAR\nw1 := a AND b;\nASSIGN(w1, Q => out);\n"),
        ("fanout_two_coils", "%NETWORK\nVAR w1 : ANY; END_VAR\nw1 := a AND b;\nASSIGN(w1, Q => out1);\nASSIGN(w1, Q => out2);\n"),
        ("leaf_fed_split", "%NETWORK\nVAR w1 : ANY; END_VAR\nw1 := a;\nASSIGN(w1, Q => out1);\nASSIGN(w1, Q => out2);\n"),
        ("unconnected_pin", "%NETWORK\nt1(PT := pt);\n"),
        ("pin_to_variable", "%NETWORK\nt1(IN := a, PT := pt, ET => el);\n"),
        ("pin_to_variable_consumed", "%NETWORK\nASSIGN(t1(IN := a, PT := pt, ET => el).Q, Q => out);\n"),
        ("negated_input", "%NETWORK\nASSIGN(INVERT(a) AND b, Q => out);\n"),
        ("set_coil", "%NETWORK\nASSIGN(a, Q_SET => out);\n"),
        ("reset_coil", "%NETWORK\nASSIGN(a AND b, Q_RESET => out);\n"),
        ("rising_edge", "%NETWORK\nASSIGN(RISING(a) AND b, Q => out);\n"),
        ("execute", "%NETWORK\nEXECUTE(EN := go, 'n := n + 1;');\n"),
        ("execute_consumed", "%NETWORK\nASSIGN(EXECUTE(EN := go, 'n := 1;'), Q => out);\n"),
        ("multi_rung", "%NETWORK\nASSIGN(a AND b, Q => out1);\nASSIGN(c OR d, Q => out2);\nt1(IN := e, PT := pt);\n"),
        ("assign_below_top", "%NETWORK\nt1(IN := ASSIGN(go, Q => out), PT := pt);\n"),
        ("jump_and_label", "%NETWORK\nASSIGN(a, Q => JMP.L1);\n%NETWORK\nL1:\nASSIGN(a OR b, Q => out);\n"),
        ("return_uncond", "%NETWORK\nASSIGN(a AND b, Q => out);\n%NETWORK\nASSIGN(RAIL(), Q => RETURN);\n"),
        ("unconnected_coil", "%NETWORK\nASSIGN(TRUE, Q => out);\n"),
        ("empty_network", "%NETWORK\nASSIGN(a AND b, Q => out);\n%NETWORK\n"),
        ("header", "%NETWORK \"a rung\"\n%DISABLED\n// two lines\n// of comment\nHere:\nASSIGN(a AND b, Q => out);\n"),
        ("enable_and", "%NETWORK\nAND(EN := go, a, b, OUT => out);\n"),
        ("enable_move", "%NETWORK\nASSIGN(MOVE(EN := go, b, OUT => n), Q => out);\n"),
        ("function_named", "%NETWORK\nASSIGN(F_Custom(A := i1, B := i2), Q => n);\n"),
    };

    /// <summary>The shapes the builder refuses, by the phrase of the reason.</summary>
    private static readonly Dictionary<string, string> Refused = new(StringComparer.Ordinal)
    {
        // `.Q` names the output `out` reads, and its slot is the TON's declaration's: this suite's scope holds no library
        // signature, so the slot is unknown and the builder refuses rather than guess it (a push derives it from the IDE's).
        ["pin_to_variable_consumed"] = "name an output of",
    };

    public static TheoryData<string, string> BeyondTheImportCases()
    {
        var d = new TheoryData<string, string>();
        foreach (var (name, _) in BeyondTheImport) { d.Add(name, "FBD"); d.Add(name, "LD"); }
        return d;
    }

    [Theory]
    [MemberData(nameof(BeyondTheImportCases))]
    public void A_shape_the_import_could_not_create_builds_and_pulls_the_same_text(string name, string language)
    {
        var body = BeyondTheImport.Single(s => s.Name == name).Body;
        var model = TcNativeCorpusTests.Model(body, language);
        if (Refused.TryGetValue(name, out var why))
        {
            Assert.Contains(why, Assert.ThrowsAny<Exception>(() => TcArchiveBuilder.Body(model, TcNativeCorpusTests.Scope)).Message);
            return;
        }
        var built = TcArchiveBuilder.Body(model, TcNativeCorpusTests.Scope);
        var scope = TcNativeCorpusTests.Scope;
        // The shapes are written as a pull writes them, so the live suite (native-writer.test.ts) can compare by text.
        Assert.Equal($"%LANGUAGE {language}\n" + body, StNetworkWriter.Write(model, scope));
        Assert.Equal(StNetworkWriter.Write(model, scope), StNetworkWriter.Write(ReadBack(built), scope));
        // And the text TwinCAT will hold is the vendor's layout, by the identity gate's own writer.
        Assert.Equal(built, TcArchiveWriter.WriteBody(Graph(built)));
    }

    /// <summary>AN EDITED BODY IS STILL IN TWINCAT'S LAYOUT. TwinCAT stores what it is handed (DIALECT N42 a), so a body the
    /// in-place writer changed — a network rebuilt natively, one inserted, one removed — must still pass the identity gate:
    /// every line where TwinCAT puts it, no blank line, a TypeList naming exactly the types used.</summary>
    [Fact]
    public void A_body_edited_with_built_networks_keeps_the_vendor_layout()
    {
        var checkedBodies = 0;
        var failures = new List<string>();
        foreach (var a in Vendor.Value.Where(a => a.BodyForm || a.File.EndsWith(".TcPOU", StringComparison.OrdinalIgnoreCase)))
        {
            if (Model(a) is not { } model || model.Networks.Count == 0) continue;
            var body = "<NWL><XmlArchive><Data>" + a.Object + "</Data><TypeList>" +
                       string.Concat(a.Types.Select(t => $"<Type n=\"{t.Name}\">{t.Guid}</Type>")) + "</TypeList></XmlArchive></NWL>";
            var scope = TcText.ScopeOf(model);
            // Rebuild the first network (a value edit would be written in place, so its shape changes: a new network is
            // added in front), drop the last, and add one at the end.
            var extra = new Network(0, null, null, null, false,
                new Node[] { new Assign(new Leaf(new Operand("vnA"), Flags.None), new[] { new Operand("vnB", IsLValue: true) }, Flags.None) });
            var edited = model with
            {
                Networks = new[] { extra }.Concat(model.Networks.Take(model.Networks.Count - 1)).Append(extra)
                    .Select((n, i) => n with { Order = i }).ToList(),
            };
            string? written;
            try { written = TcNetworkWriter.Apply(body, edited, TcText.ScopeOf(edited), TcArchiveBuilder.NetworkGraph); }
            catch (Exception e) when (e is NotSupportedException or NetworkTextException) { continue; }
            if (written is null) continue;
            checkedBodies++;
            var start = written.IndexOf("<o xml:space=", StringComparison.Ordinal);
            var end = written.LastIndexOf("</o></Data>", StringComparison.Ordinal) + "</o>".Length;
            var obj = written.Substring(start, end - start);
            var indent = System.Text.RegularExpressions.Regex.Match(obj, ">\\r?\\n( *)<").Groups[1].Value.Length - 2;
            var newline = obj.Contains("\r\n", StringComparison.Ordinal) ? "\r\n" : "\n";
            Assert.Equal(obj, TcArchiveWriter.WriteObject(TcArchiveWriter.ParseObject(obj), indent, newline));
            var listed = System.Text.RegularExpressions.Regex.Matches(written, "<Type n=\"(\\w+)\">").Select(m => m.Groups[1].Value);
            Assert.Equal(TcArchiveWriter.TypeNames(TcArchiveWriter.ParseObject(obj)), listed);
            try { Assert.Equal(TcText.Write(edited), TcText.Write(ReadBack(written))); }
            catch (Exception e) { failures.Add($"{a}: {e.Message.Split('\n')[0]}"); }
        }
        output.WriteLine($"{checkedBodies} edited bodies checked");
        Assert.True(failures.Count == 0, string.Join("\n", failures));
        Assert.True(checkedBodies >= 20, $"only {checkedBodies} bodies could be edited");
    }

    /// <summary>Every corpus shape's network text, built natively, reads back as the same text.</summary>
    [Fact]
    public void Every_corpus_shape_builds_from_its_text_and_pulls_the_same_text()
    {
        var failures = new List<string>();
        var refused = new List<string>();
        foreach (var (name, text) in TcNativeCorpusTests.FbdShapes)
        {
            NetworkBody model;
            try { model = TcNativeCorpusTests.Model(text); }
            catch (InvalidOperationException) { continue; }   // the text the corpus itself refuses (REFUSED.txt)
            string body;
            try { body = TcArchiveBuilder.Body(model, TcNativeCorpusTests.Scope); }
            catch (Exception e) when (e is NotSupportedException or NetworkTextException) { refused.Add($"{name}: {e.Message}"); continue; }
            var scope = TcNativeCorpusTests.Scope;
            var want = StNetworkWriter.Write(model, scope);
            string got;
            try { got = StNetworkWriter.Write(ReadBack(body), scope); }
            catch (Exception e) { failures.Add($"{name}: {e.GetType().Name} {e.Message}"); continue; }
            if (got != want) failures.Add($"{name}:\n--- text\n{want}--- built, pulled\n{got}");
        }
        output.WriteLine("refused: " + string.Join("\n", refused));
        Assert.True(failures.Count == 0, string.Join("\n", failures.Take(10)));
    }

    /// <summary>THE BUILDER'S <c>?? ""</c> IS THE IDE'S OWN SPELLING OF "NONE", PROVED, NOT A DEFAULT (zero-fallback review
    /// 2026-10-28). The model's null title, label, comment and operand symbol comment are built as the quoted empty string —
    /// and every vendor network and operand whose model holds null there stores exactly <c>""</c> (no explicit null, no
    /// absence), so null ↔ <c>""</c> is one to one and the build writes back what the IDE holds.</summary>
    [Fact]
    public void A_null_header_or_symbol_comment_is_built_as_the_empty_string_every_vendor_archive_holds_for_none()
    {
        static string? Raw(XElement owner, string name) =>
            owner.Elements().FirstOrDefault(m => (string?)m.Attribute("n") == name) is { } m
                ? m.Name.LocalName == "v" ? m.Value : "<" + m.Name.LocalName + ">"
                : "(absent)";
        int networks = 0, operands = 0;
        foreach (var a in Vendor.Value)
        {
            var impl = TcArchiveWriter.ParseObject(a.Object);
            if (Model(a) is not { } model) continue;
            var stored = TcArchive.List(impl, "NetworkList");
            Assert.Equal(stored.Count, model.Networks.Count);
            for (var i = 0; i < stored.Count; i++)
            {
                var n = model.Networks[i];
                var built = TcArchiveBuilder.NetworkGraph(n with { Trees = Array.Empty<Node>() }, TcText.ScopeOf(model));
                foreach (var (name, value) in new[] { ("Title", n.Title), ("Label", n.Label), ("Comment", n.Comment) })
                {
                    if (value is not null) continue;
                    Assert.Equal("\"\"", Raw(stored[i], name));
                    Assert.Equal("\"\"", Raw(built, name));
                    networks++;
                }
            }
            foreach (var op in impl.Descendants("o").Where(o => TcArchive.TypeOf(o) == "Operand"))
            {
                Assert.Equal("\"\"", Raw(op, "SymbolComment"));
                operands++;
            }
        }
        output.WriteLine($"{networks} null header members, {operands} operands checked");
        Assert.True(networks > 100 && operands > 100);
    }

    /// <summary>An Execute box the text states without EN is built showing no EN: EN shown over an input list holding no EN
    /// pin read back as the "no slot of that name" marker (live, refused-shapes.test.ts "an EXECUTE box" edit).</summary>
    [Fact]
    public void An_Execute_box_without_EN_builds_without_EN_and_reads_back_the_same()
    {
        var scope = new NetworkScope(new[] { "out", "a" }, Array.Empty<string>(), new Dictionary<string, string>());
        const string text = "%LANGUAGE FBD\n%NETWORK\nEXECUTE('out := a;');\n";
        var back = ReadBack(TcArchiveBuilder.Body(NetworkText.Validate(text, scope), scope));
        Assert.Equal(text, StNetworkWriter.Write(back, scope));
    }
}
