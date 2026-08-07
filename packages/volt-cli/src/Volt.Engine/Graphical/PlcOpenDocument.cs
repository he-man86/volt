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


        // ── the write splice ────────────────────────────────────────────────────────────────────────────
        // These EDIT the item's existing export rather than generating a document. That is deliberate: an
        // export carries attributes, pragmas, object ids and vendor addData that Volt does not model, and
        // regenerating would silently drop every one of them. Splicing keeps the bytes we were not asked to
        // change — see the identity test in PlcOpenSpliceTests.

        /// <summary>The element that OWNS the item named <paramref name="itemName"/> — the same resolution
        /// <see cref="ItemBody"/> uses, widened to the declaration-only kinds. One export describes several
        /// items, so every write is scoped by name; writing to the first match in the document is exactly the
        /// bug that spliced a body over a sibling method.</summary>
        private static XElement? OwnerOf(XDocument doc, string itemName) =>
            doc.Descendants().FirstOrDefault(e =>
                e.Name.LocalName is "pou" or "Interface" or "dataType" or "globalVars"
                    or "method" or "Method" or "action" or "Action"
                && (string?)e.Attribute("name") == itemName);

        /// <summary>Write the item's DECLARATION into its own <c>&lt;InterfaceAsPlainText&gt;</c>.
        /// <para>The plaintext copy is what the IDE reads back on import — verified live on CODESYS with the
        /// typed <c>&lt;interface&gt;</c> block left STALE and the plaintext still winning, so this does not
        /// need to generate typed variable XML from ST.</para>
        /// <para>Throws when the item, or its plaintext block, is absent: a declaration write that silently
        /// did nothing is the failure this whole change exists to remove.</para></summary>
        public static string SetDeclaration(string xml, string itemName, string declaration)
        {
            var doc = XDocument.Parse(xml);
            var owner = OwnerOf(doc, itemName)
                ?? throw new InvalidOperationException($"PLCopen export has no item named '{itemName}'");
            var iapt = OwnDescendant(owner, "InterfaceAsPlainText")
                ?? throw new InvalidOperationException(
                    $"PLCopen export for '{itemName}' has no <InterfaceAsPlainText> to write the declaration into");
            var inner = iapt.Elements().FirstOrDefault(e => e.Name.LocalName == "xhtml") ?? iapt;
            // Already right → hand back the ORIGINAL string untouched. Re-serializing would still be
            // semantically equal but not byte-equal (an empty <xhtml /> comes back as <xhtml></xhtml>), and
            // "only the bytes we were asked to change" is the property that makes splicing safer than
            // regenerating. A no-op write must be a no-op.
            if (inner.Value == declaration) return xml;
            inner.ReplaceNodes(declaration);
            return doc.ToString();
        }

        /// <summary>Write the item's TEXTUAL body into its own <c>&lt;body&gt;&lt;ST&gt;</c>. A GRAPHICAL body is
        /// <see cref="SpliceFbdLdBody"/>'s job — this refuses one rather than flattening it, which is the same
        /// refusal the live body-format guard makes and the bug that flattened a CFC child.</summary>
        public static string SetTextualBody(string xml, string itemName, string bodyText)
        {
            var doc = XDocument.Parse(xml);
            var body = ItemBody(doc, itemName)
                ?? throw new InvalidOperationException($"PLCopen export for '{itemName}' has no <body>");
            var graphical = body.Elements().FirstOrDefault(e => e.Name.LocalName is "FBD" or "LD" or "CFC" or "SFC");
            if (graphical is not null)
                throw new InvalidOperationException(
                    $"'{itemName}' has a {graphical.Name.LocalName} body — a textual write would flatten it");

            var ns = body.Name.Namespace;
            var st = body.Elements().FirstOrDefault(e => e.Name.LocalName == "ST");
            // Already right → return the ORIGINAL string. Same reason as SetDeclaration: a no-op write must not
            // perturb the serialization (an empty <xhtml /> re-serializes as <xhtml></xhtml>).
            if (st is not null)
            {
                var existing = st.Elements().FirstOrDefault(e => e.Name.LocalName == "xhtml");
                if ((existing?.Value ?? st.Value) == bodyText) return xml;
            }
            if (st is null)
            {
                st = new XElement(ns + "ST");
                body.RemoveNodes();
                body.Add(st);
            }
            // The text lives in an inner <xhtml>; keep the vendor's wrapper element (and its namespace) when it
            // is already there, so the only bytes that move are the code itself.
            var inner = st.Elements().FirstOrDefault(e => e.Name.LocalName == "xhtml");
            if (inner is null) st.ReplaceNodes(bodyText);
            else inner.ReplaceNodes(bodyText);
            return doc.ToString();
        }

        /// <summary>The CHILD member named <paramref name="childName"/> under the item named
        /// <paramref name="itemName"/>, or null. Both vendors nest a method/property in its own
        /// <c>&lt;addData&gt;/&lt;data name="…/method|property"&gt;</c> wrapper and an action in
        /// <c>&lt;actions&gt;</c>, so the element to REMOVE is the wrapper, not the member — dropping only the
        /// member leaves an empty <c>&lt;data&gt;</c> the IDE has no meaning for.</summary>
        private static (XElement member, XElement removable)? FindChild(XDocument doc, string itemName, string childName)
        {
            var owner = OwnerOf(doc, itemName);
            if (owner is null) return null;
            var member = owner.Descendants().FirstOrDefault(e =>
                e.Name.LocalName is "Method" or "method" or "Action" or "action" or "Property" or "property"
                && (string?)e.Attribute("name") == childName);
            if (member is null) return null;
            // Walk out to the <data> wrapper when there is one; an <action> sits directly in <actions>.
            var removable = member.Parent is { } p && p.Name.LocalName == "data" ? p : member;
            return (member, removable);
        }

        private const string ThreeS = "http://www.3s-software.com/plcopenxml/";

        /// <summary>Add a child MEMBER that is not in the document yet, built to the vendors' shape:
        /// <code>
        ///   &lt;addData&gt;&lt;data name="…/method"&gt;&lt;Method name="X"&gt;
        ///       &lt;interface/&gt;
        ///       &lt;body&gt;&lt;ST&gt;&lt;xhtml&gt;…&lt;/xhtml&gt;&lt;/ST&gt;&lt;/body&gt;
        ///       &lt;InterfaceAsPlainText&gt;&lt;xhtml&gt;…&lt;/xhtml&gt;&lt;/InterfaceAsPlainText&gt;
        /// </code>
        /// An ACTION is body-only and lives in <c>&lt;actions&gt;</c> instead — it has no declaration at all
        /// (its <c>ACTION name</c> line is synthesized on read, never persisted), so passing one is refused
        /// rather than written somewhere it will not be read back.
        /// <para>Kept SEPARATE from <see cref="SetChildText"/> on purpose: "create" and "update" are different
        /// intents, and a call that silently did either would hide which one the push meant.</para>
        /// <para>Deliberately MINIMAL — only the elements the reader parses. Vendor extras (access modifiers,
        /// object ids) are the IDE's to add on import; inventing them here would be guessing at a shape we have
        /// no ground truth for.</para></summary>
        public static string AddChild(string xml, string itemName, string childName, string kind,
                                      string? declaration, string? bodyText)
        {
            var doc = XDocument.Parse(xml);
            var owner = OwnerOf(doc, itemName)
                ?? throw new InvalidOperationException($"PLCopen export has no item named '{itemName}'");
            if (FindChild(doc, itemName, childName) is not null)
                throw new InvalidOperationException(
                    $"'{itemName}' already has a child named '{childName}' — use SetChildText to update it");

            XNamespace ns = owner.Name.Namespace;
            XNamespace xh = "http://www.w3.org/1999/xhtml";
            XElement Text(string name, string value) =>
                new(ns + name, new XElement(xh + "xhtml", value));
            XElement Body(string value) =>
                new(ns + "body", new XElement(ns + "ST", new XElement(xh + "xhtml", value)));

            if (kind == Workspace.ItemKind.Kinds.Action)
            {
                if (!string.IsNullOrEmpty(declaration))
                    throw new InvalidOperationException(
                        $"action '{childName}' cannot carry a declaration — an action is body-only");
                var actions = owner.Elements().FirstOrDefault(e => e.Name.LocalName == "actions");
                if (actions is null)
                {
                    actions = new XElement(ns + "actions");
                    // <actions> precedes <body> in the schema; put it before if there is one.
                    var body = owner.Elements().FirstOrDefault(e => e.Name.LocalName == "body");
                    if (body is not null) body.AddBeforeSelf(actions); else owner.Add(actions);
                }
                actions.Add(new XElement(ns + "action", new XAttribute("name", childName), Body(bodyText ?? "")));
                return doc.ToString();
            }

            var (elementName, dataName) = kind switch
            {
                Workspace.ItemKind.Kinds.Method => ("Method", "method"),
                Workspace.ItemKind.Kinds.Property => ("Property", "property"),
                _ => throw new InvalidOperationException(
                    $"cannot add child kind '{kind}' to '{itemName}' — only method, action and property have a " +
                    "PLCopen member shape"),
            };

            var member = new XElement(ns + elementName, new XAttribute("name", childName), new XElement(ns + "interface"));
            if (elementName == "Method") member.Add(Body(bodyText ?? ""));
            if (elementName == "Property")
            {
                // A property's CODE lives in its accessors, not on itself, so `bodyText` is the accessor set:
                // "get\n…" / "set\n…" is not a format we invent here — the caller passes accessors explicitly
                // via SetAccessor below. What we build is the pair of empty accessors the declaration implies,
                // because a property with neither is not a property.
                // NB the vendors' own properties also carry <interface><returnType>, which we do NOT emit: the
                // type is in the plaintext declaration (`PROPERTY X : INT`), and deriving the typed element from
                // ST needs an elementary-vs-derived type table — the generation this change exists to avoid.
                // Whether the IDE accepts that is the LIVE gate's question, not something the parser can answer.
                foreach (var acc in new[] { "GetAccessor", "SetAccessor" })
                    member.Add(new XElement(ns + acc, new XElement(ns + "interface"), Body("")));
            }
            if (!string.IsNullOrEmpty(declaration)) member.Add(Text("InterfaceAsPlainText", declaration!));

            // Members hang off the OWNER's own <addData>, one <data> wrapper each.
            var ownAddData = owner.Elements().LastOrDefault(e => e.Name.LocalName == "addData");
            if (ownAddData is null)
            {
                ownAddData = new XElement(ns + "addData");
                owner.Add(ownAddData);
            }
            ownAddData.Add(new XElement(ns + "data",
                new XAttribute("name", ThreeS + dataName),
                new XAttribute("handleUnknown", "implementation"),
                member));
            return doc.ToString();
        }

        /// <summary>Write one of a property's ACCESSORS. A property's code lives here, not on the property
        /// itself, so this is what carries a getter's or setter's body and declaration.
        /// <para><paramref name="code"/> null REMOVES the accessor — that is how a push drops a getter, and it
        /// is why the reader distinguishes an absent accessor (null) from a present-but-bodiless one (<c>""</c>).
        /// Collapsing those two would delete a user's getter on every push of an interface property.</para></summary>
        public static string SetAccessor(string xml, string itemName, string propertyName, bool getter,
                                         string? code, string? declaration)
        {
            var doc = XDocument.Parse(xml);
            var prop = OwnerOf(doc, itemName)?.Descendants().FirstOrDefault(e =>
                    e.Name.LocalName is "Property" or "property" && (string?)e.Attribute("name") == propertyName)
                ?? throw new InvalidOperationException($"'{itemName}' has no property named '{propertyName}'");

            var tag = getter ? "GetAccessor" : "SetAccessor";
            var acc = prop.Elements().FirstOrDefault(e => e.Name.LocalName == tag);

            if (code is null)
            {
                if (acc is null) return xml;          // already absent — a no-op must move no bytes
                acc.Remove();
                return doc.ToString();
            }

            XNamespace ns = prop.Name.Namespace;
            XNamespace xh = "http://www.w3.org/1999/xhtml";
            if (acc is null)
            {
                acc = new XElement(ns + tag, new XElement(ns + "interface"));
                // Vendors emit Set before Get; keep the property's own InterfaceAsPlainText last.
                var iapt = prop.Elements().FirstOrDefault(e => e.Name.LocalName == "InterfaceAsPlainText");
                if (iapt is not null) iapt.AddBeforeSelf(acc); else prop.Add(acc);
            }

            var body = acc.Elements().FirstOrDefault(e => e.Name.LocalName == "body");
            if (body is null) { body = new XElement(ns + "body"); acc.Add(body); }
            var st = body.Elements().FirstOrDefault(e => e.Name.LocalName == "ST");
            if (st is null) { st = new XElement(ns + "ST"); body.RemoveNodes(); body.Add(st); }
            var innerBody = st.Elements().FirstOrDefault(e => e.Name.LocalName == "xhtml");
            if (innerBody is null) { if (st.Value != code) st.ReplaceNodes(new XElement(xh + "xhtml", code)); }
            else if (innerBody.Value != code) innerBody.ReplaceNodes(code);

            if (declaration is not null)
            {
                var accIapt = acc.Elements().FirstOrDefault(e => e.Name.LocalName == "InterfaceAsPlainText");
                if (accIapt is null)
                    acc.Add(new XElement(ns + "InterfaceAsPlainText", new XElement(xh + "xhtml", declaration)));
                else
                {
                    var inner = accIapt.Elements().FirstOrDefault(e => e.Name.LocalName == "xhtml") ?? accIapt;
                    if (inner.Value != declaration) inner.ReplaceNodes(declaration);
                }
            }
            return doc.ToString();
        }

        /// <summary>Remove a child member from the item's document. Throws when it isn't there — a push that
        /// asks to delete something absent is a disagreement about state, not a no-op to swallow.</summary>
        public static string RemoveChild(string xml, string itemName, string childName)
        {
            var doc = XDocument.Parse(xml);
            var hit = FindChild(doc, itemName, childName)
                ?? throw new InvalidOperationException($"'{itemName}' has no child named '{childName}' to remove");
            // If the wrapper was this member's only content, take the wrapper's empty <addData> parent too.
            var addData = hit.removable.Parent;
            hit.removable.Remove();
            if (addData is { } ad && ad.Name.LocalName == "addData" && !ad.Elements().Any()) ad.Remove();
            return doc.ToString();
        }

        /// <summary>Write an EXISTING child's declaration and/or body, leaving everything else about it alone.
        /// A null argument means "don't touch" — distinct from an empty string, which clears.
        /// <para>Adding a child that isn't there yet is deliberately NOT this method's job: it needs a whole
        /// member element built to the vendor's shape, and silently creating one here would hide the difference
        /// between "update this" and "create this" at exactly the layer that must not guess.</para></summary>
        public static string SetChildText(string xml, string itemName, string childName,
                                          string? declaration, string? bodyText)
        {
            var doc = XDocument.Parse(xml);
            var hit = FindChild(doc, itemName, childName)
                ?? throw new InvalidOperationException($"'{itemName}' has no child named '{childName}'");
            var member = hit.member;

            if (declaration is not null)
            {
                var iapt = OwnDescendant(member, "InterfaceAsPlainText")
                    ?? throw new InvalidOperationException(
                        $"child '{childName}' of '{itemName}' has no <InterfaceAsPlainText> to write into");
                var inner = iapt.Elements().FirstOrDefault(e => e.Name.LocalName == "xhtml") ?? iapt;
                if (inner.Value != declaration) inner.ReplaceNodes(declaration);
            }

            if (bodyText is not null)
            {
                var body = member.Elements().FirstOrDefault(e => e.Name.LocalName == "body")
                    ?? throw new InvalidOperationException($"child '{childName}' of '{itemName}' has no <body>");
                var graphical = body.Elements().FirstOrDefault(e => e.Name.LocalName is "FBD" or "LD" or "CFC" or "SFC");
                if (graphical is not null)
                    throw new InvalidOperationException(
                        $"child '{childName}' has a {graphical.Name.LocalName} body — a textual write would flatten it");
                var st = body.Elements().FirstOrDefault(e => e.Name.LocalName == "ST");
                if (st is null)
                {
                    st = new XElement(body.Name.Namespace + "ST");
                    body.RemoveNodes();
                    body.Add(st);
                }
                var innerBody = st.Elements().FirstOrDefault(e => e.Name.LocalName == "xhtml");
                if (innerBody is null) { if (st.Value != bodyText) st.ReplaceNodes(bodyText); }
                else if (innerBody.Value != bodyText) innerBody.ReplaceNodes(bodyText);
            }

            return doc.ToString();
        }

        /// <summary>A descendant belonging to <paramref name="owner"/> ITSELF, not to a child member nested
        /// inside it — the same containment rule <c>PlcOpenPouParser.DeclFromElement</c> applies, because a
        /// method and an accessor each carry their own InterfaceAsPlainText.</summary>
        private static XElement? OwnDescendant(XElement owner, string localName) =>
            owner.Descendants()
                .Where(e => e.Name.LocalName == localName)
                .FirstOrDefault(e => !e.Ancestors().TakeWhile(a => a != owner)
                    .Any(a => a.Name.LocalName is "pou" or "Method" or "method" or "Action" or "action"
                        or "Property" or "property" or "GetAccessor" or "SetAccessor"));

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
