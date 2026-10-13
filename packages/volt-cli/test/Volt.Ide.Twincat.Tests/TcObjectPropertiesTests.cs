using System;
using System.IO;
using Volt.Engine;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// TWINCAT AND THE OBJECT-PROPERTY LINES (openspec <c>bridge-one-to-one</c> §1.1 "TwinCAT and the object-property lines",
/// §1.3 <c>tc-special-classes</c>, tasks 3.1 / 3.3): TwinCAT has no measured member for any <c>%</c>-key, so a push
/// carrying one is refused by name, a class create is refused by name (no automation path makes a special class), and an
/// object whose SAVED file holds what the text cannot say — a <c>SpecialFunc</c> other than <c>None</c>, an object property
/// other than the SFC body's — is refused on pull, never read as a plain one.
/// </summary>
public class TcObjectPropertiesTests
{
    [Theory]
    [InlineData("%EXCLUDE_FROM_BUILD")]
    [InlineData("%LINK_ALWAYS")]
    [InlineData("%COMMENT")]
    public void A_pushed_property_line_is_refused_by_name(string key)
    {
        var props = key switch
        {
            "%EXCLUDE_FROM_BUILD" => ObjectProperties.None with { ExcludeFromBuild = true },
            "%LINK_ALWAYS" => ObjectProperties.None with { LinkAlways = true },
            _ => ObjectProperties.None with { Comment = "doc" },
        };
        var ex = Assert.Throws<BridgeException>(() =>
            new BeckhoffDriver(new TcObjectModel()).ValidateProperties("'FB_X'", props, create: false));
        Assert.Contains("'FB_X'", ex.Message);
        Assert.Contains($"no measured member for {key}", ex.Message);
    }

    [Fact]
    public void The_measured_absence_of_every_property_passes() =>
        new BeckhoffDriver(new TcObjectModel()).ValidateProperties("'FB_X'", ObjectProperties.None, create: false);

    [Theory]
    [InlineData(ObjectClass.Check, "CheckBounds")]
    [InlineData(ObjectClass.Persistent, null)]
    public void A_class_create_is_refused_by_name(string word, string? argument)
    {
        var ex = Assert.Throws<ChildRefusedException>(() =>
            new BeckhoffDriver(new TcObjectModel()).CreateChild(new ItemRef(new object()), "CheckBounds", ItemKind.PlcPou, null,
                                                               new ObjectClass(word, argument)));
        Assert.Contains($"%CLASS {word}", ex.Message);
        Assert.Contains("C2s", ex.Message);
    }

    /// <summary>A tree item publishing the file it is saved in (its <c>FullPath</c>), as TcXaeShell's <c>ProduceXml</c>
    /// does for a POU, with the two text slots the content read takes.</summary>
    public sealed class SavedNode
    {
        private readonly string _file;
        public SavedNode(string file) => _file = file;
        public string Name => "FB_Saved";
        public int ItemType => ItemKind.PlcPou;
        public string DeclarationText { get; set; } = "FUNCTION_BLOCK FB_Saved\nVAR\nEND_VAR";
        public string ImplementationText { get; set; } = "x := 1;";
        public int ChildCount => 0;
        public string ProduceXml(bool recursive) =>
            $"<TreeItem><ItemName>FB_Saved</ItemName><VSProperties><VSProperty><Name>FullPath</Name><Value>{_file}</Value>" +
            "</VSProperty></VSProperties></TreeItem>";
    }

    private static string Saved(string pouAttributes, string objectProperties)
    {
        var file = Path.Combine(Path.GetTempPath(), "volt-tc-props-" + Guid.NewGuid().ToString("N") + ".TcPOU");
        File.WriteAllText(file,
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<TcPlcObject Version=\"1.1.0.1\">\n" +
            $"  <POU Name=\"FB_Saved\" Id=\"{{{Guid.NewGuid()}}}\" {pouAttributes}>\n" +
            "    <Declaration><![CDATA[FUNCTION_BLOCK FB_Saved]]></Declaration>\n" +
            $"    {objectProperties}\n  </POU>\n</TcPlcObject>\n");
        return file;
    }

    [Fact]
    public void A_saved_special_function_is_refused_on_pull()
    {
        var file = Saved("SpecialFunc=\"CheckBounds\"", "");
        try
        {
            var ex = Assert.Throws<BridgeException>(() =>
                TcUntouchablePouTests.BoundDriver().ReadContent(new ItemRef(new SavedNode(file))));
            Assert.Contains("SpecialFunc=\"CheckBounds\"", ex.Message);
            Assert.Contains("'FB_Saved'", ex.Message);
        }
        finally { File.Delete(file); }
    }

