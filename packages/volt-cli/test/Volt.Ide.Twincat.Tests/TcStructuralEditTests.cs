using Volt.Tests.Shared;
using System;
using System.Linq;
using System.Xml.Linq;
using Volt.Contracts;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Xunit;
using Volt.Engine;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// A STRUCTURALLY CHANGED TWINCAT NETWORK, offline (openspec network-text-literal-nwl, tasks 4.2 and 4.3).
///
/// <para>A value edit is written in place; a network whose SHAPE changed is rebuilt — built natively by
/// <see cref="TcArchiveBuilder"/> and spliced in (<see cref="TcNetworkWriter.Apply(string?, NetworkBody, NetworkScope, Func{Network, NetworkScope, XElement}?)"/>'s
/// <c>resolve</c>). It went through TwinCAT's PLCopen import until openspec twincat-inproc-host, which refused three shapes
/// the import was not measured for — a parallel branch, a split whose producer is a leaf, a box's result pin — and every
/// network holding independent rungs (the importer split them, D25). Only the parallel branch stays refused: TwinCAT never
/// wrote one, so the builder has no member list to build it from.</para>
/// </summary>
public class TcStructuralEditTests
{
    private const string Declaration =
        "PROGRAM P\nVAR\n  xoutput : BOOL;\n  xoutput2 : BOOL;\n  xtest : BOOL;\n  xtest2 : BOOL;\n  c : BOOL;\n  n : INT;\nEND_VAR";

    private static readonly NetworkScope Scope =
        NetworkScope.FromDeclarations(Declaration, _ => null, () => Array.Empty<string>(), Volt.Tests.Shared.Scopes.NoItem, BeckhoffDriver.RefusedPouName, Volt.Tests.Shared.Scopes.NoLibrary);

    /// <summary>The hand-drawn <c>ladder.TcPOU</c>: ONE network, <c>xoutput := (xtest OR xtest2);</c>, LD view.</summary>
    private static string Ladder() =>
        XDocument.Parse(Fixtures.Pou("ladder.TcPOU"), LoadOptions.PreserveWhitespace)
            .Descendants("NWL").Single().ToString(SaveOptions.DisableFormatting);

    private static NetworkBody Pushed(params string[] statements) =>
        NetworkText.Validate("%LANGUAGE LD\n%NETWORK\n" + string.Concat(statements.Select(s => s + "\n")), Scope);

    private static XElement NeverImported(Network n, NetworkScope scope) =>
        throw new Xunit.Sdk.XunitException($"the importer was reached for network {n.Order + 1}");

    private static NetworkTextException RefusedByTheBuilder(NetworkBody pushed) =>
        Assert.Throws<NetworkTextException>(() => TcNetworkWriter.Apply(Ladder(), pushed, Scope, TcArchiveBuilder.NetworkGraph));

    /// <summary>The ladder rebuilt natively with <paramref name="pushed"/>: what the next pull reads, as text.</summary>
    private static string RebuiltAndPulled(NetworkBody pushed)
    {
        var written = TcNetworkWriter.Apply(Ladder(), pushed, Scope, TcArchiveBuilder.NetworkGraph);
        Assert.NotNull(written);
        return StNetworkWriter.Write(TcNetworkReader.Read(TcArchive.Root(written)!, BodyLanguage.Ld), Scope);
    }

    [Fact]
    public void A_Parallel_in_a_structurally_changed_network_is_refused_by_the_builder()
    {
        var ex = RefusedByTheBuilder(Pushed("xoutput := BRANCH(xtest, xtest2);"));

        Assert.Equal(ConflictCodes.NetworkUnsupported, ex.Code);
        Assert.Contains("parallel branch", ex.Message);
    }

    /// <summary>The two shapes the PLCopen import was refused for before it (a leaf-fed split, which crashed the v1
    /// importer and was reshaped by v2, N22; a box's result pin, which the importer lowered to a separate assignment, C20)
    /// are built natively and pull back as pushed.</summary>
    [Theory]
    [InlineData("VAR_TEMP w1 : ANY; END_VAR", "w1 := TRUE;", "xoutput := w1;", "xoutput2 := w1;")]
    [InlineData("MOVE(xtest, OUT => n);")]
    public void A_shape_the_import_refused_is_rebuilt_natively(params string[] statements)
    {
        var pushed = Pushed(statements);
        Assert.Equal(StNetworkWriter.Write(pushed, Scope), RebuiltAndPulled(pushed));
    }

