using System.Linq;
using System.Xml.Linq;

namespace VoltBridge.Core.Fbd;

/// <summary>
/// Reads a graphical child body out of a TwinCAT <c>.TcPOU</c> document and renders it to
/// ST via the shared <see cref="FbdXmlReader"/> + <see cref="FbdTranspiler"/>. A child's
/// implementation is either <c>&lt;ST&gt;</c> (textual) or <c>&lt;NWL&gt;&lt;XmlArchive&gt;</c>
/// (graphical) — the latter is the same NWL model CODESYS exposes as objects.
/// </summary>
public static class TcPouReader
{
    /// <summary>The child's graphical body as read-only ST, or null if textual / absent.
    /// FBD/LD (the <c>&lt;NWL&gt;</c> network model) is transpiled; CFC/SFC are graphical
    /// but use different body models we don't transpile yet, so they come back with an
    /// empty body (marker only) — still read-only and push-safe. <paramref name="resolvePins"/>
    /// names box pins from each box type's interface.</summary>
    public static GraphicalBody? ReadGraphicalBody(string tcPouXml, string childName, FbdTranspiler.PinResolver resolvePins)
    {
        var body = FindChildBody(tcPouXml, childName);
        if (body is null) return null;
        switch (body.Name.LocalName)
        {
            case "ST":
            case "IL":
                return null;                                   // textual
            case "NWL":                                        // FBD / LD network language
                var fbd = FbdXmlReader.Read(body.ToString());
                return new GraphicalBody(fbd.Language, FbdTranspiler.ToSt(fbd, resolvePins));
            case "CFC":
            case "SFC":
                return new GraphicalBody(body.Name.LocalName, "");  // marker only — not transpiled yet
            default:
                return new GraphicalBody(body.Name.LocalName.ToUpperInvariant(), "");
        }
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
