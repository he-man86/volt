using System.Linq;
using System.Xml.Linq;

namespace Volt.Bridge.Beckhoff;

/// <summary>
/// Classifies a TwinCAT graphical body by language — the cheap language gate for the Beckhoff driver.
/// The body is the IDE's own serialization (the string <c>ImplementationText</c> returns): a graphical
/// <c>&lt;NWL&gt;</c>/<c>&lt;CFC&gt;</c>/<c>&lt;SFC&gt;</c> archive, or textual <c>&lt;ST&gt;</c>/<c>&lt;IL&gt;</c>.
/// TwinCAT-specific (the NWL archive format), so it lives in the Beckhoff driver, not Core.
/// </summary>
internal static class TcPouReader
{
    /// <summary>The graphical language of a body XML string: "FBD"/"LD" (from the NWL DefaultViewMode),
    /// "CFC"/"SFC", or null for textual (ST/IL or unparseable input).</summary>
    public static string? LanguageOf(string? bodyXml)
    {
        if (string.IsNullOrWhiteSpace(bodyXml)) return null;
        XElement el;
        try { el = XElement.Parse(bodyXml); } catch { return null; }   // textual ST isn't XML
        return el.Name.LocalName switch
        {
            "NWL" => NwlViewMode(el),     // FBD or LD — distinguished by the archive's DefaultViewMode
            "CFC" => "CFC",
            "SFC" => "SFC",
            _ => null,
        };
    }

    /// <summary>FBD vs LD for an NWL body: the <c>DefaultViewMode</c> scalar inside the
    /// NWLImplementationObject (a quoted string in the XmlArchive), uppercased; defaults to FBD.</summary>
    private static string NwlViewMode(XElement nwl)
    {
        var impl = (string?)nwl.Attribute("t") == "NWLImplementationObject"
            ? nwl
            : nwl.DescendantsAndSelf("o").FirstOrDefault(o => (string?)o.Attribute("t") == "NWLImplementationObject");
        var v = impl?.Elements("v").FirstOrDefault(e => (string?)e.Attribute("n") == "DefaultViewMode")?.Value
                ?? "\"FBD\"";
        if (v.Length >= 2 && v[0] == '"' && v[v.Length - 1] == '"') v = v.Substring(1, v.Length - 2);
        return v.ToUpperInvariant();
    }
}