    /// <summary>A CREATE builds the same way, and the push's pre-flight (<c>BeckhoffDriver.ValidateSource</c>, creates
    /// only) runs this same build — so the refusal is the same, by the same code, before any op is written.</summary>
    [Fact]
    public void A_create_holding_a_Parallel_is_refused_by_the_builder()
    {
        var ex = Assert.Throws<NetworkTextException>(() => TcArchiveBuilder.Body(Pushed("xoutput := BRANCH(xtest, xtest2);"), Scope));

        Assert.Equal(ConflictCodes.NetworkUnsupported, ex.Code);
        Assert.Contains("parallel branch", ex.Message);
    }

    /// <summary><c>ladder.TcPOU</c> with <c>xtest</c> carrying a symbol comment — what pro2193's <c>SetAlarm</c> holds
    /// on 10 operands (census ld-fbd-coverage 1b.1), here on the vendor's own LD archive.</summary>
    private static string LadderWithSymbolComment() =>
        System.Text.RegularExpressions.Regex.Replace(Ladder(),
            "(<v n=\"Operand\">\"xtest\"</v>\\s*<v n=\"Type\">\"BOOL\"</v>\\s*<v n=\"Comment\">\"\"</v>\\s*<v n=\"SymbolComment\">)\"\"",
            "$1\" Condition to set the alarm.\"");

    /// <summary>THE LOSS (review 1b-1): the import rebuilds a changed network from the text, and the text carries no
    /// symbol comment, so the rebuilt operand would come back without it — erased with nothing in the diff. Refused,
    /// naming the network and the operand, before the importer is reached.</summary>
    [Fact]
    public void A_structural_change_to_a_network_holding_a_symbol_comment_is_refused_before_the_importer()
    {
        var xml = LadderWithSymbolComment();
        Assert.Contains("Condition to set the alarm.", xml);   // the injection landed

        var ex = Assert.Throws<NetworkTextException>(() =>
            TcNetworkWriter.Apply(xml, Pushed("xoutput := xtest AND xtest2;"), Scope, NeverImported));

        Assert.Equal(ConflictCodes.NetworkUnsupported, ex.Code);
        Assert.Contains("network 1", ex.Message);
        Assert.Contains("symbol comment", ex.Message);
        Assert.Contains("'xtest'", ex.Message);
    }

    /// <summary>…and the same body pushed back UNCHANGED writes nothing: the refusal is for a rebuild, never for a pull.</summary>
    [Fact]
    public void A_network_holding_a_symbol_comment_pushed_back_unchanged_writes_nothing()
    {
        Assert.Null(TcNetworkWriter.Apply(LadderWithSymbolComment(), Pushed("xoutput := xtest OR xtest2;"), Scope, NeverImported));
    }

    /// <summary>The refusal is about THOSE shapes: a structural change without one still reaches the importer — a
    /// retyped box is the measured case the rebuild exists for.</summary>
    [Fact]
    public void A_structural_change_without_those_shapes_still_reaches_the_importer()
    {
        var reached = Assert.Throws<Xunit.Sdk.XunitException>(() =>
            TcNetworkWriter.Apply(Ladder(), Pushed("xoutput := xtest AND xtest2;"), Scope, NeverImported));
        Assert.Contains("importer was reached", reached.Message);
    }

