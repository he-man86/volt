using System.IO;
using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Graphical;
using Volt.Engine.Workspace;
using Xunit;
using Volt.Engine.PlcOpen;

namespace Volt.Cli.Tests;

/// <summary>
/// The WRITE splice (`pou-writes-via-plcopen` §2): editing an item's existing export instead of generating a
/// document.
/// <para>Every case runs against a RECORDED vendor export, not synthetic XML — so the shapes under test are
/// CODESYS's and TwinCAT's, not ones I invented to match my own code. That distinction has mattered repeatedly:
/// the hand-built interface document in the CODESYS driver matched no real export, and the parser's
/// "TC-only" fallback turned out to be what CODESYS emits too.</para>
/// </summary>
public class PouSpliceTests
{
    private static string Fixture(params string[] parts) =>
        File.ReadAllText(Path.Combine(new[] { System.AppContext.BaseDirectory, "fixtures" }.Concat(parts).ToArray()));

    private static string CodesysPou => Fixture("corpus", "PLC_PRG.st.plcopen.xml");   // ST body + plaintext decl
    private static string TwincatPou => Fixture("tc-fbd", "PLC_PRG_jump_sr.plcopen.xml"); // FBD body + an action

    // ── 2.5, first: the property everything else depends on ─────────────────────────────────────────

    /// <summary>A splice that changes NOTHING must return the document unchanged. This is the guard on the whole
    /// approach: the justification for editing the export rather than regenerating it is that attributes,
    /// pragmas, object ids and vendor addData survive — which only holds if the splice leaves untouched bytes
    /// untouched.</summary>
    [Theory]
    [InlineData("corpus", "PLC_PRG.st.plcopen.xml", "PLC_PRG")]
    [InlineData("corpus", "MAIN.plcopen.xml", "MAIN")]
    public void A_no_op_declaration_write_changes_nothing(string dir, string file, string item)
    {
        var xml = Fixture(dir, file);
        var same = PouSplice.SetDeclaration(xml, item, PlcOpenDocument.DeclFromExport(xml, item)!);
        Assert.Equal(Canon(xml), Canon(same));
    }

    [Fact]
    public void A_no_op_body_write_changes_nothing()
    {
        var xml = CodesysPou;
        var body = PouReader.Parse(xml).BodyElement!.Value;
        Assert.Equal(Canon(xml), Canon(PouSplice.SetTextualBody(xml, "PLC_PRG", body)));
    }

    // ── 2.1 declaration ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void The_declaration_can_be_written_and_read_back()
    {
        const string decl = "PROGRAM PLC_PRG\nVAR\n\tspliced : INT := 7;\nEND_VAR";
        var outXml = PouSplice.SetDeclaration(CodesysPou, "PLC_PRG", decl);
        Assert.Equal(decl, PlcOpenDocument.DeclFromExport(outXml, "PLC_PRG"));
        Assert.Equal(decl, PouReader.Parse(outXml).Declaration);   // and through the production reader
    }

    /// <summary>The TwinCAT export carries a plaintext block too — the claim that it "carries no plaintext
    /// interface at all" was false, and this is what lets one splice serve both vendors.</summary>
    [Fact]
    public void The_declaration_write_works_on_a_twincat_export_too()
    {
        const string decl = "PROGRAM PLC_PRG\nVAR\n\tfromTwincat : BOOL;\nEND_VAR";
        var outXml = PouSplice.SetDeclaration(TwincatPou, "PLC_PRG", decl);
        Assert.Equal(decl, PlcOpenDocument.DeclFromExport(outXml, "PLC_PRG"));
    }

    /// <summary>Writing a declaration to an item that is not in the document must THROW. A write that silently
    /// hits nothing is the exact failure mode this change exists to remove.</summary>
    [Fact]
    public void Writing_a_declaration_for_an_absent_item_throws()
    {
        var ex = Assert.Throws<System.InvalidOperationException>(
            () => PouSplice.SetDeclaration(CodesysPou, "NoSuchPou", "PROGRAM X\nVAR\nEND_VAR"));
        Assert.Contains("NoSuchPou", ex.Message);
    }

    // ── 2.2 textual body ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void The_textual_body_can_be_written_and_read_back()
    {
        const string body = "x := 42;\nIF x > 0 THEN\n\tx := 0;\nEND_IF";
        var outXml = PouSplice.SetTextualBody(CodesysPou, "PLC_PRG", body);
        Assert.Equal(body, PouReader.Parse(outXml).BodyElement!.Value);
        Assert.Equal("ST", PouReader.Parse(outXml).BodyLanguage);
    }

