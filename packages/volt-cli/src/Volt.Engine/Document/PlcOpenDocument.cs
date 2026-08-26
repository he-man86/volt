using System;
using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;

namespace Volt.Engine.Document
{
    /// <summary>
    /// The PLCopen DOCUMENT: the primitives every reader and writer of one shares — resolving the element that
    /// owns a named item, finding its body, scoping a descendant to the item itself rather than to a child, and
    /// serializing back without losing the XML declaration.
    /// <para><b>Name scoping is the load-bearing idea here.</b> One export describes several items — a POU carries
    /// its methods and actions, and TwinCAT cannot export a method standalone at all, so it hands back the whole
    /// enclosing POU. Selecting by document ORDER instead of by NAME is what spliced a body over a sibling method;
    /// see convention 11 in ARCHITECTURE.md. Every member below takes the item name for that reason.</para>
    /// </summary>
    public static class PlcOpenDocument
    {
        /// <summary>The element names a TOP-LEVEL item can appear under, across every kind and both vendors.
        /// <para>ONE list, because it was three and they disagreed — a union DUT parsed nowhere while resolving
        /// fine for a declaration read. What the list encodes is the TC6 schema's own division: <c>pou</c> and
        /// <c>dataType</c> are TC6 elements (a struct, an enum and an alias are all a <c>dataType</c>, being all
        /// baseTypes), while <c>Interface</c>, <c>globalVars</c> and <c>union</c> have no TC6 equivalent and so
        /// live in vendor <c>addData</c> blocks. Measured, not inferred — see PlcOpen/DIALECT.md.</para></summary>
        internal static bool IsItemElement(XElement e) =>
            e.Name.LocalName is "pou" or "Interface" or "dataType" or "globalVars" or "union";

        /// <summary>The element that OWNS the item named <paramref name="itemName"/> — the same resolution
        /// <see cref="ItemBody"/> uses, widened to the declaration-only kinds. One export describes several
        /// items, so every write is scoped by name; writing to the first match in the document is exactly the
        /// bug that spliced a body over a sibling method.</summary>
        internal static XElement? OwnerOf(XDocument doc, string itemName) =>
            doc.Descendants().FirstOrDefault(e =>
                (IsItemElement(e) || e.Name.LocalName is "method" or "Method" or "action" or "Action")
                && (string?)e.Attribute("name") == itemName);

        /// <summary>Re-serialize a spliced document. <c>XDocument.ToString()</c> DROPS the XML declaration, so
        /// every splice was quietly stripping <c>&lt;?xml version="1.0" encoding="utf-8"?&gt;</c> from a document
        /// on its way back to the IDE — bytes nobody asked to move, which is precisely what §2.5 established a
        /// splice must not do. Found by the no-op identity test on <c>PouDocument.Splice</c>, exactly as the §2.5
        /// one found the <c>&lt;xhtml /&gt;</c> re-serialization.
        /// <para>This used to add "and the header is not decoration: this same import already rejects a BOM".
        /// There is NO evidence for that on either vendor — the only BOM refusal in the repo is over workspace
        /// SOURCE files, a different path entirely. Dropped rather than left as a confident unmeasured claim; the
        /// reason above stands on its own.</para></summary>
        internal static string Serialize(XDocument doc) =>
            doc.Declaration is null ? doc.ToString() : doc.Declaration + System.Environment.NewLine + doc.ToString();

        /// <summary>EVERY descendant of <paramref name="owner"/> with this name that belongs to the owner ITSELF
        /// rather than to one of its children — the same containment rule <c>PouReader.DeclFromElement</c>
        /// applies, because a method and an accessor each carry their own <c>InterfaceAsPlainText</c>, which is
        /// why the ancestor filter below names the accessor elements too.
        /// <para>Plural matters for <c>InterfaceAsPlainText</c>: once a POU declares any variable, CODESYS exports
        /// its declaration TWICE — once inside the typed <c>&lt;interface&gt;</c>'s own addData, and once in the
        /// item's trailing addData. Taking the FIRST wrote to the nested copy while the IDE kept reading the
        /// other, so a declaration change was accepted and silently did nothing. (It never showed on a fixture
        /// because a POU with an EMPTY interface has only one copy.) They are two copies of ONE fact and must not
        /// be allowed to diverge, so a write updates both.</para></summary>
        internal static IEnumerable<XElement> OwnDescendants(XElement owner, string localName) =>
            owner.Descendants()
                .Where(e => e.Name.LocalName == localName)
                .Where(e => !e.Ancestors().TakeWhile(a => a != owner)
                    .Any(a => a.Name.LocalName is "pou" or "Method" or "method" or "Action" or "action"
                        or "Property" or "property" or "GetAccessor" or "SetAccessor"));