    [Fact]
    public void A_saved_object_property_other_than_the_sfc_archive_is_refused_on_pull()
    {
        var file = Saved("SpecialFunc=\"None\"",
            "<ObjectProperties><XmlArchive><Data><o xml:space=\"preserve\" t=\"BuildProperty\" /></Data></XmlArchive></ObjectProperties>");
        try
        {
            var ex = Assert.Throws<BridgeException>(() =>
                TcUntouchablePouTests.BoundDriver().ReadContent(new ItemRef(new SavedNode(file))));
            Assert.Contains("BuildProperty", ex.Message);
        }
        finally { File.Delete(file); }
    }

    /// <summary>The measured state of every loaded corpus POU — <c>SpecialFunc="None"</c>, an SFC archive at most — pulls
    /// with the measured absence of every property.</summary>
    [Fact]
    public void A_saved_plain_pou_pulls_with_no_property()
    {
        var file = Saved("SpecialFunc=\"None\"",
            "<ObjectProperties><XmlArchive><Data><o xml:space=\"preserve\" t=\"SFCProperty\" /></Data></XmlArchive></ObjectProperties>");
        try
        {
            var read = TcUntouchablePouTests.BoundDriver().ReadContent(new ItemRef(new SavedNode(file)));
            Assert.Equal(ObjectProperties.None, read.Properties);
        }
        finally { File.Delete(file); }
    }

    // ── gate review of step 3, finding 6: no silent "no properties" ─────────────────────────────────────────────────────

    /// <summary>A tree item whose automation XML is given — with or without a <c>FullPath</c>.</summary>
    public sealed class XmlPou
    {
        private readonly string _xml;
        public XmlPou(string xml) => _xml = xml;
        public string Name => "FB_Saved";
        public int ItemType => ItemKind.PlcPou;
        public string DeclarationText { get; set; } = "FUNCTION_BLOCK FB_Saved\nVAR\nEND_VAR";
        public string ImplementationText { get; set; } = "x := 1;";
        public int ChildCount => 0;
        public string ProduceXml(bool recursive) => _xml;
    }

    /// <summary>An item that publishes no <c>FullPath</c> is refused by name — it read as an object with no properties.</summary>
    [Fact]
    public void An_item_publishing_no_saved_file_is_refused_by_name()
    {
        var ex = Assert.Throws<BridgeException>(() => TcUntouchablePouTests.BoundDriver()
            .ReadContent(new ItemRef(new XmlPou("<TreeItem><ItemName>FB_Saved</ItemName><VSProperties /></TreeItem>"))));
        Assert.Contains("'FB_Saved'", ex.Message);
        Assert.Contains("FullPath", ex.Message);
    }

    /// <summary>…and one whose saved file is not on disk.</summary>
    [Fact]
    public void An_item_whose_saved_file_is_not_on_disk_is_refused_by_name()
    {
        var missing = Path.Combine(Path.GetTempPath(), "volt-tc-missing-" + Guid.NewGuid().ToString("N") + ".TcPOU");
        var ex = Assert.Throws<BridgeException>(() => new SavedNode(missing) is var n
            ? TcUntouchablePouTests.BoundDriver().ReadContent(new ItemRef(n)) : null);
        Assert.Contains("'FB_Saved'", ex.Message);
        Assert.Contains("not on disk", ex.Message);
    }

