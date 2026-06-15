using System;
using System.Linq;
using System.Xml.Linq;

namespace VoltBridge.Core.Fbd;

/// <summary>
/// Turns a TwinCAT graphical body into read-only ST. The body is the IDE's own in-memory
/// serialization (the same string <c>ImplementationText</c> returns over COM): either
/// <c>&lt;ST&gt;</c>/<c>&lt;IL&gt;</c> (textual → null) or a graphical
/// <c>&lt;NWL&gt;&lt;XmlArchive&gt;</c> (FBD/LD) / <c>&lt;CFC&gt;</c> / <c>&lt;SFC&gt;</c>.
/// FBD/LD is transpiled (<see cref="FbdXmlReader"/> + <see cref="FbdTranspiler"/>); CFC/SFC come
/// back as a read-only marker. <paramref name="resolvePins"/> is only a fallback — boxes carry
/// their own pin names.
/// </summary>
public static class TcPouReader
{
    /// <summary>A graphical body straight from the object-model endpoint (<c>ImplementationText</c>):
    /// the raw body XML string. Null for textual (ST/IL) or unparseable input. This is the live
    /// path — no file read, no PLCopen import/export.</summary>
    public static GraphicalBody? FromBodyXml(string? bodyXml, FbdTranspiler.PinResolver resolvePins)
    {
        if (string.IsNullOrWhiteSpace(bodyXml)) return null;
        XElement body;
        try { body = XElement.Parse(bodyXml); } catch { return null; }   // textual ST isn't XML
        return FromBodyElement(body, resolvePins);
    }

    /// <summary>Read a named member's (Action/Method or the POU itself) graphical body out of a whole
    /// <c>.TcPOU</c> document. Exposed for tests/fixtures; the live adapter uses
    /// <see cref="FromBodyXml"/> against the in-memory endpoint instead.</summary>
    public static GraphicalBody? ReadGraphicalBody(string tcPouXml, string childName, FbdTranspiler.PinResolver resolvePins)
    {
        var body = FindChildBody(tcPouXml, childName);
        return body is null ? null : FromBodyElement(body, resolvePins);
    }

    private static GraphicalBody? FromBodyElement(XElement body, FbdTranspiler.PinResolver resolvePins)
    {
        switch (body.Name.LocalName)
        {
            case "NWL":                                        // FBD / LD network language
            case "FBD":
            case "LD":
                var fbd = FbdXmlReader.Read(body.ToString());
                return new GraphicalBody(fbd.Language, FbdTranspiler.ToSt(fbd, resolvePins));
            case "CFC":
            case "SFC":
                return new GraphicalBody(body.Name.LocalName, "");  // marker only — not transpiled yet
            default:
                return null;                                   // ST / IL → textual
        }
    }

    /// <summary>The graphical language of a body XML string (from <c>ImplementationText</c>):
    /// "FBD"/"LD" (from the NWL DefaultViewMode), "CFC"/"SFC", or null for textual (ST/IL).
    /// A cheap classifier so the adapter only does a PLCopen export for FBD/LD bodies.</summary>
    public static string? LanguageOf(string? bodyXml)
    {
        if (string.IsNullOrWhiteSpace(bodyXml)) return null;
        XElement el;
        try { el = XElement.Parse(bodyXml); } catch { return null; }   // textual ST isn't XML
        return el.Name.LocalName switch
        {
            "NWL" => FbdXmlReader.Read(bodyXml).Language,              // FBD or LD via DefaultViewMode
            "CFC" => "CFC",
            "SFC" => "SFC",
            _ => null,
        };
    }

    /// <summary>The body element (&lt;ST&gt; / &lt;NWL&gt; / &lt;CFC&gt; / &lt;SFC&gt;) for a
    /// named member — an Action/Method OR the POU/Interface itself (root body) — or null if
    /// absent. Exposed for tests/diagnostics.</summary>
    public static XElement? FindChildBody(string tcPouXml, string childName)
    {
        XDocument doc;
        try { doc = XDocument.Parse(tcPouXml); } catch { return null; }
        // Match by Name attribute, on any member that carries an <Implementation> — the POU
        // itself (root body) as well as its Actions/Methods. Names are unique within a file.
        var member = doc.Descendants()
            .FirstOrDefault(e =>
                (string?)e.Attribute("Name") == childName &&
                e.Elements().Any(c => c.Name.LocalName == "Implementation"));
        var impl = member?.Elements().FirstOrDefault(e => e.Name.LocalName == "Implementation");
        return impl?.Elements().FirstOrDefault(e =>
            e.Name.LocalName is "ST" or "IL" or "NWL" or "CFC" or "SFC" or "LD" or "FBD");
    }
}
