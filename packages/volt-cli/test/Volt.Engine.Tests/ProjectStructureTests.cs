using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Xml.Linq;
using Xunit;
using Volt.Engine.Document;
using Volt.Engine.Model;
using Volt.Engine.Vocabulary;
using Volt.Engine.Item;

namespace Volt.Cli.Tests;

/// <summary>
/// The document's <c>…/projectstructure</c> block, maintained by the splice.
/// <para>Every case runs against a RECORDED TwinCAT export (`tc-pou/FB_TcMembers.plcopen.xml` — a real FB with a
/// method and a get/set property), because the shape under test is the vendor's, not one written to match this
/// code. TwinCAT's importer creates a POU child ONLY if this block declares it (DIALECT D4h), so a splice that
/// edits members and leaves the block stale drops every one of them in silence — with the push reporting
/// success.</para>
/// <para>The invariant these pin: <b>after any splice, the block lists exactly the members the document carries,
/// each with the same ObjectId as its own element.</b> Id equality is the half that is easy to lose and
/// impossible to see — a block entry whose id does not match its member element is ignored just as completely as
/// no entry at all.</para>
/// </summary>
public class ProjectStructureTests
{
    private static string Fixture(string file) =>
        File.ReadAllText(Path.Combine(System.AppContext.BaseDirectory, "fixtures", "tc-pou", file));

    private const string Name = "FB_TcMembers";
    private const string Decl = "FUNCTION_BLOCK FB_TcMembers\nVAR_INPUT\nEND_VAR\nVAR_OUTPUT\nEND_VAR\nVAR\nEND_VAR";

    private static Member Method(string name, string? folder = null) =>
        new(ItemKind.Kinds.Method, name, $"METHOD {name} : BOOL\nVAR_INPUT\n\ta : INT;\nEND_VAR", "", Folder: folder);
    private static Member Action(string name, string? folder = null) =>
        new(ItemKind.Kinds.Action, name, "", "//act", Folder: folder);
    private static Member Property(string name, string? folder = null) =>
        new(ItemKind.Kinds.Property, name, $"PROPERTY {name} : INT\n", null, Folder: folder,
            Getter: new Accessor("PUBLIC\nVAR\nEND_VAR", ""), Setter: new Accessor("PUBLIC\nVAR\nEND_VAR", ""));

    private static ItemContent Split(params Member[] members) =>
        new(ItemKind.Kinds.FunctionBlock, Decl, "", members.ToList());

    /// <summary>The block's entry for the item, as (name, objectId) pairs, flattened with each member's
    /// folder path — so a test can state placement and identity in one assertion.</summary>
    private static List<(string Path, string Id)> Structure(string xml)
    {
        var entry = XDocument.Parse(xml).Descendants()
            .First(e => e.Name.LocalName == "Object" && (string?)e.Attribute("Name") == Name);
        var found = new List<(string, string)>();
        void Walk(XElement node, string prefix)
        {
            foreach (var child in node.Elements())
            {
                var childName = (string?)child.Attribute("Name") ?? "";
                if (child.Name.LocalName == "Folder") Walk(child, prefix + childName + "/");
                else found.Add((prefix + childName, (string?)child.Attribute("ObjectId") ?? ""));
            }
        }
        Walk(entry, "");
        return found;
    }

    /// <summary>Every id the block names must be the id its own member element carries. This is the assertion the
    /// live probe reduced to: same name is not enough, the ids have to agree.</summary>
    private static void AssertIdsMatchElements(string xml)
    {
        var doc = XDocument.Parse(xml);
        foreach (var (path, id) in Structure(xml))
        {
            var name = path.Split('/').Last();
            var element = doc.Descendants().First(e =>
                e.Name.LocalName is "Method" or "Property" or "action"
                && (string?)e.Attribute("name") == name);
            var elementId = (string?)element.Attribute("ObjectId")
                ?? element.Descendants().FirstOrDefault(e => e.Name.LocalName == "ObjectId")?.Value;
            Assert.Equal(id, elementId);
        }
    }

    // ── the bug this exists for ────────────────────────────────────────────────────────────────────

    /// <summary>A member the splice ADDS is declared in the block, with an id, matching its element. Without this
    /// the member element exists and TwinCAT's importer ignores it — `childCount=0`, push accepted.</summary>
    [Fact]
    public void An_added_member_is_declared_in_the_structure_block()
    {
        var doc = PouDocument.Splice(Fixture("FB_TcMembers.plcopen.xml"), Name,
            Split(Method("Compute"), Property("Speed"), Method("Added")), establishing: false);

        Assert.Equal(new[] { "Compute", "Speed", "Added" }, Structure(doc).Select(s => s.Path));
        Assert.All(Structure(doc), s => Assert.NotEqual("", s.Id));
        AssertIdsMatchElements(doc);
    }

    /// <summary>A member the splice REMOVES is gone from the block too. A stale entry names an element that no
    /// longer exists, which is the same disagreement pointing the other way.</summary>
    [Fact]
    public void A_removed_member_is_dropped_from_the_structure_block()
    {
        var doc = PouDocument.Splice(Fixture("FB_TcMembers.plcopen.xml"), Name, Split(Method("Compute")), establishing: false);

        Assert.Equal(new[] { "Compute" }, Structure(doc).Select(s => s.Path));
        AssertIdsMatchElements(doc);
    }