        /// <summary>
        /// The body belonging to the ITEM NAMED <paramref name="itemName"/> — its own direct <c>&lt;body&gt;</c>
        /// child, never a relative's.
        /// <para>
        /// An export is not one item: <c>ReadXml</c> hands back the whole POU document on both vendors
        /// (CODESYS <c>ExportXmlWithChildren</c>; TwinCAT cannot export a method/action standalone at all), so a
        /// method's, an action's and the POU's own bodies all sit in the SAME document. Scanning it whole answers
        /// about whichever body comes first in document order, which is not the one that was asked for: BOTH vendors
        /// emit <c>&lt;actions&gt;</c> BEFORE the POU's <c>&lt;body&gt;</c> (recorded on CODESYS in
        /// <c>codesys-pou/FB_FolderChild.plcopen.xml</c> and on TwinCAT in <c>tc-fbd/PLC_PRG.plcopen.xml</c>;
        /// this comment used to attribute the ordering to TwinCAT alone, which made it read like a vendor quirk
        /// rather than the schema's shape), so writing a graphical POU that owns
        /// a graphical action splices the new body over the ACTION, and writing one action splices it over a
        /// SIBLING action. Both destroy a body silently and leave the intended one untouched.
        /// </para>
        /// <para>
        /// Name is the right key because name IS the item's identity across this whole wire. Matched over the same
        /// element vocabulary <see cref="PouReader"/> reads children from, by LOCAL name so it works whether
        /// or not the vendor put the child in the PLCopen namespace.
        /// </para>
        /// Null when the document holds no such named element, or it has no body — a DUT/GVL export legitimately
        /// has neither, and the callers decide what that means (no graphical body / a throw on write).
        /// </summary>
        internal static XElement? ItemBody(XDocument doc, string itemName)
        {
            var item = doc.Descendants().FirstOrDefault(e =>
                e.Name.LocalName is "pou" or "method" or "action" or "Method" or "Action"
                && (string?)e.Attribute("name") == itemName);
            return item?.Elements().FirstOrDefault(e => e.Name.LocalName == "body");
        }

        /// <summary>The language of a POU's graphical body, read from the exported PLCopen alone (the
        /// body element's name): <c>FBD</c>/<c>LD</c> (editable) or <c>CFC</c>/<c>SFC</c> (unsupported).
        /// Null for a textual body (ST/IL) or none. Lets the graphical read rely solely on the
        /// (in-memory) export — no extra object-model read that could return a stale post-import body.</summary>
        public static string? GraphicalBodyLang(string xml, string itemName)
        {
            // Parse throws on a malformed export — surfaced, never masked as "textual" (the body of the
            // prior stale-read bug). A well-formed textual POU returns null below.
            var body = ItemBody(XDocument.Parse(xml), itemName);
            if (body is null) return null;
            // Delegates to the parser's ONE lookup rather than re-scanning direct children here. It used to do the
            // latter, and so answered null for a CODESYS CFC body — which nests under <body>/<addData> and carries
            // an empty sibling <ST>. This IS the driver's `BodyLanguage`, i.e. the signal the unsupported-CFC push
            // refusal reads, so "textual" was the one wrong answer it could give.
            return PouReader.NonStLanguageOf(body);
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
            // element IS theirs; POU declarations go through PouReader, which does its own scoping.
            var doc = XDocument.Parse(xml);
            var owner = doc.Descendants().FirstOrDefault(e =>
                IsItemElement(e) && (string?)e.Attribute("name") == itemName);
            // NO whole-document fallback. An earlier version read `(owner ?? doc.Root)`, which meant a name
            // that isn't in the document returned the FIRST plaintext block anywhere in it — i.e. some OTHER
            // item's declaration, confidently. That is the same document-scoping mistake that spliced a body
            // over a sibling method; "not found" must answer null, not a plausible wrong item.
            if (owner is null) return null;
            var iapt = owner.Descendants().FirstOrDefault(e => e.Name.LocalName == "InterfaceAsPlainText");
            if (iapt == null) return null;
            // The text lives in an inner <xhtml> element; take its value (not the addData wrapper's, to
            // avoid pretty-print whitespace around it).
            var inner = iapt.Elements().FirstOrDefault(e => e.Name.LocalName == "xhtml") ?? iapt;
            var text = inner.Value;
            return string.IsNullOrEmpty(text) ? null : text;
        }


        // ── the write splice ────────────────────────────────────────────────────────────────────────────
        // These EDIT the item's existing export rather than generating a document. That is deliberate: an
        // export carries attributes, pragmas, object ids and vendor addData that Volt does not model, and
        // regenerating would silently drop every one of them. Splicing keeps the bytes we were not asked to
        // change — see the identity test in PouSpliceTests.
    }
}
