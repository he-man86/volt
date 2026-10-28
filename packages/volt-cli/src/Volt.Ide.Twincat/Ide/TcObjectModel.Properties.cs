using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Xml.Linq;
using Volt.Contracts;
using Volt.Engine;

namespace Volt.Ide.Twincat;

/// <summary>What TwinCAT keeps of an object BESIDE its text, in the files it saves (openspec <c>bridge-one-to-one</c> §1.1
/// "TwinCAT and the object-property lines", census §0.1 findings 12-13): the source file's <c>@SpecialFunc</c>, its
/// <c>&lt;ObjectProperties&gt;</c> archives, and — for an interface — each property accessor's stored
/// <c>&lt;Declaration&gt;</c> (<see cref="InterfaceAccessors"/>: property name → the GET's and the SET's declaration, null
/// for an accessor the file does not hold).</summary>
internal sealed record TcSavedFacts(string File, string? SpecialFunc, IReadOnlyList<string> ObjectPropertyClasses,
                                    IReadOnlyDictionary<string, (string? Get, string? Set)> InterfaceAccessors,
                                    TcBuild Build);

/// <summary>Whether the IDE builds a tree node, as its LIVE <c>Exclude</c> property answers (DIALECT C39): <c>False</c>
/// is <see cref="Built"/>; <c>True</c> is the node's <see cref="Own"/> flag, or <see cref="Inherited"/> — <c>True</c> marked
/// <c>readonly</c>, read only where C39 measured it: on a member of an excluded POU (the walk reads nothing under an
/// excluded folder). Any other <c>readonly</c> <c>Exclude</c> is refused by name (<c>TcObjectModel.ExclusionOf</c>).</summary>
internal enum TcExclusion { Built, Own, Inherited }

/// <summary>A PLC item's or member's build properties, as its LIVE <c>Advanced</c> VSProperties answer them (DIALECT C39,
/// C40): its exclusion, <c>LinkAlways</c>, <c>External</c> and <c>CompilerDefines</c> (null for the empty value) — the
/// <c>%EXCLUDE_FROM_BUILD</c>, <c>%LINK_ALWAYS</c>, <c>%EXTERNAL</c> and <c>%COMPILER_DEFINES</c> lines.</summary>
internal sealed record TcBuild(TcExclusion Exclusion, bool LinkAlways, bool External, string? CompilerDefines);

internal sealed partial class TcObjectModel
{
    /// <summary>The build properties a PLC item and member publish beside <c>Exclude</c> (C40), by their VSProperty name.</summary>
    internal const string LinkAlwaysProperty = "LinkAlways", ExternalProperty = "External",
                          CompilerDefinesProperty = "CompilerDefines", AdditionalAllocationProperty = "AdditionalAllocation";

    /// <summary>Every build property C40 measured as the object's own value, never <c>readonly</c>.</summary>
    private static readonly string[] OwnBuildProperties =
        { LinkAlwaysProperty, ExternalProperty, CompilerDefinesProperty, AdditionalAllocationProperty };

    /// <summary>The node's live build properties (C39, C40), from its <c>ProduceXml</c>, which TwinCAT answers from memory,
    /// saved or not — every TwinCAT tree item does (T2: the offline doubles answer it too, so no branch is theirs).</summary>
    /// <param name="what">The node, as a refusal names it — formatted only when one is thrown.</param>
    /// <param name="ownerExcluded">The node is a member of a POU whose own <c>Exclude</c> is set — the one place Volt reads
    /// a <c>readonly</c> exclusion as inherited (C39). False for an item: the walk reads nothing under an excluded folder.</param>
    public TcBuild Build(object node, Func<string> what, bool ownerExcluded)
    {
        var xml = ((dynamic)node).ProduceXml(false) as string;
        if (string.IsNullOrEmpty(xml))
            throw new BridgeException(BridgeErrorCodes.Unreadable,
                $"{what()}: TwinCAT answers no item XML for it — Volt reads its build properties there, so it is not " +
                "pulled rather than pulled without them.");
        return BuildOf(XDocument.Parse(xml!).Root, what, ownerExcluded);
    }

