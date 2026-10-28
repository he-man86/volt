using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Item;
using Xunit;
using static Volt.Ide.Twincat.Tests.TcWalkRpcTrailTests;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// A VALUE THE IDE DID NOT ANSWER IS REFUSED BY NAME, NEVER READ AS <c>""</c> (zero-fallback policy, owner 2026-10-23).
/// TwinCAT's automation answers a string through COM, and a null BSTR arrives as null: the IDE stating nothing. Read as
/// <c>""</c>, a tree item with no <c>Name</c> was walked as an item named <c>""</c> — a fabricated wire identity — and one
/// with no <c>PathName</c> sat at the PLC project's own path. Each read below refuses instead, naming what it can.
/// </summary>
public class TcUnansweredValueTests
{
    /// <summary>A tree item answering only what a test gives it.</summary>
    public sealed class Answers
    {
        public string? Name { get; init; }
        public string? PathName { get; init; }
        public string? Xml { get; init; }
        public string? ProduceXml(bool recursive) => Xml;
    }

    private const string At = "TIPC^Untitled2^Untitled2 Project^DUTs^E_Mode";

    [Fact]
    public void A_tree_item_answering_no_Name_is_refused_by_its_path()
    {
        var ex = Assert.Throws<BridgeException>(() => new TcObjectModel().GetName(new Answers { PathName = At }));
        Assert.Equal(BridgeErrorCodes.Unreadable, ex.ErrorCode);
        Assert.Contains("no Name", ex.Message);
        Assert.Contains(At, ex.Message);
    }

    [Fact]
    public void A_tree_item_answering_no_PathName_is_refused_by_its_name()
    {
        var pou = new Answers { Name = "FB_X", PathName = "TIPC^Untitled2^Untitled2 Project^FB_X" };
        var ex = Assert.Throws<BridgeException>(() => new TcObjectModel().RelativePath(pou, new Answers { Name = "Run" }));
        Assert.Equal(BridgeErrorCodes.Unreadable, ex.ErrorCode);
        Assert.Contains("no PathName", ex.Message);
        Assert.Contains("'Run'", ex.Message);
    }

    [Fact]
    public void A_tree_item_answering_no_item_XML_is_refused_by_its_path()
    {
        var ex = Assert.Throws<BridgeException>(() => new TcObjectModel().ProduceXml(new Answers { Name = "E_Mode", PathName = At }));
        Assert.Equal(BridgeErrorCodes.Unreadable, ex.ErrorCode);
        Assert.Contains("no item XML", ex.Message);
        Assert.Contains(At, ex.Message);
    }

    /// <summary>In the walk the refusal is one child the folder cannot name: that folder is unwalked (nothing in it is
    /// read as deleted), and no item named <c>""</c> reaches the wire.</summary>
    [Fact]
    public void The_walk_names_no_item_for_a_child_answering_no_Name_and_leaves_its_folder_unwalked()
    {
        var duts = new Node("DUTs", ItemKind.PlcFolder,
            _ => new Node("E_Mode", ItemKind.PlcDutEnum),
            _ => new Node(null!, ItemKind.PlcDutStruct));
        var root = new Node("Untitled2 Project", ItemKind.PlcFolder, _ => duts);
        var explorer = new ExplorerNode(root.Name, "", root.Name, new List<ExplorerNode> { duts.Explorer("E_Mode", "ST_X") });

        var walk = WalkResultOf(root, explorer);

        Assert.DoesNotContain(walk.Items, i => string.IsNullOrEmpty(i.Name));
        Assert.Contains(walk.Items, i => i.Name == "E_Mode");
        Assert.Contains(TcUntouchablePouTests.App + "/DUTs", walk.UnwalkedFolders);
    }

    /// <summary>The solution root is named by the bound project; a driver bound to none has no name to give it.</summary>
    [Fact]
    public void The_solution_root_of_a_driver_bound_to_no_project_is_refused_not_named_empty()
    {
        var driver = new BeckhoffDriver(new TcObjectModel());
        var ex = Assert.Throws<BridgeException>(() => driver.Name(driver.GetTreeRoot()));
        Assert.Equal(BridgeErrorCodes.PlcDisconnected, ex.ErrorCode);
    }

    /// <summary>A build property publishes its value as <c>&lt;Value&gt;</c> — <c>&lt;Value /&gt;</c> when empty (DIALECT
    /// C40). One with no <c>&lt;Value&gt;</c> at all is unmeasured: refused by name, never read as no defines.</summary>
    [Fact]
    public void A_build_property_with_no_Value_element_is_refused_by_name()
    {
        var xml = "<TreeItem><VSProperties>" + TcExclusionTests.Property("False") +
                  TcExclusionTests.Own("External", "False") + TcExclusionTests.Own("LinkAlways", "False") +
                  "<VSProperty category=\"Advanced\"><Name>CompilerDefines</Name></VSProperty></VSProperties></TreeItem>";
        var ex = Assert.Throws<BridgeException>(() => new TcObjectModel().Build(new Answers { Xml = xml }, () => "'FB_X'", ownerExcluded: false));
        Assert.Contains("'FB_X'", ex.Message);
        Assert.Contains("CompilerDefines", ex.Message);
        Assert.Contains("no Value", ex.Message);
    }