    /// <summary>The declaration must survive a body write and vice versa — they are separate splices into the
    /// same document, and a push does both.</summary>
    [Fact]
    public void Writing_the_body_leaves_the_declaration_alone_and_vice_versa()
    {
        var decl = PlcOpenDocument.DeclFromExport(CodesysPou, "PLC_PRG")!;
        var afterBody = PouSplice.SetTextualBody(CodesysPou, "PLC_PRG", "y := 1;");
        Assert.Equal(decl, PlcOpenDocument.DeclFromExport(afterBody, "PLC_PRG"));

        var afterBoth = PouSplice.SetDeclaration(afterBody, "PLC_PRG", "PROGRAM PLC_PRG\nVAR\n\ty : INT;\nEND_VAR");
        Assert.Equal("y := 1;", PouReader.Parse(afterBoth).BodyElement!.Value);
    }

    /// <summary>A textual write onto a GRAPHICAL body must refuse. Flattening one is the data-loss bug the live
    /// body-format guard already refuses; the splice must not become a second way to do it.</summary>
    [Fact]
    public void A_textual_body_write_refuses_to_flatten_a_graphical_body()
    {
        var ex = Assert.Throws<System.InvalidOperationException>(
            () => PouSplice.SetTextualBody(TwincatPou, "ACT_FBD", "x := 1;"));
        Assert.Contains("FBD", ex.Message);
        Assert.Contains("replace", ex.Message);   // wording covers IL too, where "flatten" would be wrong
    }

    // ── scoping: the bug class that produced three data-loss defects ────────────────────────────────

    /// <summary>A write names an ITEM, and the export describes several. Writing the enclosing POU must not
    /// touch its action, and writing the action must not touch the POU.</summary>
    [Fact]
    public void A_write_is_scoped_to_the_named_item_not_the_first_match()
    {
        // The TwinCAT fixture is a POU whose graphical body belongs to its ACTION; the POU's own body is ST.
        var beforeAction = GraphicalBodySplice.FindFbdLdBody(TwincatPou, "ACT_FBD")!.ToString();

        var outXml = PouSplice.SetTextualBody(TwincatPou, "PLC_PRG", "poubody := 1;");

        Assert.Equal("poubody := 1;", PouReader.Parse(outXml).BodyElement!.Value);      // the POU took it
        Assert.Equal(beforeAction, GraphicalBodySplice.FindFbdLdBody(outXml, "ACT_FBD")!.ToString()); // action untouched
    }

    // ── 2.3 child members ───────────────────────────────────────────────────────────────────────────

    /// <summary>`BoxFB` — a real CODESYS POU: 5 methods and 3 properties, each with BOTH accessors. Captured
    /// because nothing in `fixtures/` had a POU-with-properties: the survey that looked for one kept matching
    /// the contentHeader's PROJECT INFORMATION (`&lt;property name="Author"&gt;` …), which is in every export
    /// and is not a POU child at all.</summary>
    private static string BoxFb => Fixture("codesys-pou", "BoxFB.plcopen.xml");

    [Fact]
    public void A_child_method_body_and_declaration_can_be_written()
    {
        const string decl = "METHOD Cyclic : BOOL\nVAR_INPUT\n\tspliced : INT;\nEND_VAR";
        const string body = "Cyclic := TRUE;";
        var outXml = PouSplice.SetChildText(BoxFb, "BoxFB", "Cyclic", decl, body);

        var cyclic = PouReader.Parse(outXml).Children.Single(c => c.Name == "Cyclic");
        Assert.Equal(decl, cyclic.Declaration);
        Assert.Equal(body, cyclic.BodyElement!.Value);
    }

    /// <summary>Writing one child must not disturb its siblings — the whole point of scoping, and the shape of
    /// the bug that spliced a body over a sibling method.</summary>
    [Fact]
    public void Writing_one_child_leaves_the_others_and_the_parent_alone()
    {
        var before = PouReader.Parse(BoxFb);
        var outXml = PouSplice.SetChildText(BoxFb, "BoxFB", "AddItem", null, "touched := 1;");
        var after = PouReader.Parse(outXml);

        Assert.Equal("touched := 1;", after.Children.Single(c => c.Name == "AddItem").BodyElement!.Value);
        Assert.Equal(before.Declaration, after.Declaration);                       // parent decl untouched
        Assert.Equal(before.BodyElement!.Value, after.BodyElement!.Value);         // parent body untouched
        foreach (var sibling in before.Children.Where(c => c.Name != "AddItem"))
            Assert.Equal(sibling.Declaration,
                         after.Children.Single(c => c.Name == sibling.Name).Declaration);
        Assert.Equal(before.Properties.Count, after.Properties.Count);             // properties survived
    }

