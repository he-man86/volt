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

        /// <summary>
        /// Replace or insert a graphical body. When the document already has an <c>&lt;FBD&gt;</c>/<c>&lt;LD&gt;</c>
        /// body, the existing body is validated (nothing silently lost) and replaced in-place — the original
        /// wrapper element (name + attributes) is kept, only children are swapped. When no graphical body
        /// exists (first write onto a textual POU), the new body is inserted directly into the
        /// <c>&lt;body&gt;</c> parent — there is nothing to validate because the original ST body is
        /// discarded in its entirety.</summary>
        public static string SpliceFbdLdBody(string xml, XElement newBody)
        {
            var doc = XDocument.Parse(xml);
            var existing = FindFbdLd(doc);
            if (existing is not null)
            {
                ValidateExisting(doc, existing);
                existing.ReplaceNodes(newBody.Elements());
            }
            else
            {
                InlineInsert(doc, newBody);
            }
            return doc.ToString();
        }

        /// <summary>Validate an existing body before replacing it: no element the VG editor cannot
        /// reproduce is silently dropped, no disabled/hidden network is lost, and no block structure
        /// the editor cannot round-trip is overwritten. These checks run ONLY on the existing-body path
        /// — a first write has nothing to lose, so validation is skipped.</summary>
        private static void ValidateExisting(XDocument doc, XElement existing)
        {
            var lost = existing.Elements()
                .Select(e => e.Name.LocalName)
                .Where(n => !SafeToDrop.Contains(n))
                .Distinct()
                .ToList();
            if (lost.Count > 0)
                throw new InvalidOperationException(
                    "refusing to write this graphical body: it contains element(s) the VG editor cannot " +
                    "represent yet (" + string.Join(", ", lost) + "). Edit this POU in the IDE instead.");

            var indices = existing.Elements()
                .Select(e => (long?)e.Attribute("localId"))
                .Where(id => id.HasValue)
                .Select(id => id!.Value / NetworkStride)
                .Distinct()
                .OrderBy(i => i)
                .ToList();
            if (indices.Count > 1 && indices[indices.Count - 1] - indices[0] + 1 != indices.Count)
                throw new InvalidOperationException(
                    "refusing to write this graphical body: there is a gap in the network numbering, " +
                    "which means a disabled or hidden network would be lost. " +
                    "Edit this POU in the IDE instead.");

            var ns = existing.Name.Namespace;
            var blind = new List<string>();
            if (existing.Descendants(ns + "inOutVariables").Any(io => io.Elements(ns + "variable").Any()))
                blind.Add("a block in-out pin (<inOutVariables>)");
            if (existing.Descendants(ns + "outputVariables").Elements(ns + "variable").Any(HasPinMod))
                blind.Add("a modifier on a block output pin (negated/edge/storage)");
            if (existing.Descendants(ns + "connectionPointIn").Any(c => c.Elements(ns + "connection").Count() > 1))
                blind.Add("a pin wired from multiple sources");
            if (existing.Descendants(ns + "block").Any(b => (string?)b.Attribute("instanceName") == null
                    && (b.Element(ns + "outputVariables")?.Elements(ns + "variable").Count() ?? 0) > 1))
                blind.Add("a stateless function with multiple outputs");
            if (blind.Count > 0)
                throw new InvalidOperationException(
                    "refusing to write this graphical body: it has structure the VG editor cannot " +
                    "represent yet (" + string.Join("; ", blind.Distinct()) + "). Edit this POU in the IDE instead.");
        }

        /// <summary>Insert a graphical body for the first time — replace whatever is inside
        /// <c>&lt;body&gt;</c> (typically an ST body) with the new FBD/LD element. No validation
        /// needed: the original textual body is discarded and nothing of value is lost.</summary>
        private static void InlineInsert(XDocument doc, XElement newBody)
        {
            var ns = doc.Root!.GetDefaultNamespace();
            var pouBody = doc.Descendants(ns + "body").FirstOrDefault()
                ?? throw new InvalidOperationException("PLCopen document has no <body> element");
            pouBody.RemoveNodes();
            pouBody.Add(newBody);
        }

        /// <summary>Network index lives in the high digits of every localId (mirrors
        /// <see cref="PlcOpenReader"/>'s grouping: network index = localId / 10^10).</summary>
        private const long NetworkStride = 10_000_000_000L;

        /// <summary>Elements the VG editor either represents explicitly (inVariable, outVariable, block)
        /// or can safely discard because they are cosmetic presentation metadata, not functional logic.
        /// <c>vendorElement</c> is editor-specific rendering info. <c>leftPowerRail</c>/<c>rightPowerRail</c>
        /// are CODESYS LD power rails that the IDE regenerates on import (TwinCAT wraps LD in an
        /// <c>&lt;FBD&gt;</c> body and stores ladder view in separate metadata, so they never appear).
        /// Adding a genuinely structural element here without VG support would silently drop it — every
        /// entry in this set must be affirmatively confirmed as cosmetic.</summary>
        private static readonly System.Collections.Generic.HashSet<string> SafeToDrop =
            new() { "inVariable", "outVariable", "block", "label", "jump", "return", "comment", "vendorElement",
                    "leftPowerRail", "rightPowerRail" };

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
