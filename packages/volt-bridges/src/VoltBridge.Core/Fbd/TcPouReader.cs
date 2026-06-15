using System.Linq;
using System.Xml.Linq;

namespace VoltBridge.Core.Fbd;

/// <summary>
/// Classifies a TwinCAT graphical body by language. The body is the IDE's own serialization (the
/// string <c>ImplementationText</c> returns): a graphical <c>&lt;NWL&gt;</c>/<c>&lt;CFC&gt;</c>/
/// <c>&lt;SFC&gt;</c> archive, or textual <c>&lt;ST&gt;</c>/<c>&lt;IL&gt;</c>.
///
/// This ONLY sniffs the language so the Beckhoff adapter knows whether to export PLCopenXML — the
/// actual FBD/LD body is read through the shared PLCopen path (<see cref="PlcOpenReader"/>), the same
/// transform CODESYS uses. (CODESYS reads its language from the live object's <c>DefaultViewMode</c>
/// property instead; TwinCAT only hands us the serialized string, so we read it from there.)
/// </summary>
public static class TcPouReader
{
    /// <summary>The graphical language of a body XML string: "FBD"/"LD" (from the NWL
    /// DefaultViewMode), "CFC"/"SFC", or null for textual (ST/IL or unparseable input).</summary>
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
