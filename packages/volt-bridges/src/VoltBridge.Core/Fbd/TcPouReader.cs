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
    /// <summary>The child's graphical body as read-only ST, or null if the child is
    /// textual / not found. <paramref name="resolvePins"/> names box pins from each box
    /// type's interface (see <see cref="FbdTranspiler.PinResolver"/>).</summary>
    public static GraphicalBody? ReadGraphicalBody(string tcPouXml, string childName, FbdTranspiler.PinResolver resolvePins)
    {
        var nwl = FindChildNwl(tcPouXml, childName);
        if (nwl is null) return null;
        var body = FbdXmlReader.Read(nwl.ToString());
        return new GraphicalBody(body.Language, FbdTranspiler.ToSt(body, resolvePins));
    }

    /// <summary>The raw <c>&lt;NWL&gt;</c> element for a named Action/Method, or null if it
    /// is textual (<c>&lt;ST&gt;</c>) or absent. Exposed for tests/diagnostics.</summary>
    public static XElement? FindChildNwl(string tcPouXml, string childName)
    {
        XDocument doc;
        try { doc = XDocument.Parse(tcPouXml); } catch { return null; }
        var member = doc.Descendants()
            .FirstOrDefault(e =>
                (e.Name.LocalName == "Action" || e.Name.LocalName == "Method") &&
                (string?)e.Attribute("Name") == childName);
        var impl = member?.Elements().FirstOrDefault(e => e.Name.LocalName == "Implementation");
        return impl?.Elements().FirstOrDefault(e => e.Name.LocalName == "NWL");
    }
}