    /// <summary>A null argument means "leave it" — distinct from "" which clears. A push that edits only a body
    /// must not blank the declaration.</summary>
    [Fact]
    public void A_null_argument_leaves_that_part_untouched()
    {
        var declBefore = PouReader.Parse(BoxFb).Children.Single(c => c.Name == "Cyclic").Declaration;
        var outXml = PouSplice.SetChildText(BoxFb, "BoxFB", "Cyclic", null, "x := 1;");
        Assert.Equal(declBefore, PouReader.Parse(outXml).Children.Single(c => c.Name == "Cyclic").Declaration);
    }

    [Fact]
    public void A_child_can_be_removed_and_the_rest_survive()
    {
        var before = PouReader.Parse(BoxFb);
        var outXml = PouSplice.RemoveChild(BoxFb, "BoxFB", "AddItem");
        var after = PouReader.Parse(outXml);

        Assert.DoesNotContain(after.Children, c => c.Name == "AddItem");
        Assert.Equal(before.Children.Count - 1, after.Children.Count);
        Assert.Equal(before.Properties.Count, after.Properties.Count);   // removing a method keeps properties
        Assert.Equal(before.Declaration, after.Declaration);
    }

    [Fact]
    public void A_property_can_be_removed_with_its_accessors()
    {
        var before = PouReader.Parse(BoxFb);
        Assert.Contains(before.Properties, p => p.Name == "State");

        var after = PouReader.Parse(PouSplice.RemoveChild(BoxFb, "BoxFB", "State"));
        Assert.DoesNotContain(after.Properties, p => p.Name == "State");
        Assert.Equal(before.Properties.Count - 1, after.Properties.Count);
        Assert.Equal(before.Children.Count, after.Children.Count);       // removing a property keeps methods
    }

    /// <summary>Both operations refuse an absent child. A push asking to update or delete something that is not
    /// there is a disagreement about state, not a no-op to swallow.</summary>
    [Fact]
    public void Operating_on_an_absent_child_throws()
    {
        Assert.Contains("NoSuchChild", Assert.Throws<System.InvalidOperationException>(
            () => PouSplice.RemoveChild(BoxFb, "BoxFB", "NoSuchChild")).Message);
        Assert.Contains("NoSuchChild", Assert.Throws<System.InvalidOperationException>(
            () => PouSplice.SetChildText(BoxFb, "BoxFB", "NoSuchChild", "METHOD X", "y := 1;")).Message);
    }

    /// <summary>A no-op child write must not move bytes either — the same identity property as 2.5.</summary>
    [Fact]
    public void A_no_op_child_write_changes_nothing()
    {
        var cyclic = PouReader.Parse(BoxFb).Children.Single(c => c.Name == "Cyclic");
        var same = PouSplice.SetChildText(
            BoxFb, "BoxFB", "Cyclic", cyclic.Declaration, cyclic.BodyElement!.Value);
        Assert.Equal(Canon(BoxFb), Canon(same));
    }

    /// <summary>The TwinCAT ACTION lives in `&lt;actions&gt;`, not in an `&lt;addData&gt;/&lt;data&gt;` wrapper —
    /// a different container, so removal must find the right element to take out.</summary>
    [Fact]
    public void An_action_in_its_own_container_can_be_removed()
    {
        var outXml = PouSplice.RemoveChild(TwincatPou, "PLC_PRG", "ACT_FBD");
        Assert.DoesNotContain(PouReader.Parse(outXml).Children, c => c.Name == "ACT_FBD");
        Assert.Contains("PLC_PRG", PouReader.Parse(outXml).Declaration!);   // the POU itself survived
    }

    // ── the two-vendor MATRIX ───────────────────────────────────────────────────────────────────────
    // Every assertion below is vendor-NEUTRAL, so it runs over BOTH vendors' recorded exports. Until
    // `tc-pou/FB_TcMembers.plcopen.xml` was recorded there was no TwinCAT fixture containing a method, a property
    // or an accessor anywhere in the repo — so `AddChild`, `SetAccessor` and property-add were certified against
    // ONE vendor's shape and assumed to fit the other. That assumption held (the shapes are identical, see
    // PlcOpen/DIALECT.md D5) but nothing was checking it. Now a divergence fails a test instead of a live push.
    public static TheoryData<string, string, string> PousWithMembers => new()
    {
        { "codesys-pou", "BoxFB.plcopen.xml",        "BoxFB" },
        { "tc-pou",      "FB_TcMembers.plcopen.xml", "FB_TcMembers" },
    };

