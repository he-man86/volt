using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Format.Settings;

namespace Volt.Ide.Twincat;

/// <summary>
/// A TwinCAT PLC project's compiler settings, read from where TwinCAT itself keeps them (openspec
/// <c>twincat-project-settings</c>; DIALECT D37-D39) — the pure translation, XML in, <see cref="ProjectSettings"/>
/// out. The two documents are fetched by <c>TcObjectModel.ReadProjectSettingsSources</c>; the file layout is the
/// engine's <see cref="ProjectSettingsFormat"/>, shared with CODESYS.
///
/// <para><b>Two sources, chosen per row (gate-1 decision, task 1.1):</b></para>
/// <list type="bullet">
/// <item><b>Disabled warnings</b> — the <c>.plcproj</c> only (D37): its <c>PlcProjectOptions/XmlArchive</c> holds an
/// OptionKey <c>{8F99A816-E488-41E4-9FA3-846536012284}</c> whose <c>DisabledWarningIds</c> value is the bare ids
/// joined by <c>,</c>. The automation interface has no warning surface at all. This is SAVED state: an unchecked box
/// is seen once the project is saved.</item>
/// <item><b>Replace constants, Max compiler warnings, Project defines</b> — the automation interface,
/// <c>NestedProject.ProduceXml()</c> → <c>IECProjectDef/CompilerSettings/{ReplaceConstants, MaxWarnings,
/// CompilerDefines}</c> (D38). It answers the value IN EFFECT whether or not the <c>.plcproj</c> stores a key — the
/// file's <c>{E709B08B-..}</c> keys are absent until the Compile page is first changed, so a file reader would drop
/// both rows on every untouched project — and it is LIVE, as CODESYS's descriptor is.</item>
/// <item><b>Warnings as errors, Unicode identifiers, UTF-8 encoding, Breakpoint logging</b> — no TwinCAT source (D39):
/// <c>null</c>, so the row is omitted. Never a default.</item>
/// </list>
/// </summary>
internal static class TcProjectSettings
{
    /// <summary>The OptionKey the Compiler Warnings page writes (D37). The SubKeys hashtable keys it by the bare GUID;
    /// the key object's own <c>Name</c> carries it quoted.</summary>
    private const string WarningsKey = "{8F99A816-E488-41E4-9FA3-846536012284}";
    private const string DisabledIdsName = "DisabledWarningIds";

    /// <summary>The settings, from the <c>.plcproj</c> text and the NestedProject's <c>ProduceXml()</c>.</summary>
    public static ProjectSettings Read(string plcprojXml, string nestedProjectXml)
    {
        var compiler = CompilerSettings(nestedProjectXml);
        return new ProjectSettings(
            DisabledWarnings: DisabledWarningIds(plcprojXml),
            WarningsAsErrors: null,      // D39: the page has no third state; LanguageModelManager 3.5.13 has no member
            ReplaceConstants: compiler.ReplaceConstants,
            UnicodeIdentifiers: null,    // D39: no page, no AI value, no file value
            Utf8Encoding: null,          // D39
            MaxCompilerWarnings: compiler.MaxWarnings,
            BreakpointLogging: null,     // D39
            ProjectDefines: compiler.Defines);
    }

    /// <summary>The <c>.plcproj</c> path, from the PLC project item's (<c>TIPC^&lt;plc&gt;</c>) <c>ProduceXml()</c>:
    /// <c>TreeItem/PlcProjectDef/ProjectPath</c>.</summary>
    public static string ProjectPath(string plcProjectItemXml)
    {
        var path = XDocument.Parse(plcProjectItemXml).Root?.Element("PlcProjectDef")?.Element("ProjectPath")?.Value.Trim();
        return string.IsNullOrEmpty(path)
            ? throw new InvalidOperationException(
                "twincat: the PLC project item's XML has no PlcProjectDef/ProjectPath — cannot find the .plcproj that " +
                "holds the disabled warnings")
            : path!;
    }

