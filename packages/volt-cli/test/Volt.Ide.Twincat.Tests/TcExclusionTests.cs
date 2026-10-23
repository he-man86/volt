using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Volt.Engine;
using Volt.Engine.Format.St;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Volt.Tests.Shared;
using Xunit;
using static Volt.Ide.Twincat.Tests.TcUntouchablePouTests;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// WHETHER TWINCAT BUILDS AN OBJECT IS ITS LIVE <c>Exclude</c> PROPERTY (DIALECT C39, openspec
/// <c>twincat-exclusion-from-ide</c>). Every PLC item, member and folder publishes <c>Exclude</c> in its
/// <c>ProduceXml</c>'s <c>&lt;VSProperties&gt;</c>, answered from memory — saved or not — and marked <c>readonly</c> when
/// it comes from an excluded folder above. The saved <c>.plcproj</c> is not that source: it lags until a save, keeps
/// <c>&lt;ExcludeFromBuild&gt;false&lt;/ExcludeFromBuild&gt;</c> on a re-included item, and holds a folder's flag on the
/// folder's own entry only — so an item in an excluded folder pulled as a built one.
/// </summary>
public class TcExclusionTests
{
    /// <summary>The <c>Exclude</c> VSProperty as TcXaeShell writes it: <c>False</c>, <c>True</c> (the node's own flag),
    /// <c>Inherited</c> (<c>True</c>, <c>readonly="true"</c>) — or none.</summary>
    internal static string Property(string? exclude) => exclude switch
    {
        null => "",
        "Inherited" => "<VSProperty category=\"Advanced\" readonly=\"true\"><Name>Exclude</Name><Value>True</Value></VSProperty>",
        _ => $"<VSProperty category=\"Advanced\"><Name>Exclude</Name><Value>{exclude}</Value></VSProperty>",
    };

    /// <summary>The <c>Advanced</c> VSProperties TcXaeShell publishes on every PLC item and member (C39, C40): the
    /// <c>Exclude</c> of <see cref="Property"/>, then <c>External</c>, <c>LinkAlways</c> and <c>CompilerDefines</c> at the
    /// values given (their measured defaults when none is).</summary>
    internal static string Advanced(string? exclude, string external = "False", string linkAlways = "False", string defines = "") =>
        Property(exclude) + Own("External", external) + Own("LinkAlways", linkAlways) + Own("CompilerDefines", defines);

    internal static string Own(string name, string value) =>
        $"<VSProperty category=\"Advanced\"><Name>{name}</Name><Value>{System.Security.SecurityElement.Escape(value)}</Value></VSProperty>";

    /// <summary>The live flag a <c>ConsumeXml</c> of the one property sets, as C39 measured.</summary>
    private static string Consumed(string xml) =>
        System.Xml.Linq.XElement.Parse(xml).Descendants("VSProperty").Single(p => (string?)p.Element("Name") == "Exclude")
            .Element("Value")!.Value;

    /// <summary>A PLC item's or member's live build properties (C39, C40), as its automation XML answers them; a
    /// <c>ConsumeXml</c> sets each property it names — one property per call, as the bridge writes them.</summary>
    public sealed class Live
    {
        public Live(string? exclude) => Exclude = exclude;
        public string? Exclude;
        public string External = "False", LinkAlways = "False", CompilerDefines = "";
        /// <summary>A POU's <c>AdditionalAllocation</c>; null where the node publishes none (every non-POU).</summary>
        public string? AdditionalAllocation;
        /// <summary>The property TcXaeShell marks <c>readonly</c> — never measured on these (C40); a test's what-if.</summary>
        public string? ReadOnly;
        /// <summary>The property the node does not publish — never measured (C40); a test's what-if.</summary>
        public string? Omitted;
        /// <summary>A <c>ConsumeXml</c> the IDE accepts and does not apply.</summary>
        public bool Inert;
        public readonly List<string> Consumes = new();

        public string Xml =>
            Property(Exclude) + Prop("External", External) + Prop("LinkAlways", LinkAlways) +
            Prop("CompilerDefines", CompilerDefines) + (AdditionalAllocation is { } a ? Prop("AdditionalAllocation", a) : "");

        private string Prop(string name, string value) =>
            name == Omitted ? ""
            : name == ReadOnly ? Own(name, value).Replace("category=\"Advanced\"", "category=\"Advanced\" readonly=\"true\"")
            : Own(name, value);