    [Theory]
    [MemberData(nameof(PousWithMembers))]
    public void Matrix_a_new_method_is_added_and_reads_back(string dir, string file, string item)
    {
        const string decl = "METHOD Added : INT\nVAR_INPUT\n\tn : INT;\nEND_VAR";
        const string body = "Added := n * 2;";
        var outXml = PouSplice.AddChild(Fixture(dir, file), item, "Added", PouMember.Method, decl, body);

        var added = PouReader.Parse(outXml).Children.Single(c => c.Name == "Added");
        Assert.Equal(decl, added.Declaration);
        Assert.Equal(body, added.BodyElement!.Value);
    }

    [Theory]
    [MemberData(nameof(PousWithMembers))]
    public void Matrix_adding_a_member_leaves_the_existing_ones_intact(string dir, string file, string item)
    {
        var xml = Fixture(dir, file);
        var before = PouReader.Parse(xml);
        Assert.True(before.Children.Count + before.Properties.Count > 0, "fixture has no members — it proves nothing");

        var after = PouReader.Parse(PouSplice.AddChild(xml, item, "Added", PouMember.Method, "METHOD Added", "x := 1;"));
        Assert.Equal(before.Children.Count + 1, after.Children.Count);
        Assert.Equal(before.Properties.Count, after.Properties.Count);
        Assert.Equal(before.Declaration, after.Declaration);
    }

    [Theory]
    [MemberData(nameof(PousWithMembers))]
    public void Matrix_a_new_property_gets_both_accessor_slots(string dir, string file, string item)
    {
        var outXml = PouSplice.AddChild(Fixture(dir, file), item, "Added", PouMember.Property, "PROPERTY Added : INT", null);
        var added = PouReader.Parse(outXml).Properties.Single(p => p.Name == "Added");
        Assert.NotNull(added.GetterCode);
        Assert.NotNull(added.SetterCode);
    }

    /// <summary>An accessor write reaches the right one on both vendors — which matters because they order them
    /// DIFFERENTLY: CODESYS emits Set then Get, TwinCAT Get then Set (DIALECT.md D6). Anything that picked "the
    /// first accessor" instead of the named one would pass on one vendor and silently write the wrong accessor on
    /// the other.</summary>
    [Theory]
    [MemberData(nameof(PousWithMembers))]
    public void Matrix_an_accessor_write_hits_the_named_accessor(string dir, string file, string item)
    {
        var xml = Fixture(dir, file);
        var prop = PouReader.Parse(xml).Properties.First();

        var written = PouSplice.SetAccessor(xml, item, prop.Name, getter: true, code: "GET_MARKER;", declaration: null);
        var after = PouReader.Parse(written).Properties.Single(p => p.Name == prop.Name);

        Assert.Equal("GET_MARKER;", after.GetterCode);
        Assert.Equal(prop.SetterCode, after.SetterCode);   // the sibling accessor is untouched
    }

    // ── §3: adding a child that is not there yet ────────────────────────────────────────────────────

    [Fact]
    public void A_new_method_can_be_added_and_reads_back()
    {
        const string decl = "METHOD Added : INT\nVAR_INPUT\n\tn : INT;\nEND_VAR";
        const string body = "Added := n * 2;";
        var outXml = PouSplice.AddChild(BoxFb, "BoxFB", "Added", PouMember.Method, decl, body);

        var added = PouReader.Parse(outXml).Children.Single(c => c.Name == "Added");
        Assert.Equal("method", added.PouType);
        Assert.Equal(decl, added.Declaration);
        Assert.Equal(body, added.BodyElement!.Value);
    }

    [Fact]
    public void Adding_a_method_leaves_the_existing_members_intact()
    {
        var before = PouReader.Parse(BoxFb);
        var after = PouReader.Parse(
            PouSplice.AddChild(BoxFb, "BoxFB", "Added", PouMember.Method, "METHOD Added", "x := 1;"));

        Assert.Equal(before.Children.Count + 1, after.Children.Count);
        Assert.Equal(before.Properties.Count, after.Properties.Count);
        Assert.Equal(before.Declaration, after.Declaration);
        foreach (var c in before.Children)
            Assert.Equal(c.Declaration, after.Children.Single(x => x.Name == c.Name).Declaration);
    }

