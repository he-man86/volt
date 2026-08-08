using System;
using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;

namespace Volt.Engine.PlcOpen
{
    /// <summary>The three member shapes a PLCopen POU document can carry. Deliberately NOT
    /// <c>Workspace.ItemKind.Kinds</c>: those are Volt's WIRE vocabulary, and taking them here made the document
    /// layer depend UPWARD on Workspace policy for no reason — the document only ever needs to know which of three
    /// element shapes to build. The mapping from a pushed item's kind to one of these belongs to the caller that
    /// knows about pushes (<c>Sync.PouDocument</c>).</summary>
    public enum PouMember { Method, Action, Property }

    /// <summary>The whole-POU WRITE splice: declaration, textual body, child add/update/remove, and property
    /// accessors. It EDITS the item's existing export rather than generating a document — an export carries
    /// attributes, pragmas, object ids and vendor addData that Volt does not model, and regenerating would
    /// silently drop every one of them.
    /// <para>Two properties make splicing safer than regenerating, and both are tested: a write is scoped to the
    /// NAMED item, and a write that changes nothing returns the ORIGINAL string byte-for-byte.</para>
    /// <para>Graphical bodies are NOT this class's business — a textual write onto one is refused, not flattened.
    /// <c>Graphical.GraphicalBodySplice</c> owns that.</para>
    /// </summary>
    public static class PouSplice
    {
        /// <summary>Write the item's DECLARATION into its own <c>&lt;InterfaceAsPlainText&gt;</c>.
        /// <para>The plaintext copy is what the IDE reads back on import — verified live on CODESYS with the
        /// typed <c>&lt;interface&gt;</c> block left STALE and the plaintext still winning, so this does not
        /// need to generate typed variable XML from ST.</para>
        /// <para>Throws when the item, or its plaintext block, is absent: a declaration write that silently
        /// did nothing is the failure this whole change exists to remove.</para></summary>
        public static string SetDeclaration(string xml, string itemName, string declaration)
        {
            var doc = XDocument.Parse(xml);
            var owner = PlcOpenDocument.OwnerOf(doc, itemName)
                ?? throw new InvalidOperationException($"PLCopen export has no item named '{itemName}'");
            var blocks = PlcOpenDocument.OwnDescendants(owner, "InterfaceAsPlainText").ToList();
            if (blocks.Count == 0)
                throw new InvalidOperationException(
                    $"PLCopen export for '{itemName}' has no <InterfaceAsPlainText> to write the declaration into");
            // ALL of them — see OwnDescendants. A POU with declared variables carries two copies of its
            // declaration, and updating only the first is a write that reports success and changes nothing.
            var changed = false;
            foreach (var iapt in blocks)
            {
                var inner = iapt.Elements().FirstOrDefault(e => e.Name.LocalName == "xhtml") ?? iapt;
                if (inner.Value == declaration) continue;
                inner.ReplaceNodes(declaration);
                changed = true;
            }
            // Already right → hand back the ORIGINAL string untouched. Re-serializing would still be
            // semantically equal but not byte-equal (an empty <xhtml /> comes back as <xhtml></xhtml>), and
            // "only the bytes we were asked to change" is the property that makes splicing safer than
            // regenerating. A no-op write must be a no-op.
            return changed ? PlcOpenDocument.Serialize(doc) : xml;
        }

        /// <summary>Write the item's TEXTUAL body into its own <c>&lt;body&gt;&lt;ST&gt;</c>. A GRAPHICAL body is
        /// <see cref="SpliceFbdLdBody"/>'s job — this refuses one rather than flattening it, which is the same
        /// refusal the live body-format guard makes and the bug that flattened a CFC child.</summary>
        public static string SetTextualBody(string xml, string itemName, string bodyText)
        {
            var doc = XDocument.Parse(xml);
            var body = PlcOpenDocument.ItemBody(doc, itemName)
                ?? throw new InvalidOperationException($"PLCopen export for '{itemName}' has no <body>");
            // Refuse ANY existing body language that is not ST — not just the graphical ones. IL is textual and
            // would have slipped past a graphical-only guard, then been silently replaced by the `body.RemoveNodes()`
            // below: a language change the caller never asked for and the user never sees. The six languages are
            // the same set PlcOpenPouParser knows; anything present that isn't ST is someone else's body.
            // NestedBodyLanguage, not a direct-children scan: a CODESYS CFC body hangs off <body>/<addData> and
            // carries an empty sibling <ST>, so a direct scan saw only the <ST> and let a textual write through
            // onto a read-only diagram — the exact flattening this guard exists to stop.
            if (NonStBodyLanguage(body) is { } existingLang)
                throw new InvalidOperationException(
                    $"'{itemName}' has a {existingLang} body — a textual (ST) write would replace it");

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
            return PlcOpenDocument.Serialize(doc);
        }