    /// <summary>The build properties of a node's item XML. Every PLC item and member publishes <c>LinkAlways</c>,
    /// <c>External</c> and <c>CompilerDefines</c> as its own value — never <c>readonly</c>, under an excluded folder or POU
    /// too (C40) — and a POU its <c>AdditionalAllocation</c> the same way. Any of them <c>readonly</c> refuses the object,
    /// naming EVERY read-only one (a field report could not tell whether one or all were); one missing, or a flag other
    /// than <c>True</c>/<c>False</c>, is refused by name, never read as unset. <c>AdditionalAllocation</c> has no line (C40):
    /// a value other than <c>0</c> refuses the object by name.</summary>
    private static TcBuild BuildOf(XElement? item, Func<string> what, bool ownerExcluded)
    {
        var readOnly = OwnBuildProperties.Where(n => VsProperty(item, n)?.Attribute("readonly") is not null).ToList();
        if (readOnly.Count > 0)
            throw new BridgeException(BridgeErrorCodes.Unreadable,
                $"{what()}: TwinCAT marks read-only its {string.Join(", ", readOnly)} —" +
                " Volt has measured every build property only as the object's own value (DIALECT C40), so it " +
                "is not pulled.");
        var exclusion = ExclusionOf(item, what, ownerExcluded);
        if (VsProperty(item, AdditionalAllocationProperty) is not null
            && Own(item, AdditionalAllocationProperty, what) is var bytes && bytes != "0")
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"{what()}: its AdditionalAllocation is '{bytes}' — a build property Volt's text has no line for (DIALECT " +
                "C40), so the object is not pulled rather than pulled without it. Set it to 0 in the IDE, or edit the " +
                "object there.");
        var defines = Own(item, CompilerDefinesProperty, what);
        return new TcBuild(exclusion, Flag(item, LinkAlwaysProperty, what), Flag(item, ExternalProperty, what),
                           defines.Length == 0 ? null : defines);
    }

    private static XElement? VsProperty(XElement? item, string name) =>
        item?.Element("VSProperties")?.Elements("VSProperty").FirstOrDefault(p => (string?)p.Element("Name") == name);

    /// <summary>The value of the node's own, writable build property <paramref name="name"/> (C40) — a read-only one never
    /// reaches here: <see cref="BuildOf"/> refused it first.</summary>
    private static string Own(XElement? item, string name, Func<string> what)
    {
        var property = VsProperty(item, name)
            ?? throw new BridgeException(BridgeErrorCodes.Unreadable,
                $"{what()}: TwinCAT publishes no {name} property for it — Volt reads that build property there (DIALECT " +
                "C40), so it is not pulled rather than pulled without it.");
        // `<Value />` when empty (C40); no `<Value>` at all is unmeasured — refused, never read as the empty value.
        return (string?)property.Element("Value")
            ?? throw new BridgeException(BridgeErrorCodes.Unreadable,
                $"{what()}: its {name} property holds no Value — TwinCAT publishes `<Value />` for an empty one (DIALECT " +
                "C40), so it is not pulled rather than pulled as empty.");
    }

    private static bool Flag(XElement? item, string name, Func<string> what) =>
        Own(item, name, what) switch
        {
            "True" => true,
            "False" => false,
            var other => throw new BridgeException(BridgeErrorCodes.Unreadable,
                $"{what()}: its {name} property reads '{other}' — neither True nor False (DIALECT C40), so it is not pulled."),
        };

    /// <summary>Set the node's own build property <paramref name="name"/> to <paramref name="value"/> through
    /// <c>ConsumeXml</c> of that one property (C40), and READ IT BACK: a write the IDE accepted and did not apply is refused
    /// by name, never reported as landed.</summary>
    public void WriteBuildProperty(object node, string name, string value, Func<string> what)
    {
        ((dynamic)node).ConsumeXml(new XElement("TreeItem", new XElement("VSProperties", new XElement("VSProperty",
            new XElement("Name", name), new XElement("Value", value)))).ToString(SaveOptions.DisableFormatting));
        var xml = ((dynamic)node).ProduceXml(false) as string;
        var now = string.IsNullOrEmpty(xml) ? null : (string?)VsProperty(XDocument.Parse(xml!).Root, name)?.Element("Value");
        if (now != value)
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"{what()}: TwinCAT took {name}='{value}' and reads '{now}' back — the write did not land (DIALECT C40).");
    }
    /// <summary>The live exclusion (DIALECT C39) of a node no excluded POU holds — a folder the walk reached, an item, a
    /// member being written: its <c>ProduceXml</c>'s <c>Exclude</c> VSProperty, which TwinCAT answers from memory, saved or
    /// not. Never <see cref="TcExclusion.Inherited"/>: a <c>readonly</c> one is refused by name (<see cref="ExclusionOf"/>).</summary>
    /// <param name="what">The node, as a refusal names it — formatted only when one is thrown.</param>
    public TcExclusion Exclusion(object node, Func<string> what)
    {
        var xml = ((dynamic)node).ProduceXml(false) as string;
        if (string.IsNullOrEmpty(xml))
            throw new BridgeException(BridgeErrorCodes.Unreadable,
                $"{what()}: TwinCAT answers no item XML for it — Volt reads its Exclude property there, so it is not " +
                "pulled rather than pulled as a built one.");
        return ExclusionOf(XDocument.Parse(xml!).Root, what, ownerExcluded: false);
    }

    /// <summary>The <c>Exclude</c> VSProperty of a node's item XML — EXACTLY THE MEASURED MEANINGS (C39). Every PLC item,
    /// member and folder publishes it; one that does not, or a value other than <c>True</c>/<c>False</c>, is refused by
    /// name — never read as built. Not <c>readonly</c>: the node's own flag. <c>readonly</c> <c>True</c>: inherited — C39
    /// measured it only on what an excluded folder or POU holds, so it reads <see cref="TcExclusion.Inherited"/> only on a
    /// member whose POU is excluded (<paramref name="ownerExcluded"/>), where EVERY member reads it, its own flag included.
    /// Anything else is refused by name: a <c>readonly</c> one where nothing above was read as excluded (TwinCAT publishing
    /// an object's OWN exclusion read-only would otherwise pull an excluded object as inherited, i.e. as built — openspec
    /// <c>twincat-readonly-build-properties</c>), a writable one inside an excluded POU, a <c>readonly</c> <c>False</c>.</summary>
    private static TcExclusion ExclusionOf(XElement? item, Func<string> what, bool ownerExcluded)
    {
        var property = item?.Element("VSProperties")?.Elements("VSProperty")
                           .FirstOrDefault(p => (string?)p.Element("Name") == "Exclude")
            ?? throw new BridgeException(BridgeErrorCodes.Unreadable,
                $"{what()}: TwinCAT publishes no Exclude property for it — Volt reads whether the IDE builds it there " +
                "(DIALECT C39), so it is not pulled rather than pulled as a built one.");
        var value = (string?)property.Element("Value");
        if (value is not ("True" or "False"))
            throw new BridgeException(BridgeErrorCodes.Unreadable,
                $"{what()}: its Exclude property reads '{value}' — neither True nor False (DIALECT C39), so it is not pulled.");
        var readOnly = property.Attribute("readonly") is not null;
        var read = readOnly ? value + " read-only" : value;
        if (ownerExcluded)
            return readOnly && value == "True" ? TcExclusion.Inherited
                : throw new BridgeException(BridgeErrorCodes.Unreadable,
                    $"{what()}: it sits in an excluded POU and TwinCAT reads its Exclude as {read} — Volt has measured every " +
                    "member of an excluded POU reading True read-only (DIALECT C39), so it is not pulled.");
        if (readOnly)
            throw new BridgeException(BridgeErrorCodes.Unreadable,
                $"{what()}: TwinCAT reads its Exclude as {read}, and nothing above it that Volt read is excluded — Volt has " +
                "measured a read-only Exclude only on what an excluded folder or POU holds (DIALECT C39), so whether the " +
                "IDE builds it cannot be read; it is not pulled.");
        return value == "True" ? TcExclusion.Own : TcExclusion.Built;
    }

    /// <summary>Set the node's own <c>Exclude</c> flag through <c>ConsumeXml</c> of that one property (C39), and READ IT
    /// BACK: a write the IDE accepted and did not apply is refused by name, never reported as landed.</summary>
    public void WriteExclusion(object node, bool exclude, Func<string> what)
    {
        var value = exclude ? "True" : "False";
        ((dynamic)node).ConsumeXml(
            $"<TreeItem><VSProperties><VSProperty><Name>Exclude</Name><Value>{value}</Value></VSProperty></VSProperties></TreeItem>");
        var now = Exclusion(node, what);
        if (now != (exclude ? TcExclusion.Own : TcExclusion.Built))
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"{what()}: TwinCAT took Exclude={value} and reads {now} back — the write did not land (DIALECT C39).");
    }

    /// <summary>The object's saved facts, read from the file the item publishes as its <c>FullPath</c> (the census read
    /// the same files). An item that publishes no <c>FullPath</c>, or one that is not on disk, is REFUSED BY NAME (gate
    /// review of step 3, finding 6) — read as an object with no properties, an excluded object whose file cannot be
    /// found would pull as a built one.</summary>
    /// <param name="what">The item, as a refusal names it — formatted only when one is thrown.</param>
    public TcSavedFacts SavedFacts(object node, Func<string> what)
    {
        // The file's own facts are read here; the .plcproj entry only when the caller asks (`CompileEntry`), after the file
        // has been judged — a refusal by the file needs no project read.
        var xml = ((dynamic)node).ProduceXml(false) as string;
        if (string.IsNullOrEmpty(xml))
            throw new BridgeException(BridgeErrorCodes.Unreadable,
                $"{what()}: TwinCAT answers no item XML for it — Volt reads its saved file for what the text cannot say, so " +
                "it is not pulled rather than pulled as an object with no properties.");
        var item = XDocument.Parse(xml!).Root;
        var path = item?.Element("VSProperties")?.Elements("VSProperty")
            .FirstOrDefault(p => (string?)p.Element("Name") == "FullPath")?.Element("Value")?.Value;
        if (string.IsNullOrEmpty(path))
            throw new BridgeException(BridgeErrorCodes.Unreadable,
                $"{what()}: TwinCAT publishes no FullPath for it — Volt reads its saved file for what the text cannot say " +
                "(its special function, its object properties, its build entry), so it is not pulled rather than pulled " +
                "as an object with none.");
        // The live build properties, from the same XML: the exclusion (own, or inherited from a folder, C39) and the rest (C40).
        var build = BuildOf(item, what, ownerExcluded: false);
        if (!File.Exists(path))
            throw new BridgeException(BridgeErrorCodes.Unreadable,
                $"{what()}: its saved file '{path}' is not on disk — save the project in the IDE (File > Save All) and pull " +
                "again; Volt reads that file for what the text cannot say, so it is not pulled without it.");

        var doc = XDocument.Load(path!, LoadOptions.PreserveWhitespace);
        var obj = doc.Root?.Elements().FirstOrDefault()
            ?? throw new BridgeException(BridgeErrorCodes.Unreadable, $"twincat: '{path}' holds no object element");
        // Every POU TwinCAT saves states its SpecialFunc (all 46 vendor-written .TcPOU files, `None` on an ordinary POU); a
        // DUT, GVL or interface saves none (every recording). A POU without it is refused, never read as `None`.
        var special = (string?)obj.Attribute("SpecialFunc");
        if (special is null && obj.Name.LocalName == "POU")
            throw new BridgeException(BridgeErrorCodes.Unreadable,
                $"{what()}: its saved file '{path}' states no SpecialFunc, which TwinCAT writes on every POU — save the " +
                "project in the IDE (File > Save All) and pull again.");
        var classes = doc.Descendants().Where(e => e.Name.LocalName == "ObjectProperties")
            .SelectMany(op => op.Descendants().Where(e => e.Name.LocalName == "o" && e.Attribute("t") is not null)
                                .Select(e => (string)e.Attribute("t")!)
                                .Where(t => t.EndsWith("Property", StringComparison.Ordinal))
                                .DefaultIfEmpty(op.HasElements ? "(an archive Volt cannot name)" : ""))
            .Where(c => c.Length > 0).Distinct().ToList();
        var accessors = new Dictionary<string, (string?, string?)>(StringComparer.OrdinalIgnoreCase);
        if (obj.Name.LocalName == "Itf")
            foreach (var p in obj.Descendants().Where(e => e.Name.LocalName == "Property"))
                // Every `<Property>` TwinCAT saves carries a Name (every recording: ITF1.TcIO, MembersSt/MembersHidden.TcPOU).
                // A nameless one is refused HERE: skipped, its accessors read as "not in the saved file" with a save remedy
                // that cannot help.
                accessors[(string?)p.Attribute("Name") is { Length: > 0 } name ? name
                    : throw new BridgeException(BridgeErrorCodes.Unreadable,
                        $"{what()}: its saved file '{Path.GetFileName(path)}' holds a <Property> with no Name — TwinCAT names " +
                        "every property it saves, so the interface is not pulled rather than pulled without that property's " +
                        "accessors.")]
                    = (StoredDeclaration(p, "Get", what), StoredDeclaration(p, "Set", what));
        return new TcSavedFacts(path!, special, classes, accessors, build);
    }

    /// <summary>An interface property accessor's stored declaration, line ends as LF: null when the property holds no such
    /// accessor. An accessor holding no <c>&lt;Declaration&gt;</c> element is neither measured form (the constant, or the
    /// empty <c>&lt;![CDATA[]]&gt;</c> of a 3.1.4024.16 save, <c>ITF1.TcIO</c>): refused by name, never read as empty.</summary>
    private static string? StoredDeclaration(XElement property, string accessor, Func<string> what)
    {
        if (property.Elements().FirstOrDefault(e => e.Name.LocalName == accessor) is not { } a) return null;
        var declaration = a.Elements().FirstOrDefault(e => e.Name.LocalName == "Declaration")
            ?? throw new BridgeException(BridgeErrorCodes.Unreadable,
                $"{what()}: its property '{(string?)property.Attribute("Name")}' {accessor.ToUpperInvariant()} is saved with " +
                "no <Declaration> — TwinCAT saves one on every interface accessor (tc-itf-accessor-decl, ITF1.TcIO), so " +
                "the interface is not pulled rather than pulled with that accessor read as empty.");
        return declaration.Value.Replace("\r\n", "\n");
    }

    /// <summary>The child elements of the <c>.plcproj</c>'s <c>&lt;Compile Include&gt;</c> entry for
    /// <paramref name="file"/> — none when the saved project does not list it yet (a new object, before the project is
    /// saved: TwinCAT writes the source file at the create and the <c>.plcproj</c> on save). No build property is read
    /// here: the saved <c>&lt;ExcludeFromBuild&gt;</c>, <c>&lt;LinkAlways&gt;</c>, <c>&lt;External&gt;</c>,
    /// <c>&lt;CompilerDefines&gt;</c> and <c>&lt;AdditionalAllocation&gt;</c> lag the IDE until a save, so the live
    /// properties decide them (<see cref="Build"/>, C39, C40).
    ///
    /// <para><b>Every entry, wherever its file is</b> (gate review of step 3, finding 6): an <c>Include</c> is resolved
    /// against the project's folder and compared as a full path, so a LINKED file outside it (<c>..\Shared\X.TcPOU</c>)
    /// is found.</para>
    ///
    /// <para><b>Read once per saved project</b> (finding 11): the <c>.plcproj</c> is parsed into a map the first time and
    /// again only when the file on disk changes (its write time and length) — not a PLC-node <c>ProduceXml</c> and a
    /// whole-project <c>XDocument.Load</c> PER ITEM.</para></summary>
    public IReadOnlyList<string> CompileEntry(string file)
    {
        var entries = CompileEntries();
        return entries.TryGetValue(Path.GetFullPath(file), out var e) ? e : Array.Empty<string>();
    }

    private string? _compileProject;
    private object? _compileProjectOf;
    private (string Path, DateTime Written, long Length, Dictionary<string, IReadOnlyList<string>> Entries)? _compileEntries;

    private Dictionary<string, IReadOnlyList<string>> CompileEntries()
    {
        EnsurePlc();
        // The .plcproj's path is the PLC project item's, asked once per bound PLC node (a new bind re-asks).
        if (_compileProject is null || !ReferenceEquals(_compileProjectOf, (object)_plcNode!))
        {
            _compileProject = Path.GetFullPath(PlcProjectFile(CurrentPlc));
            _compileProjectOf = _plcNode;
            _compileEntries = null;
        }
        var info = new FileInfo(_compileProject);
        if (!info.Exists)
            throw new BridgeException(BridgeErrorCodes.Unreadable,
                $"twincat: the PLC project file '{_compileProject}' is not on disk — save the project in the IDE and pull " +
                "again; Volt reads its build entries rather than assume an object is built.");
        if (_compileEntries is { } cached && cached.Path == _compileProject && cached.Written == info.LastWriteTimeUtc
            && cached.Length == info.Length)
            return cached.Entries;

        var dir = Path.GetDirectoryName(_compileProject)!;
        var entries = new Dictionary<string, IReadOnlyList<string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var e in XDocument.Load(_compileProject).Descendants().Where(e => e.Name.LocalName == "Compile"))
        {
            var include = (string?)e.Attribute("Include");
            if (string.IsNullOrEmpty(include)) continue;
            entries[Path.GetFullPath(Path.Combine(dir, include!))] = e.Elements().Select(c => c.Name.LocalName).ToList();
        }
        _compileEntries = (_compileProject, info.LastWriteTimeUtc, info.Length, entries);
        return entries;
    }
}
