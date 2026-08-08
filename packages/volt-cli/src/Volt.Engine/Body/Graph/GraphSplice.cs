using System;
using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;
using Volt.Engine.PlcOpen;

namespace Volt.Engine.Body
{
    /// <summary>The FBD/LD BODY splice: replacing one graphical body inside an export, and the capability gate
    /// that decides whether the existing body may be replaced at all.
    /// <para>Separate from <c>PlcOpen.PouSplice</c> on purpose. That class writes a POU's text and members and has
    /// no graph knowledge; this one encodes what the network text EDITOR can represent — which elements are safe to drop,
    /// which pin modifiers block a rewrite, and the network-numbering rules — so it belongs with the graph, not
    /// with the document.</para>
    /// </summary>
    public static class GraphSplice
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
            return PlcOpenDocument.Serialize(doc);
        }

        /// <summary>Validate an existing body before replacing it: no element the network text editor cannot
        /// reproduce is silently dropped, no disabled/hidden network is lost, and no block structure
        /// the editor cannot round-trip is overwritten. These checks run ONLY on the existing-body path
        /// — a first write has nothing to lose, so validation is skipped.</summary>
        /// <summary>The capability gate as the codec calls it: refuse to overwrite a stored body carrying
        /// elements network text cannot represent. `doc` is only used for the error message's item name, so the
        /// codec — which holds the body, not the document — passes none.</summary>
        internal static void RequireReplaceable(XElement existing) => ValidateExisting(null, existing);

        private static void ValidateExisting(XDocument? doc, XElement existing)
        {
            var lost = existing.Elements()
                .Select(e => e.Name.LocalName)
                .Where(n => !SafeToDrop.Contains(n))
                .Distinct()
                .ToList();
            if (lost.Count > 0)
                throw new InvalidOperationException(
                    "refusing to write this graphical body: it contains element(s) the network text editor cannot " +
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
                    "refusing to write this graphical body: it has structure the network text editor cannot " +
                    "represent yet (" + string.Join("; ", blind.Distinct()) + "). Edit this POU in the IDE instead.");
        }

        /// <summary>Insert a graphical body for the first time — replace whatever is inside
        /// <c>&lt;body&gt;</c> (typically an ST body) with the new FBD/LD element. No validation
        /// needed: the original textual body is discarded and nothing of value is lost.</summary>
        private static void InlineInsert(XDocument doc, string itemName, XElement newBody)
        {
            var pouBody = PlcOpenDocument.ItemBody(doc, itemName)
                ?? throw new InvalidOperationException(
                    $"PLCopen export has no <body> element for '{itemName}'");
            pouBody.RemoveNodes();
            pouBody.Add(newBody);
        }

        /// <summary>Elements safe to discard when REPLACING an existing FBD/LD body, because the network text editor
        /// either represents them explicitly (inVariable, outVariable, block) or regenerates them on write.
        /// <c>vendorElement</c> is editor rendering info. <c>leftPowerRail</c>, <c>rightPowerRail</c>,
        /// <c>contact</c>, <c>coil</c> are LD ladder elements — the existing ones are dropped here and
        /// <c>GraphWriter.WriteLadderBody</c> regenerates them from the network text (BOTH TwinCAT and CODESYS emit
        /// real <c>contact</c>/<c>coil</c> inside an <c>&lt;LD&gt;</c> body — TwinCAT does NOT wrap LD in
        /// <c>&lt;FBD&gt;</c>, as once assumed). Adding a genuinely structural element here without network text support
        /// would silently drop functional logic — every entry must be affirmatively confirmed as cosmetic.</summary>
        private static readonly HashSet<string> SafeToDrop =
            new() { "inVariable", "outVariable", "block", "label", "jump", "return", "comment", "vendorElement",
                    "leftPowerRail", "rightPowerRail", "contact", "coil" };

        /// <summary>A pin <c>&lt;variable&gt;</c> carries a modifier network text can't reproduce on an output
        /// (negation / edge / set-reset storage). "none"/absent = no modifier.</summary>
        private static bool HasPinMod(XElement v)
        {
            if ((string?)v.Attribute("negated") == "true") return true;
            if ((string?)v.Attribute("edge") is { } e && e is not ("" or "none")) return true;
            if ((string?)v.Attribute("storage") is { } s && s is not ("" or "none")) return true;
            return false;
        }

        private static XElement? FindFbdLd(XDocument doc, string itemName) =>
            PlcOpenDocument.ItemBody(doc, itemName)?.Elements().FirstOrDefault(e => e.Name.LocalName is "FBD" or "LD");
    }
}