        public void Consume(string xml)
        {
            Consumes.Add(xml);
            if (Inert) return;
            var p = Assert.Single(System.Xml.Linq.XElement.Parse(xml).Descendants("VSProperty"));
            var value = p.Element("Value")!.Value;
            switch (p.Element("Name")!.Value)
            {
                case "Exclude": Exclude = value; break;
                case "External": External = value; break;
                case "LinkAlways": LinkAlways = value; break;
                case "CompilerDefines": CompilerDefines = value; break;
                default: throw new InvalidOperationException("unmeasured property " + p.Element("Name")!.Value);
            }
        }

        /// <summary>The written property names, in order.</summary>
        public IEnumerable<string> Written => Consumes.Select(c =>
            System.Xml.Linq.XElement.Parse(c).Descendants("VSProperty").Single().Element("Name")!.Value);
    }

    /// <summary>A PLC folder answering its automation XML.</summary>
    public sealed class Folder : Node
    {
        public Folder(Xae x, string name, string? exclude, params Node[] kids) : base(x, name, ItemKind.PlcFolder, false, kids) =>
            Exclude = exclude;
        public string? Exclude;
        public override string ProduceXml(bool recursive) =>
            $"<TreeItem><ItemName>{Name}</ItemName><ItemType>601</ItemType><VSProperties>{Property(Exclude)}</VSProperties></TreeItem>";
    }

    /// <summary>A member of <see cref="Pou"/>: its own live build properties.</summary>
    public sealed class Member
    {
        public Member(string name, int type, string declaration, string? exclude)
        { Name = name; ItemType = type; DeclarationText = declaration; Live = new Live(exclude); }
        public string Name { get; }
        public int ItemType { get; }
        public string DeclarationText { get; set; }
        public string ImplementationText { get; set; } = "";
        public int ChildCount => 0;
        public readonly Live Live;
        public string? Exclude => Live.Exclude;
        public List<string> Consumes => Live.Consumes;
        public string ProduceXml(bool recursive) =>
            $"<TreeItem><ItemName>{Name}</ItemName><VSProperties>{Live.Xml}</VSProperties></TreeItem>";
        public void ConsumeXml(string xml) => Live.Consume(xml);
    }

    public sealed class Kids
    {
        private readonly List<Member> _kids;
        public Kids(List<Member> kids) => _kids = kids;
        public Member this[int index1Based] => _kids[index1Based - 1];
    }

    /// <summary>A POU (or, with <see cref="Name"/> and <see cref="ItemType"/> set, a GVL) publishing its saved file and its
    /// live build properties; a <c>ConsumeXml</c> sets the property it names.</summary>
    public sealed class Pou
    {
        private readonly string _file;
        public Pou(string file, string? exclude, params Member[] members)
        { _file = file; Live = new Live(exclude) { AdditionalAllocation = "0" }; Members = members.ToList(); }
        public string Name { get; init; } = "FB_X";
        public int ItemType { get; init; } = ItemKind.PlcPou;
        public string DeclarationText { get; set; } = WireParityCases.ExcludedDeclaration;
        public string ImplementationText { get; set; } = WireParityCases.ExcludedBody;
        public readonly List<Member> Members;
        public int ChildCount => Members.Count;
        public Kids Child => new(Members);
        public readonly Live Live;
        public string? Exclude => Live.Exclude;
        public List<string> Consumes => Live.Consumes;
        public string ProduceXml(bool recursive) =>
            $"<TreeItem><ItemName>{Name}</ItemName><VSProperties>{Live.Xml}<VSProperty category=\"Misc\" readonly=\"true\">" +
            $"<Name>FullPath</Name><Value>{_file}</Value></VSProperty></VSProperties></TreeItem>";
        public void ConsumeXml(string xml) => Live.Consume(xml);
    }

