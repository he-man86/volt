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
/// for an accessor the file does not hold, <c>""</c> for one that holds no <c>&lt;Declaration&gt;</c>).</summary>
internal sealed record TcSavedFacts(string File, string? SpecialFunc, IReadOnlyList<string> ObjectPropertyClasses,
                                    IReadOnlyDictionary<string, (string? Get, string? Set)> InterfaceAccessors,
                                    TcExclusion Exclusion);

/// <summary>Whether the IDE builds a tree node, as its LIVE <c>Exclude</c> property answers (DIALECT C39): <c>False</c>
/// is <see cref="Built"/>; <c>True</c> is the node's <see cref="Own"/> flag, or <see cref="Inherited"/> when the IDE marks
/// the property <c>readonly</c> — the node sits under an excluded folder (or, for a member, in an excluded POU).</summary>
internal enum TcExclusion { Built, Own, Inherited }

internal sealed partial class TcObjectModel
{
    /// <summary>The node's live exclusion (DIALECT C39): its <c>ProduceXml</c>'s <c>Exclude</c> VSProperty, which TwinCAT
    /// answers from memory, saved or not, and which holds an exclusion inherited from a folder. Null only for a node that
    /// answers no automation XML at all — no TwinCAT tree item does; it is the offline doubles' shape.</summary>
    /// <param name="what">The node, as a refusal names it — formatted only when one is thrown.</param>
    public TcExclusion? Exclusion(object node, Func<string> what)
    {
        string? xml;
        try { xml = ((dynamic)node).ProduceXml(false) as string; }
        catch (Microsoft.CSharp.RuntimeBinder.RuntimeBinderException) { return null; }   // no automation XML: no tree item
        if (string.IsNullOrEmpty(xml))
            throw new BridgeException(BridgeErrorCodes.Unreadable,
                $"{what()}: TwinCAT answers no item XML for it — Volt reads its Exclude property there, so it is not " +
                "pulled rather than pulled as a built one.");
        return ExclusionOf(XDocument.Parse(xml!).Root, what);
    }

    /// <summary>The <c>Exclude</c> VSProperty of a node's item XML. Every PLC item, member and folder publishes it (C39);
    /// one that does not, or a value other than <c>True</c>/<c>False</c>, is refused by name — never read as built.</summary>
    private static TcExclusion ExclusionOf(XElement? item, Func<string> what)
    {
        var property = item?.Element("VSProperties")?.Elements("VSProperty")
                           .FirstOrDefault(p => (string?)p.Element("Name") == "Exclude")
            ?? throw new BridgeException(BridgeErrorCodes.Unreadable,
                $"{what()}: TwinCAT publishes no Exclude property for it — Volt reads whether the IDE builds it there " +
                "(DIALECT C39), so it is not pulled rather than pulled as a built one.");
        var value = (string?)property.Element("Value");
        if (value == "False") return TcExclusion.Built;
        if (value != "True")
            throw new BridgeException(BridgeErrorCodes.Unreadable,
                $"{what()}: its Exclude property reads '{value}' — neither True nor False (DIALECT C39), so it is not pulled.");
        return (string?)property.Attribute("readonly") == "true" ? TcExclusion.Inherited : TcExclusion.Own;
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
    /// review of step 3, finding 6): it used to read as an object with no properties, so an excluded object whose file
    /// could not be found pulled as a built one. Null only for a node that answers no automation XML at all — no TwinCAT
    /// tree item does; it is the offline doubles' shape.</summary>
    /// <param name="what">The item, as a refusal names it — formatted only when one is thrown.</param>
    public TcSavedFacts? SavedFacts(object node, Func<string> what)
    {
        // The file's own facts are read here; the .plcproj entry only when the caller asks (`CompileEntry`), after the file
        // has been judged — a refusal by the file needs no project read.
        string? xml;
        try { xml = ((dynamic)node).ProduceXml(false) as string; }
        catch (Microsoft.CSharp.RuntimeBinder.RuntimeBinderException) { return null; }   // no automation XML: no tree item
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
        // The live exclusion, from the same XML: the item's own flag, or one inherited from a folder (C39).
        var exclusion = ExclusionOf(item, what);
        if (!File.Exists(path))
            throw new BridgeException(BridgeErrorCodes.Unreadable,
                $"{what()}: its saved file '{path}' is not on disk — save the project in the IDE (File > Save All) and pull " +
                "again; Volt reads that file for what the text cannot say, so it is not pulled without it.");

        var doc = XDocument.Load(path!, LoadOptions.PreserveWhitespace);
        var obj = doc.Root?.Elements().FirstOrDefault()
            ?? throw new BridgeException(BridgeErrorCodes.Unreadable, $"twincat: '{path}' holds no object element");
        var special = (string?)obj.Attribute("SpecialFunc");
        var classes = doc.Descendants().Where(e => e.Name.LocalName == "ObjectProperties")
            .SelectMany(op => op.Descendants().Where(e => e.Name.LocalName == "o" && e.Attribute("t") is not null)
                                .Select(e => (string)e.Attribute("t")!)
                                .Where(t => t.EndsWith("Property", StringComparison.Ordinal))
                                .DefaultIfEmpty(op.HasElements ? "(an archive Volt cannot name)" : ""))
            .Where(c => c.Length > 0).Distinct().ToList();
        var accessors = new Dictionary<string, (string?, string?)>(StringComparer.OrdinalIgnoreCase);
        if (obj.Name.LocalName == "Itf")
            foreach (var p in obj.Descendants().Where(e => e.Name.LocalName == "Property" && e.Attribute("Name") is not null))
                accessors[(string)p.Attribute("Name")!] = (StoredDeclaration(p, "Get"), StoredDeclaration(p, "Set"));
        return new TcSavedFacts(path!, special, classes, accessors, exclusion);
    }

    /// <summary>An interface property accessor's stored declaration, line ends as LF: null when the property holds no such
    /// accessor, <c>""</c> when the accessor holds no <c>&lt;Declaration&gt;</c>.</summary>
    private static string? StoredDeclaration(XElement property, string accessor) =>
        property.Elements().FirstOrDefault(e => e.Name.LocalName == accessor) is not { } a ? null
            : (a.Elements().FirstOrDefault(e => e.Name.LocalName == "Declaration")?.Value ?? "").Replace("\r\n", "\n");

    /// <summary>The child elements of the <c>.plcproj</c>'s <c>&lt;Compile Include&gt;</c> entry for
    /// <paramref name="file"/> — none when the saved project does not list it yet (a new object, before the project is
    /// saved: TwinCAT writes the source file at the create and the <c>.plcproj</c> on save). Exclusion is not read here:
    /// the saved <c>&lt;ExcludeFromBuild&gt;</c> lags the IDE until a save and never holds a folder's, so the live
    /// <c>Exclude</c> property decides it (<see cref="Exclusion"/>, C39).
    ///
    /// <para><b>Every entry, wherever its file is</b> (gate review of step 3, finding 6): an <c>Include</c> is resolved
    /// against the project's folder and compared as a full path, so a LINKED file outside it (<c>..\Shared\X.TcPOU</c>)
    /// is found.</para>
    ///
    /// <para><b>Read once per saved project</b> (finding 11): the <c>.plcproj</c> is parsed into a map the first time and
    /// again only when the file on disk changes (its write time and length) — it was a PLC-node <c>ProduceXml</c> and a
    /// whole-project <c>XDocument.Load</c> PER ITEM, O(items) project loads per pull.</para></summary>
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