    /// <summary>A VALUE EDIT STAYS IN PLACE (task 4.2), on a network that holds one of the refused shapes: the refusal
    /// is for the import, and a value edit never imports. The Parallel is <c>drawn-refused-shapes.TcPOU</c> with its
    /// terminator swapped for one (<c>TcDrawnJumpTests</c> builds the same body); a branch operand is renamed.</summary>
    [Fact]
    public void A_value_edit_on_a_network_holding_a_Parallel_is_written_in_place()
    {
        var nwl = TcDrawnJumpTests.NwlWithParallel("BoxShortCircuit");
        var xml = nwl.ToString(SaveOptions.DisableFormatting);
        var impl = nwl.DescendantsAndSelf("o").First(o => (string?)o.Attribute("t") == "NWLImplementationObject");
        var model = TcNetworkReader.Read(impl, BodyLanguage.Ld);
        var branch = model.Networks.SelectMany(n => n.Trees).OfType<Assign>()
            .Select(a => a.Value).OfType<Volt.Engine.Format.Network.Parallel>().Single().Branches.OfType<Leaf>().First();
        var renamed = Rename(model, branch.Operand.Text, "renamedBranch");

        var written = TcNetworkWriter.Apply(xml, renamed, TcText.ScopeOf(renamed), NeverImported);

        Assert.NotNull(written);
        Assert.Contains("\"renamedBranch\"", written!);
    }

    /// <summary>A BOX THE IMPORT BUILT IS CONNECTED BY ITS ONE OUTPUT. <c>importer-max.TcPOU</c> is real XAE output
    /// (2026-09-26): Volt pushed <c>n := MAX(a, b);</c> and the PLCopen import built the box with ONE declared output
    /// (<c>OutputParam/Names = [Out1]</c>) and — once the importer's empty operand is dropped — no output item at all,
    /// so no slot is stored null to say which output the consumer reads. The pull read that as "a consumed box with no
    /// stored connection slot" and materialized the marker over the body Volt had just created (found live,
    /// <c>parity-fixes.test.ts</c>). A box with one output has one slot a consumer can read: slot 0.</summary>
    [Fact]
    public void A_consumed_box_the_import_built_is_connected_by_its_one_output()
    {
        var impl = XDocument.Parse(Fixtures.Pou("importer-max.TcPOU"), LoadOptions.PreserveWhitespace)
            .Descendants("NWL").Single().DescendantsAndSelf("o").First(o => (string?)o.Attribute("t") == "NWLImplementationObject");

        var body = TcNetworkReader.Read(impl, BodyLanguage.Fbd);
        var max = Assert.IsType<Box>(Assert.IsType<Assign>(body.Networks.Single().Trees.Single()).Value);

        Assert.Equal(0, max.ConnectedSlot);
        Assert.Contains("\nn := MAX(", TcText.Write(body));
    }

    /// <summary>…and a box that stores no output at all — the stamp writes a function box's names as the text's (none:
    /// a function's result pin is no name a built box holds, ld-fbd-coverage 2.3) — is read through its result, slot 0, as
    /// CODESYS reads a box Volt built (N21). Read as "no slot", the calls program of vendor-facts nwl-call-type pulled its
    /// `k := VltF_RFn(x := i);` as an UNSUPPORTED line (re-run 2026-10-16).</summary>
    [Fact]
    public void A_consumed_box_storing_no_output_at_all_is_read_through_its_result()
    {
        var nwl = XDocument.Parse(Fixtures.Pou("importer-max.TcPOU"), LoadOptions.PreserveWhitespace).Descendants("NWL").Single();
        var box = nwl.Descendants("o").First(o => o.Elements("v").Any(v => (string?)v.Attribute("n") == "BoxType"));
        var names = box.Elements("o").First(o => (string?)o.Attribute("n") == "OutputParam").Elements("l2").First(l => (string?)l.Attribute("n") == "Names");
        names.RemoveNodes();

        var read = TcNetworkReader.Read(nwl.DescendantsAndSelf("o").First(o => (string?)o.Attribute("t") == "NWLImplementationObject"), BodyLanguage.Fbd);

        Assert.Equal(0, Assert.IsType<Box>(Assert.IsType<Assign>(read.Networks.Single().Trees.Single()).Value).ConnectedSlot);
    }