    /// <summary>A saved PLC project: <c>FB_X.TcPOU</c> (or the <paramref name="file"/> given, holding a
    /// <paramref name="element"/>) beside a <c>.plcproj</c> whose <c>Compile</c> entry for it holds
    /// <paramref name="entry"/>.</summary>
    internal sealed class Saved : IDisposable
    {
        private readonly string _dir = Path.Combine(Path.GetTempPath(), "volt-tc-exclusion-" + Guid.NewGuid().ToString("N"));
        public string File { get; }
        public string Project { get; }
        public Saved(string entry, string file = "FB_X.TcPOU", string element = "POU")
        {
            Directory.CreateDirectory(_dir);
            File = Path.Combine(_dir, file);
            var name = Path.GetFileNameWithoutExtension(file);
            System.IO.File.WriteAllText(File,
                "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<TcPlcObject Version=\"1.1.0.1\">\n" +
                $"  <{element} Name=\"{name}\" Id=\"{{{Guid.NewGuid()}}}\" SpecialFunc=\"None\">\n" +
                $"    <Declaration><![CDATA[{name}]]></Declaration>\n  </{element}>\n</TcPlcObject>\n");
            Project = Path.Combine(_dir, "Plc.plcproj");
            System.IO.File.WriteAllText(Project,
                "<Project xmlns=\"http://schemas.microsoft.com/developer/msbuild/2003\"><ItemGroup>" +
                $"<Compile Include=\"{file}\">{entry}</Compile></ItemGroup></Project>");
        }
        public void Dispose() => Directory.Delete(_dir, recursive: true);
    }

    internal const string SubType = "<SubType>Code</SubType>";

    internal static ItemContent Read(Saved saved, Pou pou) => BoundDriver(saved.Project).ReadContent(TcRefs.Ref(pou));

    // ── an item's own flag ───────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Defect 3 (C39): an exclusion the IDE holds and has not saved — the <c>.plcproj</c> entry still says
    /// nothing — pulls as the excluded object it is, in the text CODESYS pulls for one (wire parity).</summary>
    [Fact]
    public void An_item_excluded_in_the_IDE_and_not_yet_saved_pulls_EXCLUDE_FROM_BUILD()
    {
        using var saved = new Saved(SubType);
        var read = Read(saved, new Pou(saved.File, "True"));

        Assert.True(read.Properties.ExcludeFromBuild);
        Assert.Equal(WireParityCases.ExcludedFunctionBlock, StWriter.Write(read));
    }

    /// <summary>…and a SAVED exclusion pulls the same (the entry is the save's copy of the live flag).</summary>
    [Fact]
    public void An_item_excluded_and_saved_pulls_EXCLUDE_FROM_BUILD()
    {
        using var saved = new Saved(SubType + "<ExcludeFromBuild>true</ExcludeFromBuild>");
        Assert.Equal(WireParityCases.ExcludedFunctionBlock, StWriter.Write(Read(saved, new Pou(saved.File, "True"))));
    }

    /// <summary>Defect 2 (C39): a re-included item keeps <c>&lt;ExcludeFromBuild&gt;false&lt;/ExcludeFromBuild&gt;</c> in its
    /// saved entry — an ordinary child that refused it forever. It pulls as the built object it is.</summary>
    [Fact]
    public void A_re_included_item_whose_saved_entry_still_holds_ExcludeFromBuild_false_pulls_as_built()
    {
        using var saved = new Saved(SubType + "<ExcludeFromBuild>false</ExcludeFromBuild>");
        Assert.Equal(ObjectProperties.None, Read(saved, new Pou(saved.File, "False")).Properties);
    }

    /// <summary>Defect 3, the other way (C39): re-included in the IDE, not yet saved — the entry still says
    /// <c>true</c>. It pulls as built, which is what the IDE builds (D45).</summary>
    [Fact]
    public void An_item_re_included_in_the_IDE_and_not_yet_saved_pulls_as_built()
    {
        using var saved = new Saved(SubType + "<ExcludeFromBuild>true</ExcludeFromBuild>");
        Assert.Equal(ObjectProperties.None, Read(saved, new Pou(saved.File, "False")).Properties);
    }

    /// <summary>A saved build entry that is no copy of a live property (C39, C40) is still refused by name.</summary>
    [Fact]
    public void Another_saved_build_entry_is_still_refused_by_name()
    {
        using var saved = new Saved(SubType + "<DependentUpon>FB_Y.TcPOU</DependentUpon>");
        var ex = Assert.Throws<BridgeException>(() => Read(saved, new Pou(saved.File, "False")));
        Assert.Contains("<DependentUpon>", ex.Message);
    }

