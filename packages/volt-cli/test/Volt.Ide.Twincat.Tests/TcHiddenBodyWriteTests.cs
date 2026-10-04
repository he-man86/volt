using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Volt.Engine.Item;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// THE TWINCAT WRITER NEVER WRITES A BODY VOLT DOES NOT SHOW (openspec <c>implementation-keyword</c> 3b).
///
/// <para>A CFC, SFC or IL body, and an LD/FBD body network text cannot represent, is its
/// <c>IMPLEMENTATION &lt;LANG&gt; UNSUPPORTED</c> line in the workspace. Its DECLARATION is editable and is pushed; its
/// body must not be: the line has no text form, and <c>ImplementationText</c> would store the words of the line over
/// the engineer's chart. This drives <see cref="BeckhoffDriver.WriteContent"/> itself — the POU, a method and a property
/// accessor, each hidden — against nodes that COUNT every implementation write, and asserts the declarations land and
/// not one implementation is assigned.</para>
///
/// <para>The nodes are plain public classes: the driver reaches the vendor's COM object through <c>dynamic</c>, which
/// binds to a C# class exactly as it binds to the real one (see <see cref="TcWriteTextTests"/>).</para>
/// </summary>
public class TcHiddenBodyWriteTests
{
    /// <summary>A TwinCAT tree node: its name, kind, the two text slots, and its children. Every assignment to
    /// <c>ImplementationText</c> is counted — "never written" is a count of zero, not a value that happens to match.</summary>
    public sealed class Node
    {
        private string _implementation;

        public Node(string name, int itemType, string declaration, string implementation, params Node[] children)
        {
            Name = name;
            ItemType = itemType;
            DeclarationText = declaration;
            _implementation = implementation;
            Kids = children.ToList();
        }

        public string Name { get; }
        public int ItemType { get; }
        public string DeclarationText { get; set; }
        public int ImplementationWrites { get; private set; }

        public string ImplementationText
        {
            get => _implementation;
            set { _implementation = value; ImplementationWrites++; }
        }

        public List<Node> Kids { get; }
        public int ChildCount => Kids.Count;
        public Children Child => new(Kids);
    }

    /// <summary><c>node.Child[i]</c>, 1-based, as the vendor's collection is.</summary>
    public sealed class Children
    {
        private readonly List<Node> _kids;
        public Children(List<Node> kids) => _kids = kids;
        public Node this[int index1Based] => _kids[index1Based - 1];
    }

    private const string ChartArchive = "<CFC><chart the engineer drew/></CFC>";
    private const string LadderArchive = "<NWL><o t=\"NWLImplementationObject\"/></NWL>";
    private const string GetterArchive = "<SFC><steps/></SFC>";

    [Theory]
    [InlineData("CFC")]
    [InlineData("SFC")]
    [InlineData("IL")]
    [InlineData("LD")]
    [InlineData("FBD")]
    public void A_pushed_declaration_lands_and_no_hidden_body_is_written(string language)
    {
        var line = $"IMPLEMENTATION {language} UNSUPPORTED";
        var getter = new Node("Get", ItemKind.PlcPropGet, "VAR\nEND_VAR", GetterArchive);
        var property = new Node("Ready", ItemKind.PlcProp, "PROPERTY Ready : BOOL", "", getter);
        var method = new Node("Step", ItemKind.PlcMethod, "METHOD Step : BOOL", LadderArchive);
        var pou = new Node("FB_Chart", ItemKind.PlcPou, "FUNCTION_BLOCK FB_Chart\nVAR\nEND_VAR", ChartArchive,
                           method, property);

        var content = new ItemContent(ItemKind.Kinds.Pou,
            "FUNCTION_BLOCK FB_Chart\nVAR_INPUT\n\tbStart : BOOL;\nEND_VAR\nVAR\nEND_VAR", line,
            new List<Member>
            {
                new(ItemKind.Kinds.Method, "Step", "METHOD Step : BOOL\nVAR_INPUT\n\tn : INT;\nEND_VAR", line),
                new(ItemKind.Kinds.Property, "Ready", "PROPERTY Ready : BOOL", null,
                    Getter: new Accessor("VAR\n\tb : BOOL;\nEND_VAR", line), Setter: null),
            });

        // Bound, as every production write is: each child access passes the C2i guard (TcUntouchablePouTests).
        TcUntouchablePouTests.BoundDriver().WriteContent(new ItemRef(pou), content, System.Array.Empty<Volt.Engine.Ide.PushedNetworkBody>());

        Assert.Contains("bStart : BOOL;", pou.DeclarationText);
        Assert.Contains("n : INT;", method.DeclarationText);
        Assert.Contains("b : BOOL;", getter.DeclarationText);
        foreach (var node in new[] { pou, method, property, getter })
            Assert.True(node.ImplementationWrites == 0, $"'{node.Name}' had its implementation written");
        Assert.Equal(ChartArchive, pou.ImplementationText);
        Assert.Equal(LadderArchive, method.ImplementationText);
        Assert.Equal(GetterArchive, getter.ImplementationText);
    }
    /// <summary>A POU's parent, as the archive round trip drives it through <c>dynamic</c>: it exports the POU's
    /// document as TwinCAT does (a zip, the entry named by its project path, the vendor's own bytes) and keeps the
    /// bytes it is handed back on import.</summary>
    public sealed class ArchiveParent
    {
        private readonly byte[] _document;
        public ArchiveParent(byte[] document) => _document = document;
        public byte[]? Imported { get; private set; }