    /// <summary>…and the same with the importer's empty operand still hung off the box — the state TwinCAT's PLCopen
    /// import left before Volt dropped it. Read as "no slot", a push over it refused ("the consumer of box 'MAX' moves to
    /// output slot 0") a body that says what is pushed (found live, <c>parity-fixes.test.ts</c>).</summary>
    [Fact]
    public void A_consumed_box_the_import_built_is_connected_by_its_one_output_before_the_repair_too()
    {
        var nwl = XDocument.Parse(Fixtures.Pou("importer-max.TcPOU"), LoadOptions.PreserveWhitespace).Descendants("NWL").Single();
        var box = nwl.Descendants("o").First(o => o.Elements("v").Any(v => (string?)v.Attribute("n") == "BoxType"));
        var list = box.Elements("o").First(o => (string?)o.Attribute("n") == "OutputItems").Elements("l2").Single();
        // The empty operand as the importer writes one, member for member (Vn_abs.nwl.xml's output operand, its text "").
        static XElement V(string n, string v) => new("v", new XAttribute("n", n), v);
        list.Add(new XElement("o", V("Operand", "\"\""), V("Type", "\"\""), V("Comment", "\"\""), V("SymbolComment", "\"\""),
            V("Address", "\"\""),
            new XElement("o", new XAttribute("n", "Flags"), new XAttribute("t", "Flags"), V("Flags", "0"), V("Fixed", "true"), V("Extensible", "false")),
            V("LValue", "false"), V("Boolean", "false"), V("IsInstance", "false"), V("Id", "99L")));

        var read = TcNetworkReader.Read(nwl.DescendantsAndSelf("o").First(o => (string?)o.Attribute("t") == "NWLImplementationObject"), BodyLanguage.Fbd);

        Assert.Equal(0, Assert.IsType<Box>(Assert.IsType<Assign>(read.Networks.Single().Trees.Single()).Value).ConnectedSlot);
    }

    /// <summary>A PIN NAME THE IDE HOLDS IS THE IDE'S, whoever first wrote it. <c>importer-max.TcPOU</c> holds
    /// <c>InputParam/Names = [In1, In2]</c> on <c>MAX</c>; a push of <c>n := MAX(a, b);</c> leaves those pins positional,
    /// which says to drop the names — refused by name, never blanked.</summary>
    [Fact]
    public void A_positional_push_over_named_pins_is_refused_naming_the_first()
    {
        var xml = XDocument.Parse(Fixtures.Pou("importer-max.TcPOU"), LoadOptions.PreserveWhitespace)
            .Descendants("NWL").Single().ToString(SaveOptions.DisableFormatting);
        var scope = NetworkScope.FromDeclarations("PROGRAM VltProbe_Max\nVAR\n  a : INT;\n  b : INT;\n  n : INT;\nEND_VAR",
                                                  _ => null, () => Array.Empty<string>(), Volt.Tests.Shared.Scopes.NoItem, BeckhoffDriver.RefusedPouName, Volt.Tests.Shared.Scopes.NoLibrary);
        var pushed = NetworkText.Validate("%LANGUAGE FBD\n%NETWORK\nn := MAX(a, b);\n", scope);

        var ex = Assert.Throws<UnsupportedException>(() => TcNetworkWriter.Apply(xml, pushed, scope));
        Assert.Contains("'In1'", ex.Message);
    }

    /// <summary>A CREATED BOX CARRIES THE DERIVED OUTPUT NAMES (gate 2R.3, finding 1). A box read from text states no member
    /// (B7), so the in-place writer keeps the IDE's own output names — but a box the push BUILDS takes the derivation. The
    /// PLCopen import left its own <c>[Out1]</c> on every function box of a created POU (TwinCAT vendor-facts NWL_R_CALLS:
    /// an enabled program call stored <c>['Out1']</c> where it stored <c>['ENO']</c>, and the build said "Identifier not
    /// defined"); the native builder states the derivation itself.</summary>
    [Fact]
    public void A_created_box_carries_the_derived_output_names()
    {
        var scope = NetworkScope.FromDeclarations("PROGRAM VltProbe_Max\nVAR\n  a : INT;\n  b : INT;\n  n : INT;\nEND_VAR",
                                                  _ => null, () => Array.Empty<string>(), Volt.Tests.Shared.Scopes.NoItem, BeckhoffDriver.RefusedPouName, Volt.Tests.Shared.Scopes.NoLibrary);
        var pushed = NetworkText.Validate("%LANGUAGE FBD\n%NETWORK\nn := MAX(a, b);\n", scope);

        var built = TcArchiveBuilder.Body(pushed, scope);

        Assert.DoesNotContain("<v>Out1</v>", built);
        Assert.Contains("\nn := MAX(a, b);\n", StNetworkWriter.Write(TcNetworkReader.Read(TcArchive.Root(built)!, BodyLanguage.Fbd), scope));
    }