    /// <summary>An item read as excluded by a folder above it is named by the walk and never read; one read here is a
    /// folder exclusion the walk did not see — refused by name, never pulled as built.</summary>
    [Fact]
    public void An_item_read_as_excluded_by_a_folder_is_refused_by_name()
    {
        using var saved = new Saved(SubType);
        var ex = Assert.Throws<BridgeException>(() => Read(saved, new Pou(saved.File, "Inherited")));
        Assert.Contains("'FB_X'", ex.Message);
        Assert.Contains("C39", ex.Message);
    }

    /// <summary>An item that publishes no <c>Exclude</c> property is refused by name — not read as built.</summary>
    [Fact]
    public void An_item_publishing_no_Exclude_property_is_refused_by_name()
    {
        using var saved = new Saved(SubType);
        var ex = Assert.Throws<BridgeException>(() => Read(saved, new Pou(saved.File, null)));
        Assert.Contains("no Exclude property", ex.Message);
    }

    // ── a member's own flag ──────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>A member excluded by its own flag pulls <c>%EXCLUDE_FROM_BUILD</c> (it was read as built); one read as
    /// excluded by its POU (<c>readonly</c>, C39) has no flag of its own — the POU's line says it.</summary>
    [Fact]
    public void A_member_pulls_its_own_flag_and_none_inherited_from_its_POU()
    {
        using var saved = new Saved(SubType);
        var built = Read(saved, new Pou(saved.File, "False",
            new Member("Run", ItemKind.PlcMethod, "METHOD Run : BOOL", "True"),
            new Member("Stop", ItemKind.PlcMethod, "METHOD Stop : BOOL", "False")));
        Assert.True(built.Members.Single(m => m.Name == "Run").Properties.ExcludeFromBuild);
        Assert.False(built.Members.Single(m => m.Name == "Stop").Properties.ExcludeFromBuild);

        var excluded = Read(saved, new Pou(saved.File, "True", new Member("Run", ItemKind.PlcMethod, "METHOD Run : BOOL", "Inherited")));
        Assert.True(excluded.Properties.ExcludeFromBuild);
        Assert.Equal(ObjectProperties.None, Assert.Single(excluded.Members).Properties);
    }

    // ── the push ─────────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void A_pushed_EXCLUDE_FROM_BUILD_passes_the_pre_flight_on_an_item_and_a_member() =>
        new BeckhoffDriver(new TcObjectModel()).ValidateProperties("'FB_X'", ObjectProperties.None with { ExcludeFromBuild = true },
                                                                  create: true);

    /// <summary>A push writes the live flag through <c>ConsumeXml</c> of that one property, both ways, and reads it back;
    /// an unchanged flag is not written.</summary>
    [Fact]
    public void A_pushed_exclusion_is_written_to_the_live_flag_and_its_removal_clears_it()
    {
        using var saved = new Saved(SubType);
        var pou = new Pou(saved.File, "False");
        var driver = BoundDriver(saved.Project);
        var pulled = driver.ReadContent(TcRefs.Ref(pou));

        driver.WriteContent(TcRefs.Ref(pou), pulled, Array.Empty<PushedNetworkBody>());
        Assert.Empty(pou.Consumes);

        driver.WriteContent(TcRefs.Ref(pou), pulled with { Properties = ObjectProperties.None with { ExcludeFromBuild = true } },
                            Array.Empty<PushedNetworkBody>());
        Assert.Equal("True", pou.Exclude);
        Assert.Equal("True", Consumed(Assert.Single(pou.Consumes)));

        driver.WriteContent(TcRefs.Ref(pou), pulled, Array.Empty<PushedNetworkBody>());
        Assert.Equal("False", pou.Exclude);
        Assert.Equal(2, pou.Consumes.Count);
    }

    /// <summary>A member's flag is written on the member's own node.</summary>
    [Fact]
    public void A_pushed_member_exclusion_is_written_to_the_members_flag()
    {
        using var saved = new Saved(SubType);
        var run = new Member("Run", ItemKind.PlcMethod, "METHOD Run : BOOL", "False");
        var pou = new Pou(saved.File, "False", run);
        var driver = BoundDriver(saved.Project);
        var pulled = driver.ReadContent(TcRefs.Ref(pou));
        var member = Assert.Single(pulled.Members);

        driver.WriteContent(TcRefs.Ref(pou), pulled with
        {
            Members = new List<Volt.Engine.Item.Member> { member with { Properties = ObjectProperties.None with { ExcludeFromBuild = true } } },
        }, Array.Empty<PushedNetworkBody>());

        Assert.Equal("True", run.Exclude);
        Assert.Empty(pou.Consumes);
    }

