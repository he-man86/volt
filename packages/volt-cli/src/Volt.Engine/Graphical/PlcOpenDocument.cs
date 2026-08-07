using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace Volt.Engine.Graphical
{
    /// <summary>
    /// PLCopenXML document helpers for the graphical round-trip. Which of them BOTH bridges use differs
    /// per member — do not read this class as a uniformly shared surface:
    /// <list type="bullet">
    /// <item><description><see cref="FindFbdLdBody"/> / <see cref="SpliceFbdLdBody"/> / <see cref="InstanceTypes"/>
    /// are the genuinely SHARED read/write transform (locating and replacing the <c>&lt;FBD&gt;</c>/<c>&lt;LD&gt;</c>
    /// body, and recovering the FB instance→type names VG omits). Keeping them in Core is what keeps CODESYS and
    /// TwinCAT byte-identical here; only the vendor's PLCopen-string transport differs (CODESYS object-model
    /// ExportXmlString/ImportXmlString, in-memory; TwinCAT ITcPlcIECProject PlcOpenExport/PlcOpenImport, via a
    /// temp file).</description></item>
    /// <item><description><see cref="GraphicalBodyLang"/> is the CODESYS path ONLY — TwinCAT sniffs the language
    /// out of its vendor NWL archive (<c>TcPouReader.LanguageOf</c>), which has no CODESYS counterpart.</description></item>
    /// <item><description><see cref="DeclFromExport"/> serves <c>GraphicalCode</c>'s declaration read on both
    /// vendors; the MATERIALIZE declaration read is <see cref="PlcOpenPouParser"/>'s, which scopes to the POU
    /// itself rather than to the first plaintext block in the document.</description></item>
    /// </list>
    /// </summary>
    public static class PlcOpenDocument
    {
        /// <summary>The <c>&lt;FBD&gt;</c>/<c>&lt;LD&gt;</c> body of the item named <paramref name="itemName"/> in
        /// an exported PLCopen document, or null if that item has no graphical body. The export usually holds
        /// several items' bodies — see <see cref="ItemBody"/> for why the name is what selects between them.</summary>
        public static XElement? FindFbdLdBody(string xml, string itemName)
        {
            // Parse throws on a malformed export — a real failure that must surface, NOT be masked as
            // "no graphical body" (that masking caused the prior truncated-read bug). A well-formed POU
            // with a textual body legitimately returns null below.
            return FindFbdLd(XDocument.Parse(xml), itemName);
        }

        /// <summary>The language of a POU's graphical body, read from the exported PLCopen alone (the
        /// body element's name): <c>FBD</c>/<c>LD</c> (editable) or <c>CFC</c>/<c>SFC</c> (read-only).
        /// Null for a textual body (ST/IL) or none. Lets the graphical read rely solely on the
        /// (in-memory) export — no extra object-model read that could return a stale post-import body.</summary>
        public static string? GraphicalBodyLang(string xml, string itemName)
        {
            // Parse throws on a malformed export — surfaced, never masked as "textual" (the body of the
            // prior stale-read bug). A well-formed textual POU returns null below.
            var body = ItemBody(XDocument.Parse(xml), itemName);
            if (body is null) return null;
            foreach (var e in body.Elements())
                if (e.Name.LocalName is "FBD" or "LD" or "CFC" or "SFC") return e.Name.LocalName;
            return null;
        }

        /// <summary>The POU's declaration, read from the exported PLCopen's <c>interfaceasplaintext</c>
        /// addData (the xhtml-wrapped plaintext interface), or null if absent. Matches the object-model
        /// Interface aspect text exactly — so it's a drift-free substitute that AVOIDS touching the
        /// aspect, which on a just-reimported graphical POU (right after a push) damages its in-session
        /// graphical export. Entity decoding is handled by <see cref="XElement.Value"/>.</summary>
        public static string? DeclFromExport(string xml, string itemName)
        {
            // Parse throws on a malformed export (surfaced, not masked).
            // Scoped to the element NAMED itemName — a DUT is <dataType name=…>, a GVL is <globalVars name=…> —
            // for the same reason ItemBody is: one export can describe several items, and the FIRST
            // InterfaceAsPlainText in the document is not necessarily the one that was asked for.
            // Declaration-only kinds (DUT/GVL) have no children, so the first descendant under the named
            // element IS theirs; POU declarations go through PlcOpenPouParser, which does its own scoping.
            var doc = XDocument.Parse(xml);
            var owner = doc.Descendants().FirstOrDefault(e =>
                e.Name.LocalName is "dataType" or "globalVars" or "pou" or "Interface"
                && (string?)e.Attribute("name") == itemName);
            var iapt = (owner ?? doc.Root!)?.Descendants()
                .FirstOrDefault(e => e.Name.LocalName == "InterfaceAsPlainText");
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
        /// discarded in its entirety.
        /// <para>Both the replace and the insert are scoped to the item NAMED <paramref name="itemName"/>. The
        /// export carries the POU's siblings and children too, and splicing into the wrong one silently destroys
        /// a body — see <see cref="ItemBody"/>.</para></summary>
        public static string SpliceFbdLdBody(string xml, string itemName, XElement newBody)
        {
            var doc = XDocument.Parse(xml);
            var existing = FindFbdLd(doc, itemName);
            if (existing is not null)
            {
                ValidateExisting(doc, existing);
                // Replace the whole <FBD>/<LD> element, not just its children — the body LANGUAGE can change
                // (TwinCAT creates the POU as FBD even for an LD body, so `existing` is <FBD> but `newBody`
                // is <LD>). Keeping the old wrapper would put ladder contacts inside <FBD>, which the schema
                // rejects.
                existing.ReplaceWith(newBody);
            }
            else
            {
                InlineInsert(doc, itemName, newBody);
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
                .Select(id => id!.Value / GraphConstants.NetworkStride)
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
            // A pin with several connections is an invalid multi-source pin in FBD — but in LD it's an OR
            // convergence (parallel branches), which the reader lowers and the writer regenerates. Only guard FBD.
            if (existing.Name.LocalName != "LD"
                && existing.Descendants(ns + "connectionPointIn").Any(c => c.Elements(ns + "connection").Count() > 1))
                blind.Add("a pin wired from multiple sources");
            // A stateless block with >1 output can't be represented — UNLESS it's an EN/ENO box: it has an EN
            // input and two outputs (its value + the enable echo), and we represent that as the IF guard. The
            // enable echo is named inconsistently across TwinCAT builds (ENO / Out1), so key off the EN INPUT,
            // which is always "EN", not the output name.
            if (existing.Descendants(ns + "block").Any(b => (string?)b.Attribute("instanceName") == null
                    && !(b.Element(ns + "inputVariables")?.Elements(ns + "variable")
                          .Any(v => (string?)v.Attribute("formalParameter") == "EN") ?? false)
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
        private static void InlineInsert(XDocument doc, string itemName, XElement newBody)
        {
            var pouBody = ItemBody(doc, itemName)
                ?? throw new InvalidOperationException(
                    $"PLCopen export has no <body> element for '{itemName}'");
            pouBody.RemoveNodes();
            pouBody.Add(newBody);
        }

        /// <summary>Elements safe to discard when REPLACING an existing FBD/LD body, because the VG editor
        /// either represents them explicitly (inVariable, outVariable, block) or regenerates them on write.
        /// <c>vendorElement</c> is editor rendering info. <c>leftPowerRail</c>, <c>rightPowerRail</c>,
        /// <c>contact</c>, <c>coil</c> are LD ladder elements — the existing ones are dropped here and
        /// <c>PlcOpenWriter.WriteLadderBody</c> regenerates them from the VG (BOTH TwinCAT and CODESYS emit
        /// real <c>contact</c>/<c>coil</c> inside an <c>&lt;LD&gt;</c> body — TwinCAT does NOT wrap LD in
        /// <c>&lt;FBD&gt;</c>, as once assumed). Adding a genuinely structural element here without VG support
        /// would silently drop functional logic — every entry must be affirmatively confirmed as cosmetic.</summary>
        private static readonly HashSet<string> SafeToDrop =
            new() { "inVariable", "outVariable", "block", "label", "jump", "return", "comment", "vendorElement",
                    "leftPowerRail", "rightPowerRail", "contact", "coil" };

        /// <summary>A pin <c>&lt;variable&gt;</c> carries a modifier VG can't reproduce on an output
        /// (negation / edge / set-reset storage). "none"/absent = no modifier.</summary>
        private static bool HasPinMod(XElement v)
        {
            if ((string?)v.Attribute("negated") == "true") return true;
            if ((string?)v.Attribute("edge") is { } e && e is not ("" or "none")) return true;
            if ((string?)v.Attribute("storage") is { } s && s is not ("" or "none")) return true;
            return false;
        }

        private static XElement? FindFbdLd(XDocument doc, string itemName) =>
            ItemBody(doc, itemName)?.Elements().FirstOrDefault(e => e.Name.LocalName is "FBD" or "LD");

        /// <summary>
        /// The body belonging to the ITEM NAMED <paramref name="itemName"/> — its own direct <c>&lt;body&gt;</c>
        /// child, never a relative's.
        /// <para>
        /// An export is not one item: <c>ReadXml</c> hands back the whole POU document on both vendors
        /// (CODESYS <c>ExportXmlWithChildren</c>; TwinCAT cannot export a method/action standalone at all), so a
        /// method's, an action's and the POU's own bodies all sit in the SAME document. Scanning it whole answers
        /// about whichever body comes first in document order, which is not the one that was asked for: TwinCAT
        /// emits <c>&lt;actions&gt;</c> BEFORE the POU's <c>&lt;body&gt;</c>, so writing a graphical POU that owns
        /// a graphical action splices the new body over the ACTION, and writing one action splices it over a
        /// SIBLING action. Both destroy a body silently and leave the intended one untouched.
        /// </para>
        /// <para>
        /// Name is the right key because name IS the item's identity across this whole wire. Matched over the same
        /// element vocabulary <see cref="PlcOpenPouParser"/> reads children from, by LOCAL name so it works whether
        /// or not the vendor put the child in the PLCopen namespace.
        /// </para>
        /// Null when the document holds no such named element, or it has no body — a DUT/GVL export legitimately
        /// has neither, and the callers decide what that means (no graphical body / a throw on write).
        /// </summary>
        private static XElement? ItemBody(XDocument doc, string itemName)
        {
            var item = doc.Descendants().FirstOrDefault(e =>
                e.Name.LocalName is "pou" or "method" or "action" or "Method" or "Action"
                && (string?)e.Attribute("name") == itemName);
            return item?.Elements().FirstOrDefault(e => e.Name.LocalName == "body");
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