        public void ExportChild(string name, string zipPath)
        {
            using var zip = ZipFile.Open(zipPath, ZipArchiveMode.Create);
            using var entry = zip.CreateEntry($@"POUs\{name}.TcPOU").Open();
            entry.Write(_document, 0, _document.Length);
        }

        public void DeleteChild(string name) { }

        public void ImportChild(string zipPath, object a, bool b, object c)
        {
            using var zip = ZipFile.OpenRead(zipPath);
            using var entry = Assert.Single(zip.Entries).Open();
            using var bytes = new MemoryStream();
            entry.CopyTo(bytes);
            Imported = bytes.ToArray();
        }
    }

    /// <summary>A member element (or the POU's own implementation) as the document SPELLS it — raw text, not a
    /// re-parse, because the claim is "not one byte of a hidden body changed", and a parse forgives whitespace,
    /// line endings and escaping that the IDE then imports.</summary>
    private static string Raw(string document, string element, string? name)
    {
        var pattern = name is null
            ? @"<Implementation>.*?</Implementation>"   // the first one is the POU's own
            : $@"<{element} Name=""{name}"".*?</{element}>";
        var m = Regex.Match(document, pattern, RegexOptions.Singleline);
        Assert.True(m.Success, $"'{name ?? "the POU"}' is not in the document");
        return m.Value;
    }

