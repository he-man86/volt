using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace Volt.Bridge.Core.Graphical
{
    /// <summary>
    /// Helpers shared by BOTH bridges for the PLCopenXML graphical round-trip — locating and
    /// replacing the <c>&lt;FBD&gt;</c>/<c>&lt;LD&gt;</c> body inside an exported POU document, and
    /// recovering FB instance→type names from a declaration (VG omits them). Keeping this in Core
    /// keeps CODESYS and TwinCAT byte-identical on the read/write transform; only the vendor's
    /// PLCopen-string transport differs (CODESYS object-model ExportXmlString/ImportXmlString,
    /// in-memory; TwinCAT ITcPlcIECProject PlcOpenExport/PlcOpenImport, via a temp file).
    /// </summary>
    public static class PlcOpenDocument
    {
        /// <summary>The first <c>&lt;FBD&gt;</c> or <c>&lt;LD&gt;</c> body element in an exported
        /// PLCopen POU document, or null if it has no graphical body.</summary>
        public static XElement? FindFbdLdBody(string xml)
        {
            // Parse throws on a malformed export — a real failure that must surface, NOT be masked as
            // "no graphical body" (that masking caused the prior truncated-read bug). A well-formed POU
            // with a textual body legitimately returns null below.
            return FindFbdLd(XDocument.Parse(xml));
        }

        /// <summary>The language of a POU's graphical body, read from the exported PLCopen alone (the
        /// body element's name): <c>FBD</c>/<c>LD</c> (editable) or <c>CFC</c>/<c>SFC</c> (read-only).
        /// Null for a textual body (ST/IL) or none. Lets the graphical read rely solely on the
        /// (in-memory) export — no extra object-model read that could return a stale post-import body.</summary>
        public static string? GraphicalBodyLang(string xml)
        {
            // Parse throws on a malformed export — surfaced, never masked as "textual" (the body of the
            // prior stale-read bug). A well-formed textual POU returns null below.
            var doc = XDocument.Parse(xml);
            var ns = doc.Root!.GetDefaultNamespace();
            foreach (var name in new[] { "FBD", "LD", "CFC", "SFC" })
                if (doc.Descendants(ns + name).Any()) return name;
            return null;
        }

        /// <summary>The POU's declaration, read from the exported PLCopen's <c>interfaceasplaintext</c>
        /// addData (the xhtml-wrapped plaintext interface), or null if absent. Matches the object-model
        /// Interface aspect text exactly — so it's a drift-free substitute that AVOIDS touching the
        /// aspect, which on a just-reimported graphical POU (right after a push) damages its in-session
        /// graphical export. Entity decoding is handled by <see cref="XElement.Value"/>.</summary>
        public static string? DeclFromExport(string xml)
        {
            // Parse throws on a malformed export (surfaced, not masked). A well-formed export with no
            // plaintext interface (e.g. TwinCAT) legitimately returns null below.
            var doc = XDocument.Parse(xml);
            var iapt = doc.Descendants().FirstOrDefault(e => e.Name.LocalName == "InterfaceAsPlainText");
            if (iapt == null) return null;
            // The text lives in an inner <xhtml> element; take its value (not the addData wrapper's, to
            // avoid pretty-print whitespace around it).
            var inner = iapt.Elements().FirstOrDefault(e => e.Name.LocalName == "xhtml") ?? iapt;
            var text = inner.Value;
            return string.IsNullOrEmpty(text) ? null : text;
        }

        /// <summary>Replace the document's <c>&lt;FBD&gt;</c>/<c>&lt;LD&gt;</c> body with
        /// <paramref name="newBody"/> and return the updated XML. Throws if there is no graphical
        /// body to replace (a loud failure — never a silent no-op).</summary>
        public static string SpliceFbdLdBody(string xml, XElement newBody)
        {
            var doc = XDocument.Parse(xml);
            var body = FindFbdLd(doc)
                ?? throw new InvalidOperationException("PLCopen document has no FBD/LD body to write");

            // Safety: replacing the body would silently DROP any element the VG editor can't
            // reproduce. The round-trip can only reproduce inVariable/outVariable/block
            // (vendorElement is cosmetic editor metadata, safe to drop). Anything else
            // (jump/label/return/comment/contact/coil/power rails/connector/continuation/
            // inOutVariable) would be lost — refuse the write instead, so the push is rejected
            // cleanly and the original is kept. (Lift this as each feature gains VG support.)
            var lost = body.Elements()
                .Select(e => e.Name.LocalName)
                .Where(n => !Representable.Contains(n))
                .Distinct()
                .ToList();
            if (lost.Count > 0)
                throw new InvalidOperationException(
                    "refusing to write this graphical body: it contains element(s) the editor cannot " +
                    "represent yet (" + string.Join(", ", lost) + "). Edit this POU in the IDE instead.");

            // Safety: a DISABLED (out-commented) network is omitted from the export entirely — it
            // leaves no element for the check above, only a gap in the localId-derived network
            // numbering (network index = localId / 10^10). Replacing the whole body would delete it
            // with nothing to detect. If the surviving networks aren't contiguous, a hidden network
            // sat in the gap → refuse, so the push is rejected cleanly instead of silently dropping
            // it. (Caveat: a disabled FIRST or LAST network leaves no interior gap and is invisible
            // here — the PLCopen export carries no network count to catch that. An enabled-but-empty
            // network also reads as a gap and is refused, which is safe.)
            var indices = body.Elements()
                .Select(e => (long?)e.Attribute("localId"))
                .Where(id => id.HasValue)
                .Select(id => id!.Value / NetworkStride)
                .Distinct()
                .OrderBy(i => i)
                .ToList();
            if (indices.Count > 1 && indices[indices.Count - 1] - indices[0] + 1 != indices.Count)
                throw new InvalidOperationException(
                    "refusing to write this graphical body: there is a gap in the network numbering, " +
                    "which means a disabled or hidden network the editor cannot see would be lost. " +
                    "Edit this POU in the IDE instead.");

            // The element-name guard above only sees TOP-LEVEL nodes — it is blind to structure
            // INSIDE a <block> and to per-pin attributes. VG models a block's input pins (with their
            // modifiers), its output pin NAMES, and single-wire inputs — but NOT: in-out pins, output-
            // pin modifiers, or a pin wired from multiple sources. Overwriting such a block would
            // silently drop them, so refuse here too (same policy as the element guard).
            var ns = body.Name.Namespace;
            var blind = new List<string>();
            if (body.Descendants(ns + "inOutVariables").Any(io => io.Elements(ns + "variable").Any()))
                blind.Add("a block in-out pin (<inOutVariables>)");
            if (body.Descendants(ns + "outputVariables").Elements(ns + "variable").Any(HasPinMod))
                blind.Add("a modifier on a block output pin (negated/edge/storage)");
            if (body.Descendants(ns + "connectionPointIn").Any(c => c.Elements(ns + "connection").Count() > 1))
                blind.Add("a pin wired from multiple sources");
            // A stateless function (no instanceName) with several outputs can't be referenced by pin in
            // VG (an operator/function result is the bare temp gN); only FB INSTANCES round-trip their
            // multiple outputs (inst.Q/inst.ET). Refuse rather than silently drop the extra outputs.
            if (body.Descendants(ns + "block").Any(b => (string?)b.Attribute("instanceName") == null
                    && (b.Element(ns + "outputVariables")?.Elements(ns + "variable").Count() ?? 0) > 1))
                blind.Add("a stateless function with multiple outputs");
            if (blind.Count > 0)
                throw new InvalidOperationException(
                    "refusing to write this graphical body: it has structure the editor cannot " +
                    "represent yet (" + string.Join("; ", blind.Distinct()) + "). Edit this POU in the IDE instead.");

            // Keep the ORIGINAL <FBD>/<LD> wrapper (its name + attributes) and only swap the body
            // contents. The vendor chose the wrapper — TwinCAT exports an LD body as <FBD> and keeps
            // its ladder view in separate DefaultViewMode metadata — so replacing the element could
            // flip the editor's view or be rejected on import. The element name is cosmetic to us;
            // the children ARE the body.
            body.ReplaceNodes(newBody.Elements());
            return doc.ToString();
        }

        /// <summary>Network index lives in the high digits of every localId (mirrors
        /// <see cref="PlcOpenReader"/>'s grouping: network index = localId / 10^10).</summary>
        private const long NetworkStride = 10_000_000_000L;

        private static readonly System.Collections.Generic.HashSet<string> Representable =
            new() { "inVariable", "outVariable", "block", "label", "jump", "return", "comment", "vendorElement" };

        /// <summary>A pin <c>&lt;variable&gt;</c> carries a modifier VG can't reproduce on an output
        /// (negation / edge / set-reset storage). "none"/absent = no modifier.</summary>
        private static bool HasPinMod(XElement v)
        {
            if ((string?)v.Attribute("negated") == "true") return true;
            if ((string?)v.Attribute("edge") is { } e && e is not ("" or "none")) return true;
            if ((string?)v.Attribute("storage") is { } s && s is not ("" or "none")) return true;
            return false;
        }

        private static XElement? FindFbdLd(XDocument doc)
        {
            var ns = doc.Root!.GetDefaultNamespace();
            return doc.Descendants(ns + "FBD").FirstOrDefault() ?? doc.Descendants(ns + "LD").FirstOrDefault();
        }

        /// <summary>FB instance → type names parsed from a POU declaration (e.g. <c>tmr : TON;</c>),
        /// so the writer can restore the <c>typeName</c> that VG does not carry.</summary>
        public static Dictionary<string, string> InstanceTypes(string? decl)
        {
            var map = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (Match m in Regex.Matches(decl ?? "", @"(\w+)\s*:\s*([\w\.]+)\s*;"))
                map[m.Groups[1].Value] = m.Groups[2].Value;
            return map;
        }
    }
}