    /// <summary>…EVEN WHERE THE TEXT CANNOT TELL ONE BOX FROM ANOTHER (gate 2R.3, found live on the calls program): the
    /// import's <c>[Out1]</c> on <c>t1(IN := , PT := )</c> is no text (B7), so it rendered exactly as pushed. A created
    /// body holds the derivation on every call, whatever the text shows.</summary>
    [Fact]
    public void A_created_body_holds_the_derivation_on_a_network_the_text_cannot_tell_apart()
    {
        var imported = XDocument.Parse(Fixtures.Pou("importer-unwired.TcPOU"), LoadOptions.PreserveWhitespace)
            .Descendants("NWL").Single().ToString(SaveOptions.DisableFormatting);
        Assert.Contains("<v>Out1</v>", imported);
        var scope = NetworkScope.FromDeclarations("PROGRAM VltProbe_Max\nVAR\n  n : INT;\n  m : INT;\n  t1 : TON;\nEND_VAR",
                                                  _ => null, () => Array.Empty<string>(), Volt.Tests.Shared.Scopes.NoItem, BeckhoffDriver.RefusedPouName, Volt.Tests.Shared.Scopes.NoLibrary);
        var text = StNetworkWriter.Write(TcNetworkReader.Read(TcArchive.Root(imported)!, BodyLanguage.Ld), scope);

        var built = TcArchiveBuilder.Body(NetworkText.Validate(text, scope), scope);

        Assert.DoesNotContain("<v>Out1</v>", built);
        Assert.Equal(text, StNetworkWriter.Write(TcNetworkReader.Read(TcArchive.Root(built)!, BodyLanguage.Ld), scope));
    }

    /// <summary>AN UNWIRED PIN THE IMPORT BUILT READS AS THE EMPTY SLOT IT IS. <c>importer-unwired.TcPOU</c> is real XAE
    /// output of <c>n := MUL(, m, 6);</c> and <c>t1(IN := , PT := );</c>: the import holds each unconnected pin as an
    /// operand with no text, where CODESYS holds a terminator, and it came back <c>(`` * m * 6)</c> (found live,
    /// <c>real-project-shapes.test.ts</c>). Read as the model's one "unconnected", and pushed back unchanged.</summary>
    [Fact]
    public void An_unwired_pin_the_import_built_reads_as_the_empty_slot_and_pushes_back_unchanged()
    {
        var xml = XDocument.Parse(Fixtures.Pou("importer-unwired.TcPOU"), LoadOptions.PreserveWhitespace)
            .Descendants("NWL").Single().ToString(SaveOptions.DisableFormatting);
        var scope = NetworkScope.FromDeclarations("PROGRAM VltProbe_Max\nVAR\n  n : INT;\n  m : INT;\n  t1 : TON;\nEND_VAR",
                                                  _ => null, () => Array.Empty<string>(), Volt.Tests.Shared.Scopes.NoItem, BeckhoffDriver.RefusedPouName, Volt.Tests.Shared.Scopes.NoLibrary);

        var pulled = TcNetworkReader.Read(TcArchive.Root(xml)!, BodyLanguage.Ld);
        var text = StNetworkWriter.WritePulled(pulled, scope);

        // An unwired pin is the rail, TRUE (a stored member, design.md 1.4).
        Assert.Contains("\nn := MUL(TRUE, m, 6);\n", text);
        // The import's output list is a stored member the text derives (B7): not written, kept by an unchanged push.
        Assert.Contains("\nt1(IN := TRUE, PT := TRUE);\n", text);
        Assert.Null(TcNetworkWriter.Apply(xml, NetworkText.Validate(text, scope), scope));
    }