    /// <summary>An action is body-only — its "ACTION name" line is synthesized on read, never persisted — so a
    /// declaration must be REFUSED rather than written somewhere that will never be read back.</summary>
    [Fact]
    public void A_new_action_is_body_only()
    {
        var outXml = PouSplice.AddChild(BoxFb, "BoxFB", "Act1", PouMember.Action, null, "y := 2;");
        var act = PouReader.Parse(outXml).Children.Single(c => c.Name == "Act1");
        Assert.Equal("action", act.PouType);
        Assert.Equal("y := 2;", act.BodyElement!.Value);

        var ex = Assert.Throws<System.InvalidOperationException>(
            () => PouSplice.AddChild(BoxFb, "BoxFB", "Act2", PouMember.Action, "ACTION Act2", "y := 2;"));
        Assert.Contains("body-only", ex.Message);
    }

    /// <summary>Adding into a POU that has no `&lt;actions&gt;` container yet must create one — BoxFB has methods
    /// and properties but no actions, so this is the from-nothing case.</summary>
    [Fact]
    public void An_action_container_is_created_when_the_pou_has_none()
    {
        Assert.DoesNotContain("<actions", BoxFb);
        var outXml = PouSplice.AddChild(BoxFb, "BoxFB", "First", PouMember.Action, null, "z := 3;");
        Assert.Contains(PouReader.Parse(outXml).Children, c => c.Name == "First" && c.PouType == "action");
    }

    /// <summary>Add and update are different intents. Adding over an existing child must refuse rather than
    /// silently updating it — the caller knows which it meant, and this layer must not guess.</summary>
    [Fact]
    public void Adding_a_child_that_already_exists_throws()
    {
        var ex = Assert.Throws<System.InvalidOperationException>(
            () => PouSplice.AddChild(BoxFb, "BoxFB", "Cyclic", PouMember.Method, "METHOD Cyclic", "x := 1;"));
        Assert.Contains("already has a child", ex.Message);
        Assert.Contains("SetChildText", ex.Message);   // and says what to use instead
    }

    /// <summary>An add followed by a remove returns the document to where it started.</summary>
    [Fact]
    public void Add_then_remove_round_trips()
    {
        var added = PouSplice.AddChild(BoxFb, "BoxFB", "Temp", PouMember.Method, "METHOD Temp", "q := 1;");
        var removed = PouSplice.RemoveChild(added, "BoxFB", "Temp");
        var back = PouReader.Parse(removed);
        var start = PouReader.Parse(BoxFb);
        Assert.Equal(start.Children.Count, back.Children.Count);
        Assert.Equal(start.Properties.Count, back.Properties.Count);
        Assert.DoesNotContain(back.Children, c => c.Name == "Temp");
    }

    // ── properties and their accessors ──────────────────────────────────────────────────────────────

    /// <summary>A property's CODE lives in its accessors, so writing one is how a push edits a property.</summary>
    [Fact]
    public void An_accessor_body_and_declaration_can_be_written()
    {
        var outXml = PouSplice.SetAccessor(BoxFb, "BoxFB", "State", getter: true,
            code: "State := _state;", declaration: "VAR\n\tlocal : INT;\nEND_VAR");
        var state = PouReader.Parse(outXml).Properties.Single(p => p.Name == "State");
        Assert.Equal("State := _state;", state.GetterCode);
        Assert.Contains("local : INT", state.GetterDeclaration!);
        Assert.NotNull(state.SetterCode);   // the setter is untouched
    }

    /// <summary>A null code REMOVES the accessor — that is how a push drops a getter, and why the reader keeps
    /// absent (null) distinct from present-but-bodiless (""). Collapsing them would delete a user's getter.</summary>
    [Fact]
    public void A_null_accessor_removes_it_and_leaves_the_other()
    {
        var before = PouReader.Parse(BoxFb).Properties.Single(p => p.Name == "State");
        Assert.NotNull(before.GetterCode);
        Assert.NotNull(before.SetterCode);

        var after = PouReader.Parse(
            PouSplice.SetAccessor(BoxFb, "BoxFB", "State", getter: true, code: null, declaration: null))
            .Properties.Single(p => p.Name == "State");

        Assert.Null(after.GetterCode);                       // getter gone
        Assert.Equal(before.SetterCode, after.SetterCode);   // setter intact
    }