    /// <summary>An existing member keeps the id the IDE gave it — the splice must not re-mint one. A changed id
    /// is a different object as far as the importer is concerned.</summary>
    [Fact]
    public void An_existing_members_object_id_is_preserved()
    {
        var doc = PouDocument.Splice(Fixture("FB_TcMembers.plcopen.xml"), Name,
            Split(Method("Compute"), Property("Speed")), establishing: false);

        Assert.Equal("a289132b-77b6-4c83-9d0c-2dc76c0986f6", Structure(doc).Single(s => s.Path == "Compute").Id);
        Assert.Equal("43abeeed-802d-4ae5-96cb-1c2a2b1c0b41", Structure(doc).Single(s => s.Path == "Speed").Id);
    }

    // ── placement is NOT the document's job ────────────────────────────────────────────────────────

    /// <summary>A member's POU-INTERNAL folder does NOT travel in the block: members are listed FLAT even when the
    /// push places them in a folder.
    /// <para>This is measured, and it is the opposite of what TwinCAT's own EXPORT suggests. Its export nests a
    /// foldered member as <c>&lt;Folder Name="Sub"&gt;&lt;Object …/&gt;&lt;/Folder&gt;</c>, so writing that back
    /// looks obviously right — and a member inside a <c>&lt;Folder&gt;</c> is DROPPED by the import entirely, with
    /// the folder flag on, with it off, and with an id on the folder element (DIALECT D4i). CODESYS discards the
    /// whole block, so the nesting is honoured by NEITHER vendor while costing the member on one. Placement is the
    /// scripting API's job (`PushService.RestoreChildFolders`), which is where ARCHITECTURE puts it.</para></summary>
    [Fact]
    public void A_members_folder_does_not_travel_in_the_structure_block()
    {
        var doc = PouDocument.Splice(Fixture("FB_TcMembers.plcopen.xml"), Name,
            Split(Method("Compute", folder: "Sub"), Method("Other", folder: "A/B")), establishing: false);

        Assert.Equal(new[] { "Compute", "Other" }, Structure(doc).Select(s => s.Path));
        Assert.DoesNotContain(XDocument.Parse(doc).Descendants(), e => e.Name.LocalName == "Folder");
    }

    // ── shape, per member kind ─────────────────────────────────────────────────────────────────────

    /// <summary>An ACTION carries its id in a nested <c>&lt;addData&gt;&lt;data name="…/objectid"&gt;</c>, not as
    /// an attribute — TwinCAT's own export shape. An attribute there would be a shape no vendor emits, and this
    /// is the one member kind where the two differ.</summary>
    [Fact]
    public void An_actions_object_id_goes_in_nested_addData_not_an_attribute()
    {
        var doc = PouDocument.Splice(Fixture("FB_TcMembers.plcopen.xml"), Name, Split(Action("Act")), establishing: false);

        var action = XDocument.Parse(doc).Descendants().Single(e => e.Name.LocalName == "action");
        Assert.Null(action.Attribute("ObjectId"));
        var nested = action.Descendants().Single(e => e.Name.LocalName == "ObjectId").Value;
        Assert.Equal(nested, Structure(doc).Single(s => s.Path == "Act").Id);
    }

    // ── the property that makes splicing safe ──────────────────────────────────────────────────────

    /// <summary>A splice that changes NOTHING returns the original bytes. Maintaining the block must not cost the
    /// identity property every no-op push depends on — so this restates the fixture's OWN content exactly, member
    /// declarations, accessor bodies and all, and asks for it back.</summary>
    [Fact]
    public void A_no_op_splice_leaves_the_document_byte_identical()
    {
        var original = Fixture("FB_TcMembers.plcopen.xml");
        var compute = new Member(ItemKind.Kinds.Method, "Compute",
            "METHOD Compute : BOOL\nVAR_INPUT\n\ta : INT;\nEND_VAR\n", "Compute := a > 0;");
        var speed = new Member(ItemKind.Kinds.Property, "Speed", "PROPERTY Speed : INT\n", null,
            Getter: new Accessor("PUBLIC\nVAR\nEND_VAR", "Speed := 42;"),
            Setter: new Accessor("PUBLIC\nVAR\nEND_VAR", "nSpeed := Speed;"));

        var doc = PouDocument.Splice(original, Name,
            new ItemContent(ItemKind.Kinds.FunctionBlock, Decl, "", new List<Member> { compute, speed }), establishing: false);

        Assert.Equal(original, doc);
    }

    /// <summary>A document with NO structure block is left alone. CODESYS's default export has none, and Volt is
    /// in no position to invent one — it would have to name ids for items it cannot see in this document.</summary>
    [Fact]
    public void A_document_without_a_structure_block_is_untouched()
    {
        var codesys = File.ReadAllText(Path.Combine(
            System.AppContext.BaseDirectory, "fixtures", "codesys-pou", "FB_FolderChild.plcopen.xml"));
        Assert.DoesNotContain("ProjectStructure", codesys);

        var doc = PouDocument.Splice(codesys, "FB_FolderChild",
            new ItemContent(ItemKind.Kinds.FunctionBlock,
                "FUNCTION_BLOCK FB_FolderChild\nVAR_INPUT\nEND_VAR\nVAR_OUTPUT\nEND_VAR\nVAR\nEND_VAR\n", "//body",
                new List<Member> { new(ItemKind.Kinds.Action, "ACT", "", "//body", Folder: "testfolder") }), establishing: false);

        Assert.DoesNotContain("ProjectStructure", doc);
    }
}
