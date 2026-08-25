using System;
using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;

namespace Volt.Engine.Document
{
    /// <summary>
    /// The document's own statement of STRUCTURE — the <c>…/projectstructure</c> addData block — kept in agreement
    /// with the members the document actually carries.
    ///
    /// <para><b>Why this exists.</b> A splice edits members: it adds one, removes one, renames one (remove + add).
    /// The block lists them. Nothing was updating it, so a spliced document said "here are my members" in the
    /// member elements and "I have none" in the structure block. CODESYS emits the block
    /// <c>handleUnknown="discard"</c> and throws it away on import, so the disagreement was invisible there for as
    /// long as CODESYS was the only vendor taking the single-document write.</para>
    ///
    /// <para><b>TwinCAT reads it, and it is authoritative.</b> Measured with a three-cell probe on a freshly
    /// created FB spliced with one method (DIALECT D4h): the member's <c>&lt;data name="…/method"&gt;&lt;Method&gt;</c>
    /// block alone gives <c>childCount=0</c>; adding an <c>ObjectId</c> attribute gives <c>0</c>; ALSO listing the
    /// child inside <c>&lt;ProjectStructure&gt;</c> gives <c>1</c>. A member exists for TwinCAT's importer only if
    /// the structure block declares it — so every child of every POU written as one document was being dropped in
    /// silence.</para>
    ///
    /// <para><b>It declares WHICH members exist, and deliberately not WHERE.</b> Members are listed FLAT, at the
    /// item's own level, even though TwinCAT's export nests a POU-internal folder as
    /// <c>&lt;Folder Name="Sub"&gt;&lt;Object …/&gt;&lt;/Folder&gt;</c>. Writing that nesting back was tried and is
    /// WORSE than not writing it: measured live, a member inside a <c>&lt;Folder&gt;</c> is DROPPED by the import
    /// entirely — with the folder flag on, with the flag off, and with an id on the folder element (DIALECT D4i).
    /// CODESYS discards the whole block, so the nesting is honoured by neither vendor while costing the member on
    /// one. Placement stays where ARCHITECTURE puts it: content travels in the document, structure travels on the
    /// scripting API (<c>PushService.RestoreChildFolders</c>).</para>
    ///
    /// <para><b>Only ever REPAIRS a block the vendor already emitted.</b> A document with no structure block is
    /// left byte-identical — Volt is in no position to invent one (it would have to name object ids for items it
    /// cannot see in this document), and a no-op splice returning the original bytes is the property that makes
    /// splicing safer than regenerating.</para>
    /// </summary>
    internal static class ProjectStructure
    {
        private const string ThreeSObjectId = "http://www.3s-software.com/plcopenxml/objectid";

        /// <summary>Rewrite the item's entry in the structure block so it lists exactly
        /// <paramref name="members"/>, each carrying the same <c>ObjectId</c> as its member element. Ids absent
        /// from the document are minted here and stamped on BOTH sides — the block and the element have to agree
        /// or the importer ignores the member.</summary>
        public static string Sync(string xml, string itemName, IReadOnlyList<string> members)
        {
            var doc = XDocument.Parse(xml);
            var structure = doc.Descendants().FirstOrDefault(e => e.Name.LocalName == "ProjectStructure");
            if (structure is null) return xml;                          // vendor emitted none — not ours to invent

            var owner = PlcOpenDocument.OwnerOf(doc, itemName);
            if (owner is null) return xml;                              // not this document's item

            var entry = structure.Descendants().FirstOrDefault(e =>
                e.Name.LocalName == "Object" && (string?)e.Attribute("Name") == itemName);
            if (entry is null) return xml;                              // the block does not describe this item

            XNamespace ns = structure.Name.Namespace;
            var scratch = new XElement(ns + "scratch");
            var stamped = false;

            foreach (var name in members)
            {
                var element = MemberElement(owner, name);
                if (element is null) continue;                          // the splice wrote no element for it
                scratch.Add(new XElement(ns + "Object",
                    new XAttribute("Name", name), new XAttribute("ObjectId", IdOf(element, ns, ref stamped))));
            }

            // Byte-identity: a splice that changes no structure must return the ORIGINAL string, not an equivalent
            // re-serialization — the property that makes splicing safer than regenerating, and the one an
            // unconditional rewrite here would quietly cost every no-op push.
            var wanted = scratch.Elements().ToList();
            if (!stamped && SameShape(entry.Elements().ToList(), wanted)) return xml;

            entry.ReplaceNodes(wanted);
            return PlcOpenDocument.Serialize(doc);
        }

        /// <summary>The member element named <paramref name="name"/> that belongs to <paramref name="owner"/>
        /// itself. Both spellings, because the vendors disagree on case and on home: a method/property is
        /// <c>&lt;Method&gt;</c>/<c>&lt;Property&gt;</c> (under a POU's addData, or an interface's
        /// <c>&lt;Methods&gt;</c> container), an action is a lowercase <c>&lt;action&gt;</c> under
        /// <c>&lt;actions&gt;</c>.</summary>
        private static XElement? MemberElement(XElement owner, string name) =>
            new[] { "Method", "method", "Property", "property", "action", "Action" }
                .SelectMany(n => PlcOpenDocument.OwnDescendants(owner, n))
                .FirstOrDefault(e => string.Equals((string?)e.Attribute("name"), name, StringComparison.OrdinalIgnoreCase));

        /// <summary>The member's object id, minted and stamped onto the element if the document has none yet.
        /// <para>WHERE the id lives differs by member shape, and that is read off TwinCAT's own export rather than
        /// chosen: a <c>&lt;Method&gt;</c>/<c>&lt;Property&gt;</c> carries it as an ATTRIBUTE, an
        /// <c>&lt;action&gt;</c> as a nested <c>&lt;addData&gt;&lt;data name="…/objectid"&gt;&lt;ObjectId&gt;</c>
        /// element. Putting an attribute on an action would be a shape no vendor emits.</para></summary>
        private static string IdOf(XElement member, XNamespace ns, ref bool stamped)
        {
            if (member.Name.LocalName is not ("action" or "Action"))
            {
                if ((string?)member.Attribute("ObjectId") is { Length: > 0 } present) return present;
                var minted = Guid.NewGuid().ToString();
                member.SetAttributeValue("ObjectId", minted);
                stamped = true;
                return minted;
            }

            var slot = member.Descendants().FirstOrDefault(e => e.Name.LocalName == "ObjectId");
            if (slot is not null && slot.Value.Length > 0) return slot.Value;

            var id = Guid.NewGuid().ToString();
            var addData = member.Elements().FirstOrDefault(e => e.Name.LocalName == "addData");
            if (addData is null) { addData = new XElement(ns + "addData"); member.Add(addData); }
            addData.Add(new XElement(ns + "data",
                new XAttribute("name", ThreeSObjectId),
                new XAttribute("handleUnknown", "discard"),
                new XElement(ns + "ObjectId", id)));
            stamped = true;
            return id;
        }


        private static bool SameShape(List<XElement> a, List<XElement> b) =>
            a.Count == b.Count && a.Zip(b, XNode.DeepEquals).All(same => same);
    }
}