    [Fact]
    public void Removing_an_already_absent_accessor_moves_no_bytes()
    {
        var once = PouSplice.SetAccessor(BoxFb, "BoxFB", "State", getter: true, code: null, declaration: null);
        var twice = PouSplice.SetAccessor(once, "BoxFB", "State", getter: true, code: null, declaration: null);
        Assert.Equal(once, twice);
    }

    [Fact]
    public void Writing_one_accessor_leaves_the_other_properties_alone()
    {
        var before = PouReader.Parse(BoxFb).Properties;
        var after = PouReader.Parse(
            PouSplice.SetAccessor(BoxFb, "BoxFB", "State", getter: false, code: "_state := State;", declaration: null))
            .Properties;
        foreach (var p in before.Where(p => p.Name != "State"))
        {
            var a = after.Single(x => x.Name == p.Name);
            Assert.Equal(p.GetterCode, a.GetterCode);
            Assert.Equal(p.SetterCode, a.SetterCode);
        }
    }

    /// <summary>A new property is created with BOTH accessor slots, because a property with neither is not a
    /// property; the caller then writes the ones it wants and nulls the ones it does not.
    /// <para>NOTE: this asserts the WRITER matches the READER — it cannot prove the IDE accepts the shape. In
    /// particular the vendors' own properties carry <c>&lt;interface&gt;&lt;returnType&gt;</c>, which this does
    /// not emit (the type is in the plaintext declaration; deriving the typed element from ST needs the
    /// elementary-vs-derived table this change exists to avoid). The live import is what settles it — §4.</para></summary>
    [Fact]
    public void A_new_property_is_added_with_both_accessor_slots()
    {
        var outXml = PouSplice.AddChild(BoxFb, "BoxFB", "Added", PouMember.Property,
            "PROPERTY Added : INT", null);
        var added = PouReader.Parse(outXml).Properties.Single(p => p.Name == "Added");
        Assert.NotNull(added.GetterCode);
        Assert.NotNull(added.SetterCode);
        Assert.Equal("PROPERTY Added : INT", added.Declaration);

        var withCode = PouSplice.SetAccessor(outXml, "BoxFB", "Added", getter: true, code: "Added := 1;", declaration: null);
        Assert.Equal("Added := 1;",
            PouReader.Parse(withCode).Properties.Single(p => p.Name == "Added").GetterCode);
    }

    // ── zero-fallback audit ─────────────────────────────────────────────────────────────────────────

    /// <summary>Reading a declaration for an item that is NOT in the document answers null — never some other
    /// item's. An earlier version fell back to the whole document (`owner ?? doc.Root`), so an unknown name
    /// returned the first plaintext block anywhere in it: confidently, and wrong. Same document-scoping mistake
    /// that once spliced a body over a sibling method.</summary>
    [Fact]
    public void Reading_a_declaration_for_an_absent_item_is_null_not_someone_elses()
    {
        Assert.NotNull(PlcOpenDocument.DeclFromExport(BoxFb, "BoxFB"));          // the real one is readable
        Assert.Null(PlcOpenDocument.DeclFromExport(BoxFb, "NoSuchItem"));        // ...and an absent one is null
        Assert.Null(PlcOpenDocument.DeclFromExport(BoxFb, "Cyclic"));            // a CHILD is not an item either
    }

    /// <summary>A textual write refuses ANY non-ST body language, not just the graphical ones. IL is textual, so
    /// a graphical-only guard let it through and the rewrite silently changed the body's language.</summary>
    [Theory]
    [InlineData("IL")]
    [InlineData("FBD")]
    [InlineData("CFC")]
    public void A_textual_write_refuses_every_other_body_language(string lang)
    {
        var xml = $"<pou xmlns=\"{Ns}\" name=\"P\"><body><{lang}/></body></pou>";
        var ex = Assert.Throws<System.InvalidOperationException>(
            () => PouSplice.SetTextualBody(xml, "P", "x := 1;"));
        Assert.Contains(lang, ex.Message);
    }

    private const string Ns = "http://www.plcopen.org/xml/tc6_0200";

    /// <summary>Normalise only what a serializer may legitimately move: line endings and inter-element
    /// whitespace. Anything else differing is a real change.</summary>
    private static string Canon(string xml) =>
        XDocument.Parse(xml).ToString(SaveOptions.DisableFormatting).Replace("\r\n", "\n");
}