    /// <summary>An interface accessor's stored declaration is measured in two forms — TwinCAT's constant and the empty
    /// <c>&lt;![CDATA[]]&gt;</c> of a 3.1.4024.16 save (<c>ITF1.TcIO</c>). An accessor holding no <c>&lt;Declaration&gt;</c>
    /// element is neither: refused by name, never read as the empty declaration.</summary>
    [Fact]
    public void An_interface_accessor_saved_with_no_Declaration_element_is_refused_by_name()
    {
        var dir = Path.Combine(Path.GetTempPath(), "volt-tc-unanswered-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        try
        {
            var file = Path.Combine(dir, "I_X.TcIO");
            File.WriteAllText(file, "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<TcPlcObject Version=\"1.1.0.1\">\n" +
                                    "  <Itf Name=\"I_X\" Id=\"{00000000-0000-0000-0000-000000000001}\">\n" +
                                    "    <Property Name=\"P\"><Get Name=\"Get\" /></Property>\n  </Itf>\n</TcPlcObject>\n");
            var node = new Answers
            {
                Xml = "<TreeItem><VSProperties>" + TcExclusionTests.Advanced("False") +
                      $"<VSProperty category=\"Misc\" readonly=\"true\"><Name>FullPath</Name><Value>{file}</Value></VSProperty>" +
                      "</VSProperties></TreeItem>",
            };
            var ex = Assert.Throws<BridgeException>(() => new TcObjectModel().SavedFacts(node, () => "'I_X'"));
            Assert.Contains("'I_X'", ex.Message);
            Assert.Contains("'P'", ex.Message);
            Assert.Contains("GET", ex.Message);
        }
        finally { Directory.Delete(dir, recursive: true); }
    }

    /// <summary>Every <c>&lt;Property&gt;</c> TwinCAT saves in a <c>.TcIO</c> / <c>.TcPOU</c> carries a <c>Name</c>
    /// attribute (every recording: <c>ITF1.TcIO</c>, <c>MembersSt.TcPOU</c>, <c>MembersHidden.TcPOU</c>). A nameless one was
    /// SKIPPED, so its accessors were later reported "not in the saved file — save the project", a remedy that cannot help.
    /// Refused at the element, by name.</summary>
    [Fact]
    public void An_interface_property_saved_with_no_Name_is_refused_at_the_element()
    {
        var dir = Path.Combine(Path.GetTempPath(), "volt-tc-unanswered-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        try
        {
            var file = Path.Combine(dir, "I_X.TcIO");
            File.WriteAllText(file, "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<TcPlcObject Version=\"1.1.0.1\">\n" +
                                    "  <Itf Name=\"I_X\" Id=\"{00000000-0000-0000-0000-000000000001}\">\n" +
                                    "    <Property Id=\"{00000000-0000-0000-0000-000000000002}\"><Get Name=\"Get\"><Declaration><![CDATA[]]></Declaration></Get></Property>\n" +
                                    "  </Itf>\n</TcPlcObject>\n");
            var node = new Answers
            {
                Xml = "<TreeItem><VSProperties>" + TcExclusionTests.Advanced("False") +
                      $"<VSProperty category=\"Misc\" readonly=\"true\"><Name>FullPath</Name><Value>{file}</Value></VSProperty>" +
                      "</VSProperties></TreeItem>",
            };
            var ex = Assert.Throws<BridgeException>(() => new TcObjectModel().SavedFacts(node, () => "'I_X'"));
            Assert.Equal(BridgeErrorCodes.Unreadable, ex.ErrorCode);
            Assert.Contains("'I_X'", ex.Message);
            Assert.Contains("no Name", ex.Message);
            Assert.Contains("I_X.TcIO", ex.Message);
        }
        finally { Directory.Delete(dir, recursive: true); }
    }

    /// <summary>Every library in the signature document states its name, version and distributor (DIALECT D27) — the
    /// three parts its resolution joins a signature to its <c>.library</c> by. One missing is refused by name, never
    /// joined by an empty part.</summary>
    [Theory]
    [InlineData("LibraryName")]
    [InlineData("Version")]
    [InlineData("Distributor")]
    public void A_library_signature_document_missing_a_resolution_part_is_refused_by_name(string missing)
    {
        var parts = new[] { ("LibraryName", "Tc2_Standard"), ("Version", "3.3.3.0"), ("Distributor", "Beckhoff Automation GmbH") };
        var xml = "<Library>" + string.Concat(parts.Where(p => p.Item1 != missing).Select(p => $"<{p.Item1}>{p.Item2}</{p.Item1}>")) +
                  "<TypeSignatures><TypeSignature type=\"Function\"><Name>F</Name></TypeSignature></TypeSignatures></Library>";
        var ex = Assert.Throws<BridgeException>(() => TcLibrarySignatures.Parse(xml));
        Assert.Equal(BridgeErrorCodes.Unreadable, ex.ErrorCode);
        Assert.Contains(missing, ex.Message);
    }
}