    /// <summary>ONE graphical member edit rewrites the WHOLE POU on TwinCAT: a member's graphical body can only go
    /// in through the POU's archive (DIALECT D32), and <c>SetMemberBodies</c> deletes the POU and imports it back.
    /// Every sibling a push leaves hidden — the POU's own CFC chart, a CFC method, an SFC action, a CFC property
    /// getter — rides that import. "Nothing in the IDE is overwritten" (spec: implementation-boundary) means each
    /// comes back exactly as the vendor wrote it, byte for byte, and only the edited member changes.</summary>
    [Fact]
    public void A_graphical_member_edit_carries_every_hidden_sibling_through_the_archive_byte_for_byte()
    {
        var before = File.ReadAllBytes(Fixtures.Path("tc-pou", "MembersHidden.TcPOU"));
        var parent = new ArchiveParent(before);
        var ladder = Fixtures.Pou("ladder.TcPOU");
        var nwl = ladder.Substring(ladder.IndexOf("<NWL>", StringComparison.Ordinal),
            ladder.IndexOf("</NWL>", StringComparison.Ordinal) + "</NWL>".Length - ladder.IndexOf("<NWL>", StringComparison.Ordinal));

        TcItemArchive.SetMemberBodies(parent, "VltProbe_Hidden", new List<(string[], string)> { (new[] { "M_Ladder" }, nwl) });

        var was = Encoding.UTF8.GetString(before);
        var now = Encoding.UTF8.GetString(Assert.IsType<byte[]>(parent.Imported));
        Assert.Contains("<NWL>", Raw(now, "Method", "M_Ladder"));                          // the edit landed
        Assert.Equal(Raw(was, "Implementation", null), Raw(now, "Implementation", null));  // the POU's CFC chart
        foreach (var (element, name) in new[] { ("Method", "M_Chart"), ("Action", "A_Seq"), ("Property", "P_Chart") })
            Assert.Equal(Raw(was, element, name), Raw(now, element, name));
    }
    /// <summary>The same round trip carries a MOVE: a member placed into a folder goes in through the POU's archive
    /// too (<c>MoveMember</c>, DIALECT D4j). Moving a hidden member changes its folder and nothing else — its own
    /// chart and every sibling's come back byte for byte.</summary>
    [Fact]
    public void Moving_a_hidden_member_into_a_folder_changes_no_hidden_body_byte()
    {
        var before = File.ReadAllBytes(Fixtures.Path("tc-pou", "MembersHidden.TcPOU"));
        var parent = new ArchiveParent(before);

        TcItemArchive.MoveMember(parent, "VltProbe_Hidden", "M_Chart", "Sub");

        var was = Encoding.UTF8.GetString(before);
        var now = Encoding.UTF8.GetString(Assert.IsType<byte[]>(parent.Imported));
        Assert.Contains(@"FolderPath=""Sub\""", Raw(now, "Method", "M_Chart"));             // the move landed
        Assert.Equal(Raw(was, "Implementation", null), Raw(now, "Implementation", null));
        var implementation = new Regex("<Implementation>.*?</Implementation>", RegexOptions.Singleline);
        Assert.Equal(implementation.Match(Raw(was, "Method", "M_Chart")).Value,
                     implementation.Match(Raw(now, "Method", "M_Chart")).Value);
        foreach (var (element, name) in new[] { ("Method", "M_Ladder"), ("Action", "A_Seq"), ("Property", "P_Chart") })
            Assert.Equal(Raw(was, element, name), Raw(now, element, name));
    }

    /// <summary>A TOP-LEVEL move is the same kind of whole-document round trip: <c>TcItemArchive.Move</c> exports the
    /// POU, deletes it and re-imports it under the target (DIALECT D4f), so every hidden body the POU holds — its own
    /// CFC chart, a CFC method, an SFC action, a CFC getter — rides that import. The one rewrite on this path is the
    /// entry NAME (<c>Flatten</c>, the folder prefix TwinCAT would otherwise recreate), and it must be the only one:
    /// the document arrives at the target as exactly the bytes it left with (spec: "nothing in the IDE is overwritten",
    /// "… moved").</summary>
    [Fact]
    public void Moving_a_POU_holding_hidden_bodies_imports_the_vendor_document_byte_for_byte()
    {
        var before = File.ReadAllBytes(Fixtures.Path("tc-pou", "MembersHidden.TcPOU"));
        var from = new ArchiveParent(before);
        var to = new ArchiveParent(Array.Empty<byte>());

        TcItemArchive.Move(from, to, "VltProbe_Hidden", new ArchiveParent(Array.Empty<byte>()),
                           (Func<object, IReadOnlyCollection<string>>)(_ => Array.Empty<string>()));

        Assert.Null(from.Imported);                                        // not restored: the move went through
        Assert.Equal(before, Assert.IsType<byte[]>(to.Imported));
    }

    /// <summary>The comparisons above are per element, so they cannot see the DOCUMENT's own bytes — and the archive
    /// rewrite once lost the first three: every entry was read with a default <c>StreamReader</c> (which eats the
    /// UTF-8 byte order mark TwinCAT writes) and written back with a default <c>StreamWriter</c> (which writes none).
    /// A placement that changes nothing — a member already at the POU root, "moved" to the root — is the whole
    /// claim with nothing to subtract: the POU goes back into the IDE as exactly the bytes it came out as.</summary>
    [Fact]
    public void A_placement_that_changes_nothing_imports_the_vendor_document_byte_for_byte()
    {
        var before = File.ReadAllBytes(Fixtures.Path("tc-pou", "MembersHidden.TcPOU"));
        Assert.Equal(new byte[] { 0xEF, 0xBB, 0xBF }, before.Take(3).ToArray());   // the vendor writes a BOM
        var parent = new ArchiveParent(before);

        TcItemArchive.MoveMember(parent, "VltProbe_Hidden", "M_Chart", "");

        Assert.Equal(before, Assert.IsType<byte[]>(parent.Imported));
    }

    /// <summary>The same for the graphical-body rewrite: whatever the edit, the document keeps the byte order mark
    /// the vendor gave it.</summary>
    [Fact]
    public void A_graphical_member_edit_keeps_the_vendor_documents_byte_order_mark()
    {
        var parent = new ArchiveParent(File.ReadAllBytes(Fixtures.Path("tc-pou", "MembersHidden.TcPOU")));
        var ladder = Fixtures.Pou("ladder.TcPOU");
        var start = ladder.IndexOf("<NWL>", StringComparison.Ordinal);
        var nwl = ladder.Substring(start, ladder.IndexOf("</NWL>", StringComparison.Ordinal) + "</NWL>".Length - start);

        TcItemArchive.SetMemberBodies(parent, "VltProbe_Hidden", new List<(string[], string)> { (new[] { "M_Ladder" }, nwl) });

        Assert.Equal(new byte[] { 0xEF, 0xBB, 0xBF, (byte)'<' },
                     Assert.IsType<byte[]>(parent.Imported).Take(4).ToArray());
    }
}