    /// <summary>…and an unwired ENABLE is the same empty slot. The import builds an unconnected <c>EN</c> exactly as it
    /// builds an unconnected data pin (the deleted PLCopen lowering emitted the enable first, a terminator as an empty
    /// <c>&lt;inVariable&gt;</c>), so the capture's first pin renamed <c>EN</c> is that slot. The fix for the empty
    /// backticked name covered the data pins only, and this came back as <c>EN := ``</c>.</summary>
    [Fact]
    public void An_unwired_enable_the_import_built_reads_as_the_empty_slot_and_pushes_back_unchanged()
    {
        var xml = XDocument.Parse(Fixtures.Pou("importer-unwired.TcPOU"), LoadOptions.PreserveWhitespace)
            .Descendants("NWL").Single().ToString(SaveOptions.DisableFormatting).Replace("<v>IN</v>", "<v>EN</v>");
        // The slot renamed EN is the enable only on a box that SHOWS it (network-text-st 2.2, `Box.ShowsEnable`): the TON
        // states its EN flag, as the vendor does on every enabled box.
        var nwl = XElement.Parse(xml, LoadOptions.PreserveWhitespace);
        SetShown(nwl.Descendants("o").First(o => o.Elements("v").Any(v => (string?)v.Attribute("n") == "BoxType" && v.Value == "\"TON\"")), "EN");
        xml = nwl.ToString(SaveOptions.DisableFormatting);
        var scope = NetworkScope.FromDeclarations("PROGRAM VltProbe_Max\nVAR\n  n : INT;\n  m : INT;\n  t1 : TON;\nEND_VAR",
                                                  _ => null, () => Array.Empty<string>(), Volt.Tests.Shared.Scopes.NoItem, BeckhoffDriver.RefusedPouName, Volt.Tests.Shared.Scopes.NoLibrary);

        var pulled = TcNetworkReader.Read(TcArchive.Root(xml)!, BodyLanguage.Ld);
        var box = pulled.Networks.SelectMany(n => n.Trees).OfType<Box>().Single(b => b.Type == "TON");
        Assert.IsType<Terminator>(box.Enable);

        // An enabled box with no ENO at the root is its call with `EN :=` and no member (network-output-member), its unwired
        // enable the rail, TRUE; pushed back unchanged it is kept.
        var text = StNetworkWriter.WritePulled(pulled, scope);
        Assert.Contains("\nt1(EN := TRUE, PT := TRUE);\n", text);
        Assert.Null(TcNetworkWriter.Apply(xml, NetworkText.Validate(text, scope), scope));
    }

    // -- 4.3: the component count ---------------------------------------------------------------------------------

    /// <summary>A WIRE AND EVERYTHING THAT READS IT ARE ONE RUNG (D25), wherever the reference sits. The count used a
    /// legacy fold (<c>Unhoist</c>) that joined only a wire read DIRECTLY by an assignment (<c>out := g1;</c>) — and
    /// census 1.8 found every one of 434 real references NESTED (<c>out := (g1 OR c);</c>). Such a network counted as
    /// two rungs and a rebuild was refused as "would split it"; it is one connected rung, so the IDE rebuilds it whole.</summary>
    [Fact]
    public void A_wire_read_inside_its_consumers_is_one_rung_and_reaches_the_importer()
    {
        var pushed = Pushed("VAR_TEMP w1 : ANY; END_VAR", "w1 := xtest AND xtest2;", "xoutput := w1 OR c;", "xoutput2 := w1 AND c;");

        var reached = Assert.Throws<Xunit.Sdk.XunitException>(() => TcNetworkWriter.Apply(Ladder(), pushed, Scope, NeverImported));
        Assert.Contains("importer was reached", reached.Message);
    }