    /// <summary>The disabled warning ids, from the <c>.plcproj</c>'s option archive (D37).
    ///
    /// <para>The archive is a tree of OptionKeys; a key's <c>SubKeys</c> and <c>Values</c> are hashtables serialized as
    /// ALTERNATING children — key, then value. No warnings key, or no <c>DisabledWarningIds</c> in it, is TwinCAT's
    /// "nothing disabled" (the baseline project has neither, and its page shows every box checked).</para>
    ///
    /// <para>An id that is not an integer is refused by name: TwinCAT writes bare integers, and skipping one would drop
    /// a disabled warning without a word, so the LSP would report it again.</para></summary>
    public static IReadOnlyList<int> DisabledWarningIds(string plcprojXml)
    {
        var root = XDocument.Parse(plcprojXml).Root
            ?? throw new InvalidOperationException("twincat: the .plcproj is empty");
        var archive = root.Descendants().FirstOrDefault(e => e.Name.LocalName == "PlcProjectOptions");
        if (archive is null) return Array.Empty<int>();

        foreach (var subKeys in archive.Descendants().Where(e => IsHashtable(e, "SubKeys")))
            foreach (var (key, value) in Pairs(subKeys))
            {
                if (key.Value != WarningsKey) continue;
                var values = value.Elements().FirstOrDefault(e => IsHashtable(e, "Values"));
                if (values is null) return Array.Empty<int>();
                foreach (var (name, ids) in Pairs(values))
                    if (name.Value == DisabledIdsName) return ParseIds(ids.Value);
                return Array.Empty<int>();
            }
        return Array.Empty<int>();
    }

    /// <summary>The three live rows (D38), from <c>IECProjectDef/CompilerSettings</c>. The automation interface always
    /// answers them; a document without them is not the NestedProject's, and that is said rather than rendered as two
    /// missing rows.</summary>
    public static (bool ReplaceConstants, string MaxWarnings, string Defines) CompilerSettings(string nestedProjectXml)
    {
        var cs = XDocument.Parse(nestedProjectXml).Root?.Element("IECProjectDef")?.Element("CompilerSettings")
            ?? throw new InvalidOperationException(
                "twincat: the PLC project's XML has no IECProjectDef/CompilerSettings — not the NestedProject's document");
        string Required(string name) => cs.Element(name)?.Value.Trim()
            ?? throw new InvalidOperationException($"twincat: CompilerSettings has no <{name}>");

        var replace = Required("ReplaceConstants");
        if (!bool.TryParse(replace, out var replaceConstants))
            throw new InvalidOperationException($"twincat: CompilerSettings/ReplaceConstants is '{replace}', not a boolean");
        return (replaceConstants, Required("MaxWarnings"), Required("CompilerDefines"));
    }

    private static bool IsHashtable(XElement e, string name) =>
        e.Name.LocalName == "d" && (string?)e.Attribute("n") == name;

    /// <summary>A serialized hashtable's entries: its children taken two at a time, key then value.</summary>
    private static IEnumerable<(XElement Key, XElement Value)> Pairs(XElement hashtable)
    {
        var children = hashtable.Elements().ToList();
        for (int i = 0; i + 1 < children.Count; i += 2) yield return (children[i], children[i + 1]);
    }

    private static IReadOnlyList<int> ParseIds(string raw)
    {
        var ids = new List<int>();
        if (raw.Trim().Length == 0) return ids;   // an empty value is an empty set
        foreach (var part in raw.Split(','))
        {
            var t = part.Trim();
            if (!int.TryParse(t, NumberStyles.None, CultureInfo.InvariantCulture, out var n))
                throw new InvalidOperationException(
                    $"twincat: {DisabledIdsName} holds '{t}' (in \"{raw}\"), which is not a bare warning number — " +
                    "TwinCAT writes integers there (DIALECT D37)");
            ids.Add(n);
        }
        return ids;
    }
}