        /// <summary>The CHILD member named <paramref name="childName"/> under the item named
        /// <paramref name="itemName"/>, or null. Both vendors nest a method/property in its own
        /// <c>&lt;addData&gt;/&lt;data name="…/method|property"&gt;</c> wrapper and an action in
        /// <c>&lt;actions&gt;</c>, so the element to REMOVE is the wrapper, not the member — dropping only the
        /// member leaves an empty <c>&lt;data&gt;</c> the IDE has no meaning for.</summary>
        private static (XElement member, XElement removable)? FindChild(XDocument doc, string itemName, string childName)
        {
            var owner = PlcOpenDocument.OwnerOf(doc, itemName);
            if (owner is null) return null;
            var member = owner.Descendants().FirstOrDefault(e =>
                e.Name.LocalName is "Method" or "method" or "Action" or "action" or "Property" or "property"
                && (string?)e.Attribute("name") == childName);
            if (member is null) return null;
            // Walk out to the <data> wrapper when there is one; an <action> sits directly in <actions>.
            var removable = member.Parent is { } p && p.Name.LocalName == "data" ? p : member;
            return (member, removable);
        }

        /// <summary>The body's language when it is anything other than ST, else null — the ONE refusal predicate
        /// both textual writers share. IL counts: it is textual but it is not ST, and a graphical-only guard once
        /// let it through to be silently rewritten as ST. Looks in <c>&lt;body&gt;/&lt;addData&gt;</c> as well as
        /// the direct children, because that is where CODESYS puts a CFC diagram.</summary>
        private static string? NonStBodyLanguage(XElement body) =>
            body.Elements()
                .Concat(body.Elements().Where(e => e.Name.LocalName == "addData")
                    .SelectMany(a => a.Elements().Where(d => d.Name.LocalName == "data"))
                    .SelectMany(d => d.Elements()))
                .FirstOrDefault(e => e.Name.LocalName is "IL" or "FBD" or "LD" or "CFC" or "SFC")
                ?.Name.LocalName;

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
        /// no ground truth for.</para>
        /// <para>NOTE the parameter semantics differ from <see cref="SetChildText"/>, and that is intended, not a
        /// silent default: here a null <paramref name="bodyText"/> means "no body yet" (same as <c>""</c>),
        /// because a member being CREATED has nothing to preserve — "leave it unchanged" has no referent. In
        /// <see cref="SetChildText"/>, which UPDATES, null means "leave it" and <c>""</c> means "clear".</para></summary>
        public static string AddChild(string xml, string itemName, string childName, PouMember kind,
                                      string? declaration, string? bodyText)
        {
            var doc = XDocument.Parse(xml);
            var owner = PlcOpenDocument.OwnerOf(doc, itemName)
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

            if (kind == PouMember.Action)
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
                return PlcOpenDocument.Serialize(doc);
            }