    /// <summary>…and two rungs that share nothing stay ONE network: the builder builds the network the text states. (The
    /// PLCopen importer built one network per connected rung, D25, so this was refused as a split.)</summary>
    [Fact]
    public void Two_rungs_sharing_no_wire_are_rebuilt_as_one_network()
    {
        var pushed = Pushed("xoutput := xtest AND xtest2;", "xoutput2 := xtest OR c;");
        Assert.Equal(StNetworkWriter.Write(pushed, Scope), RebuiltAndPulled(pushed));
    }

    // -- the push half of "EN is a pin, ENO is spelled" -------------------------------------------------------------

    /// <summary>The ladder network as the importer would hand it back, with the box's output list set to
    /// <paramref name="names"/> and its type to <paramref name="type"/> — the imported box's own output list, read as
    /// CODESYS reads it (<see cref="Box.HasEnoSlot"/>).</summary>
    /// <summary>Set a box's "EN/ENO is shown" flag true: a scalar in place of the archive's unset <c>&lt;n n="EN" /&gt;</c>.</summary>
    private static void SetShown(XElement box, string member)
    {
        var at = box.Elements().First(x => (string?)x.Attribute("n") == member);
        at.ReplaceWith(new XElement("v", new XAttribute("n", member), "true"));
    }

    private static Func<Network, NetworkScope, XElement> ImportedAs(string type, params string[] names) => (_, _) =>
    {
        var impl = TcArchive.Root(Ladder())!;
        var net = new XElement(TcArchive.List(impl, "NetworkList")[0]);
        var box = net.Descendants("o").First(o => o.Elements("v").Any(v => (string?)v.Attribute("n") == "BoxType"));
        box.Elements("v").First(v => (string?)v.Attribute("n") == "BoxType").Value = "\"" + type + "\"";
        var list = box.Elements("o").First(o => (string?)o.Attribute("n") == "OutputParam").Elements("l2")
            .First(l => (string?)l.Attribute("n") == "Names");
        foreach (var n in names) list.Add(new XElement("v", n));
        // A box SHOWS its ENO by the stored flag, not by the slot's name (network-text-st 2.2, `Box.ShowsEno`): an import
        // that gives the box an ENO output states it shown.
        if (names.Length > 0 && names[0] == Box.EnoPin) SetShown(box, "ENO");
        return net;
    };

    /// <summary>A consumer reading the box as a VALUE on a box the IDE builds with ENO as its main output states a data
    /// output the box does not have (spec, "ENO is the main output") — refused naming the box, after the import, from
    /// the imported box's output list.</summary>
    [Fact]
    public void A_consumer_without_ENO_on_a_box_the_import_gives_an_ENO_main_output_is_refused_naming_it()
    {
        var ex = Assert.ThrowsAny<NotSupportedException>(() =>
            TcNetworkWriter.Apply(Ladder(), Pushed("xoutput := MOVE(xtest);"), Scope, ImportedAs("MOVE", "ENO", "")));

        Assert.Contains("'MOVE'", ex.Message);
        Assert.Contains("as a value", ex.Message);
    }

    /// <summary>…and ENO read on a box the IDE builds with no ENO output names an output that is not there (B4).</summary>
    [Fact]
    public void ENO_on_a_box_the_import_gives_no_ENO_output_is_refused_naming_it()
    {
        var ex = Assert.ThrowsAny<NotSupportedException>(() =>
            TcNetworkWriter.Apply(Ladder(), Pushed("xoutput := AND(EN := c, xtest, xtest2, OUT => xstore).ENO;"), Scope, ImportedAs("AND")));

        Assert.Contains("'AND'", ex.Message);
        Assert.Contains("through ENO", ex.Message);
        Assert.Contains("no ENO output", ex.Message);
    }

    // -- the edge order (spec, "edges are R_EDGE and F_EDGE flags") --------------------------------------------------

