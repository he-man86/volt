using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace VoltBridge.Core.Fbd
{
    /// <summary>
    /// Helpers shared by BOTH bridges for the PLCopenXML graphical round-trip — locating and
    /// replacing the <c>&lt;FBD&gt;</c>/<c>&lt;LD&gt;</c> body inside an exported POU document, and
    /// recovering FB instance→type names from a declaration (VG omits them). Keeping this in Core
    /// keeps CODESYS and TwinCAT byte-identical on the read/write transform; only the vendor's
    /// export/import transport differs (CODESYS object-model ExportXml/ImportXml vs TwinCAT
    /// ITcPlcIECProject PlcOpenExport/PlcOpenImport).
    /// </summary>
    public static class PlcOpenDocument
    {
        /// <summary>The first <c>&lt;FBD&gt;</c> or <c>&lt;LD&gt;</c> body element in an exported
        /// PLCopen POU document, or null if it has no graphical body.</summary>
        public static XElement? FindFbdLdBody(string xml)
        {
            XDocument doc;
            try { doc = XDocument.Parse(xml); } catch { return null; }
            return FindFbdLd(doc);
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

            body.ReplaceWith(newBody);
            return doc.ToString();
        }

        private static readonly System.Collections.Generic.HashSet<string> Representable =
            new() { "inVariable", "outVariable", "block", "label", "jump", "return", "vendorElement" };

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