            var (elementName, dataName) = kind switch
            {
                PouMember.Method => ("Method", "method"),
                PouMember.Property => ("Property", "property"),
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
            return PlcOpenDocument.Serialize(doc);
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
            var prop = PlcOpenDocument.OwnerOf(doc, itemName)?.Descendants().FirstOrDefault(e =>
                    e.Name.LocalName is "Property" or "property" && (string?)e.Attribute("name") == propertyName)
                ?? throw new InvalidOperationException($"'{itemName}' has no property named '{propertyName}'");

            var tag = getter ? "GetAccessor" : "SetAccessor";
            var acc = prop.Elements().FirstOrDefault(e => e.Name.LocalName == tag);

            if (code is null)
            {
                // Absent already ⇒ nothing to do. This is DECLARATIVE ("the property has no getter"), unlike
                // RemoveChild, which is imperative ("remove this child") and therefore throws when the target
                // isn't there. Not a swallowed failure: the requested end state is the current one.
                if (acc is null) return xml;
                acc.Remove();
                return PlcOpenDocument.Serialize(doc);
            }

            XNamespace ns = prop.Name.Namespace;
            XNamespace xh = "http://www.w3.org/1999/xhtml";
            // §2.5's identity rule, here too: a push re-states both accessors of every property, so most calls
            // through this method change nothing and must hand back the original bytes.
            var changed = false;
            if (acc is null)
            {
                acc = new XElement(ns + tag, new XElement(ns + "interface"));
                // Vendors emit Set before Get; keep the property's own InterfaceAsPlainText last.
                var iapt = prop.Elements().FirstOrDefault(e => e.Name.LocalName == "InterfaceAsPlainText");
                if (iapt is not null) iapt.AddBeforeSelf(acc); else prop.Add(acc);
                changed = true;
            }

            var body = acc.Elements().FirstOrDefault(e => e.Name.LocalName == "body");
            if (body is null) { body = new XElement(ns + "body"); acc.Add(body); changed = true; }
            var st = body.Elements().FirstOrDefault(e => e.Name.LocalName == "ST");
            if (st is null) { st = new XElement(ns + "ST"); body.RemoveNodes(); body.Add(st); changed = true; }
            var innerBody = st.Elements().FirstOrDefault(e => e.Name.LocalName == "xhtml");
            if (innerBody is null) { if (st.Value != code) { st.ReplaceNodes(new XElement(xh + "xhtml", code)); changed = true; } }
            else if (innerBody.Value != code) { innerBody.ReplaceNodes(code); changed = true; }

            if (declaration is not null)
            {
                var accIapt = acc.Elements().FirstOrDefault(e => e.Name.LocalName == "InterfaceAsPlainText");
                if (accIapt is null)
                {
                    acc.Add(new XElement(ns + "InterfaceAsPlainText", new XElement(xh + "xhtml", declaration)));
                    changed = true;
                }
                else
                {
                    var inner = accIapt.Elements().FirstOrDefault(e => e.Name.LocalName == "xhtml") ?? accIapt;
                    if (inner.Value != declaration) { inner.ReplaceNodes(declaration); changed = true; }
                }
            }
            return changed ? PlcOpenDocument.Serialize(doc) : xml;
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
            return PlcOpenDocument.Serialize(doc);
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
            // Same rule as SetDeclaration/SetTextualBody (§2.5): a write that changes nothing returns the ORIGINAL
            // string, so a no-op cannot perturb the serialization. This matters far more here than on the root —
            // a push re-states EVERY child, so on a typical edit almost every call through this method is a no-op.
            var changed = false;

            if (declaration is not null)
            {
                // Every copy, for the same reason as SetDeclaration: a method that declares VAR_INPUT gets a
                // second plaintext block inside its own typed <interface>.
                var blocks = PlcOpenDocument.OwnDescendants(member, "InterfaceAsPlainText").ToList();
                if (blocks.Count == 0)
                    throw new InvalidOperationException(
                        $"child '{childName}' of '{itemName}' has no <InterfaceAsPlainText> to write into");
                foreach (var iapt in blocks)
                {
                    var inner = iapt.Elements().FirstOrDefault(e => e.Name.LocalName == "xhtml") ?? iapt;
                    if (inner.Value != declaration) { inner.ReplaceNodes(declaration); changed = true; }
                }
            }

            if (bodyText is not null)
            {
                var body = member.Elements().FirstOrDefault(e => e.Name.LocalName == "body")
                    ?? throw new InvalidOperationException($"child '{childName}' of '{itemName}' has no <body>");
                // Same rule as SetTextualBody, including the nested lookup — a CFC METHOD child is the shape that
                // first exposed the direct-children blind spot.
                if (NonStBodyLanguage(body) is { } existingLang)
                    throw new InvalidOperationException(
                        $"child '{childName}' has a {existingLang} body — a textual (ST) write would replace it");
                var st = body.Elements().FirstOrDefault(e => e.Name.LocalName == "ST");
                if (st is null)
                {
                    st = new XElement(body.Name.Namespace + "ST");
                    body.RemoveNodes();
                    body.Add(st);
                    changed = true;
                }
                var innerBody = st.Elements().FirstOrDefault(e => e.Name.LocalName == "xhtml");
                if (innerBody is null) { if (st.Value != bodyText) { st.ReplaceNodes(bodyText); changed = true; } }
                else if (innerBody.Value != bodyText) { innerBody.ReplaceNodes(bodyText); changed = true; }
            }

            return changed ? PlcOpenDocument.Serialize(doc) : xml;
        }
    }
}