    /// <summary>TWINCAT'S ORDER FOR A NEGATION AND AN EDGE ON ONE NODE IS UNMEASURED (task 1.14: no licensed runtime), so
    /// a pulled body holding one goes to the marker by name — never written in CODESYS's order (<c>R_EDGE(NOT x)</c>,
    /// DIALECT N17), which would state logic nobody measured TwinCAT to run.</summary>
    [Theory]
    [InlineData(TcArchive.FlagRtrig)]
    [InlineData(TcArchive.FlagFtrig)]
    public void A_negation_with_an_edge_on_one_operand_is_the_marker(int edge)
    {
        var impl = TcArchive.Root(Ladder())!;
        var bits = impl.Descendants("o").First(o => o.Elements("v").Any(v => (string?)v.Attribute("n") == "Operand" && v.Value == "\"xtest\""))
            .Elements("o").Single(o => (string?)o.Attribute("n") == "Flags").Elements("v").Single(v => (string?)v.Attribute("n") == "Flags");
        bits.Value = (TcArchive.FlagNegation | edge).ToString();

        var ex = Assert.Throws<UnrepresentableBodyException>(() => TcNetworkReader.Read(impl, BodyLanguage.Ld));
        Assert.Equal("a negation with an edge", ex.Reason);
        Assert.Contains("xtest", ex.Message);
    }

    /// <summary>…and on a BOX: a box carries its own Flags (the OR in <c>ladder.TcPOU</c>), the order is as unmeasured
    /// there, and the marker names the box.</summary>
    [Theory]
    [InlineData(TcArchive.FlagRtrig)]
    [InlineData(TcArchive.FlagFtrig)]
    public void A_negation_with_an_edge_on_one_box_is_the_marker(int edge)
    {
        var impl = TcArchive.Root(Ladder())!;
        var box = impl.Descendants("o").Single(o => (string?)o.Attribute("t") == "BoxTreeBox");
        box.Elements("o").Single(o => (string?)o.Attribute("n") == "Flags").Elements("v")
            .Single(v => (string?)v.Attribute("n") == "Flags").Value = (TcArchive.FlagNegation | edge).ToString();

        var ex = Assert.Throws<UnrepresentableBodyException>(() => TcNetworkReader.Read(impl, BodyLanguage.Ld));
        Assert.Equal("a negation with an edge", ex.Reason);
        Assert.Contains("the 'OR' box", ex.Message);
    }

    /// <summary>…and a push that spells one is refused by the same name before anything is written.</summary>
    [Fact]
    public void A_negation_with_an_edge_is_refused_on_push()
    {
        var ex = Assert.Throws<UnsupportedException>(() =>
            TcNetworkWriter.Apply(Ladder(), Pushed("xoutput := R_EDGE(NOT xtest) OR xtest2;"), Scope, NeverImported));
        Assert.Contains("a negation with an edge", ex.Message);
        Assert.Contains("xtest", ex.Message);
    }

    /// <summary>A single edge, and a single negation, are measured on their own (N17's controls) and read as before.</summary>
    [Fact]
    public void A_lone_edge_or_negation_reads_as_before()
    {
        var impl = TcArchive.Root(Ladder())!;
        var bits = impl.Descendants("o").First(o => o.Elements("v").Any(v => (string?)v.Attribute("n") == "Operand" && v.Value == "\"xtest\""))
            .Elements("o").Single(o => (string?)o.Attribute("n") == "Flags").Elements("v").Single(v => (string?)v.Attribute("n") == "Flags");
        bits.Value = TcArchive.FlagRtrig.ToString();

        var box = Assert.IsType<Box>(Assert.IsType<Assign>(TcNetworkReader.Read(impl, BodyLanguage.Ld).Networks[0].Trees[0]).Value);
        Assert.True(((Leaf)box.Inputs[0].Value).Flags.Rising);
    }

    private static NetworkBody Rename(NetworkBody b, string from, string to) =>
        b with { Networks = b.Networks.Select(n => n with { Trees = n.Trees.Select(t => Rename(t, from, to)).ToList() }).ToList() };

    private static Node Rename(Node n, string from, string to) => n switch
    {
        Leaf l when l.Operand.Text == from => l with { Operand = l.Operand with { Text = to } },
        Assign a => a with { Value = Rename(a.Value, from, to) },
        Volt.Engine.Format.Network.Parallel p => p with
        {
            Input = p.Input is null ? null : Rename(p.Input, from, to),
            Branches = p.Branches.Select(x => Rename(x, from, to)).ToList(),
        },
        _ => n,
    };
}