    /// <summary>A member's own flag inside a POU the text excludes is refused before anything is written: TwinCAT holds no
    /// flag of its own for a member of an excluded POU (C39).</summary>
    [Fact]
    public void A_member_flag_inside_an_excluded_POU_is_refused_before_anything_is_written()
    {
        using var saved = new Saved(SubType);
        var run = new Member("Run", ItemKind.PlcMethod, "METHOD Run : BOOL", "False");
        var pou = new Pou(saved.File, "False", run);
        var driver = BoundDriver(saved.Project);
        var pulled = driver.ReadContent(TcRefs.Ref(pou));
        var excluded = ObjectProperties.None with { ExcludeFromBuild = true };

        var ex = Assert.Throws<BridgeException>(() => driver.WriteContent(TcRefs.Ref(pou), pulled with
        {
            Properties = excluded,
            Members = new List<Volt.Engine.Item.Member> { pulled.Members[0] with { Properties = excluded, Declaration = "METHOD Run : INT" } },
        }, Array.Empty<PushedNetworkBody>()));

        Assert.Contains("'Run'", ex.Message);
        Assert.Equal("METHOD Run : BOOL", run.DeclarationText);
        Assert.Empty(pou.Consumes);
        Assert.Empty(run.Consumes);
    }

    // ── a folder ─────────────────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Defect 1 (C39): a folder excluded in the IDE — saved or not; its flag lives on no item — is answered as
    /// CODESYS answers one, entry for entry (wire parity): the folder in <c>unreadableNodes</c>, every item under it named
    /// by its kind and none pulled as a built one. What sits beside it is pulled, and the walk stays complete.</summary>
    [Fact]
    public void A_folder_excluded_in_the_IDE_names_its_items_and_pulls_none_as_built()
    {
        var (driver, _, _, _) = Project(x => new Node(x, "Untitled2 Project", ItemKind.PlcFolder, false,
            new Folder(x, "Sim", "True",
                new Node(x, "SimType", ItemKind.PlcDutStruct),
                new Folder(x, "Deep", "Inherited", new Node(x, "DeepType", ItemKind.PlcDutStruct))),
            new Node(x, "Kept", ItemKind.PlcDutStruct)));

        var walk = driver.WalkItems().Gated();

        Assert.Equal(WireParityCases.ExcludedFolderEntries(App),
                     walk.UnreadableObjects.Select(o => (o.Name, o.Folder, o.Reason, o.Kind)).ToArray());
        Assert.DoesNotContain(walk.Items, i => i.Name is "SimType" or "DeepType");
        Assert.Contains(walk.Items, i => i.Name == "Kept");
        Assert.True(walk.Complete);
    }

    /// <summary>A built folder is walked as any folder.</summary>
    [Fact]
    public void A_built_folder_is_walked()
    {
        var (driver, _, _, _) = Project(x => new Node(x, "Untitled2 Project", ItemKind.PlcFolder, false,
            new Folder(x, "Sim", "False", new Node(x, "SimType", ItemKind.PlcDutStruct))));

        var walk = driver.WalkItems().Gated();

        Assert.Empty(walk.UnreadableObjects);
        Assert.Contains(walk.Items, i => i.Name == "SimType" && i.Folder == App + "/Sim");
    }

    /// <summary>A folder that publishes no <c>Exclude</c> property is named, and nothing under it is read as deleted.</summary>
    [Fact]
    public void A_folder_publishing_no_Exclude_property_is_named_and_hides_nothing_beneath_it()
    {
        var (driver, _, _, _) = Project(x => new Node(x, "Untitled2 Project", ItemKind.PlcFolder, false,
            new Folder(x, "Sim", null, new Node(x, "SimType", ItemKind.PlcDutStruct))));

        var walk = driver.WalkItems().Gated();

        var node = Assert.Single(walk.UnreadableObjects);
        Assert.Equal(("Sim", ItemKind.Kinds.Folder), (node.Name, node.Kind));
        Assert.Contains(App + "/Sim", walk.UnwalkedFolders);
        Assert.DoesNotContain(walk.Items, i => i.Name == "SimType");
    }
}