    /// <summary>A LINKED file — its <c>.plcproj</c> <c>Include</c> outside the project folder — is found by its full path:
    /// its <c>&lt;ExcludeFromBuild&gt;</c> refuses it by name, as an entry inside the folder does. The prefix compare never
    /// saw it, so the object pulled as a built one.</summary>
    [Fact]
    public void A_linked_files_build_entry_is_read_and_refuses_it_by_name()
    {
        var root = Path.Combine(Path.GetTempPath(), "volt-tc-linked-" + Guid.NewGuid().ToString("N"));
        var projectDir = Path.Combine(root, "Plc");
        var sharedDir = Path.Combine(root, "Shared");
        Directory.CreateDirectory(projectDir);
        Directory.CreateDirectory(sharedDir);
        try
        {
            var file = Path.Combine(sharedDir, "FB_Saved.TcPOU");
            File.Move(Saved("SpecialFunc=\"None\"", ""), file);
            var plcproj = Path.Combine(projectDir, "Plc.plcproj");
            File.WriteAllText(plcproj,
                "<Project xmlns=\"http://schemas.microsoft.com/developer/msbuild/2003\"><ItemGroup>" +
                "<Compile Include=\"..\\Shared\\FB_Saved.TcPOU\"><SubType>Code</SubType><ExcludeFromBuild>true</ExcludeFromBuild></Compile>" +
                "</ItemGroup></Project>");

            var ex = Assert.Throws<BridgeException>(() =>
                TcUntouchablePouTests.BoundDriver(plcproj).ReadContent(new ItemRef(new SavedNode(file))));
            Assert.Contains("ExcludeFromBuild", ex.Message);
            Assert.Contains("'FB_Saved'", ex.Message);
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    // ── gate review of step 3, finding 5: the interface accessor's stored declaration ────────────────────────────────────

    /// <summary>An interface publishing its saved <c>.TcIO</c>, holding one property with a GET.</summary>
    public sealed class SavedItf
    {
        private readonly string _file;
        public SavedItf(string file, params TcHiddenBodyWriteTests.Node[] kids) { _file = file; Kids = kids; }
        public string Name => "I_Saved";
        public int ItemType => ItemKind.PlcItf;
        public string DeclarationText { get; set; } = "INTERFACE I_Saved";
        public TcHiddenBodyWriteTests.Node[] Kids { get; }
        public int ChildCount => Kids.Length;
        public TcHiddenBodyWriteTests.Children Child => new(new System.Collections.Generic.List<TcHiddenBodyWriteTests.Node>(Kids));
        public string ProduceXml(bool recursive) =>
            $"<TreeItem><ItemName>I_Saved</ItemName><VSProperties><VSProperty><Name>FullPath</Name><Value>{_file}</Value>" +
            "</VSProperty></VSProperties></TreeItem>";
    }

    private static string SavedInterface(string getDeclaration)
    {
        var file = Path.Combine(Path.GetTempPath(), "volt-tc-itf-" + Guid.NewGuid().ToString("N") + ".TcIO");
        File.WriteAllText(file,
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>\r\n<TcPlcObject Version=\"1.1.0.1\">\r\n" +
            $"  <Itf Name=\"I_Saved\" Id=\"{{{Guid.NewGuid()}}}\">\r\n" +
            "    <Declaration><![CDATA[INTERFACE I_Saved]]></Declaration>\r\n" +
            $"    <Property Name=\"Speed\" Id=\"{{{Guid.NewGuid()}}}\">\r\n" +
            "      <Declaration><![CDATA[PROPERTY Speed : INT]]></Declaration>\r\n" +
            $"      <Get Name=\"Get\" Id=\"{{{Guid.NewGuid()}}}\">\r\n" +
            $"        <Declaration><![CDATA[{getDeclaration}]]></Declaration>\r\n" +
            "      </Get>\r\n    </Property>\r\n  </Itf>\r\n</TcPlcObject>\r\n");
        return file;
    }

    private static SavedItf Interface(string file) =>
        new(file, new TcHiddenBodyWriteTests.Node("Speed", ItemKind.PlcItfProp, "PROPERTY Speed : INT", "",
                                                  new TcHiddenBodyWriteTests.Node("Get", ItemKind.PlcItfPropGet, "", "")));

    /// <summary>The measured constant (<c>PUBLIC / VAR / END_VAR</c>, stored with CRLF) pulls as the empty declaration.</summary>
    [Fact]
    public void An_interface_accessor_storing_the_measured_declaration_pulls()
    {
        var file = SavedInterface("PUBLIC\r\nVAR\r\nEND_VAR");
        try
        {
            var read = TcUntouchablePouTests.BoundDriver().ReadContent(new ItemRef(Interface(file)));
            Assert.NotNull(Assert.Single(read.Members).Getter);
        }
        finally { File.Delete(file); }
    }

    /// <summary>Any other stored declaration refuses the interface by name — it pulled as the empty declaration.</summary>
    [Fact]
    public void An_interface_accessor_storing_another_declaration_is_refused_by_name()
    {
        var file = SavedInterface("VAR\r\n\tx : INT;\r\nEND_VAR");
        try
        {
            var ex = Assert.Throws<BridgeException>(() =>
                TcUntouchablePouTests.BoundDriver().ReadContent(new ItemRef(Interface(file))));
            Assert.Contains("'I_Saved'", ex.Message);
            Assert.Contains("'Speed' GET", ex.Message);
            Assert.Contains("x : INT;", ex.Message);
        }
        finally { File.Delete(file); }
    }

    /// <summary>A VENDOR-SAVED interface whose accessors store an EMPTY declaration pulls, as the empty declaration it is
    /// (second review of step 3, finding 3): <c>fixtures/tc-pou/ITF1.TcIO</c> (ProductVersion 3.1.4024.16) stores
    /// <c>&lt;![CDATA[]]&gt;</c> under its GET and SET. Only <c>PUBLIC / VAR / END_VAR</c> was admitted — measured on an
    /// accessor Volt's own push made on TcXaeShell 15 — so such an interface was refused on pull with no remedy.</summary>
    [Fact]
    public void A_vendor_saved_interface_accessor_storing_an_empty_declaration_pulls()
    {
        var itf = new SavedItf(Fixtures.Path("tc-pou", "ITF1.TcIO"),
            new TcHiddenBodyWriteTests.Node("Prop", ItemKind.PlcItfProp, "PROPERTY Prop : BOOL", "",
                new TcHiddenBodyWriteTests.Node("Get", ItemKind.PlcItfPropGet, "", ""),
                new TcHiddenBodyWriteTests.Node("Set", ItemKind.PlcItfPropSet, "", "")));

        var prop = Assert.Single(TcUntouchablePouTests.BoundDriver().ReadContent(new ItemRef(itf)).Members);

        Assert.NotNull(prop.Getter);
        Assert.NotNull(prop.Setter);
    }
}
