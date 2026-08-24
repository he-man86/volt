using System;
using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;
using Body_ = Volt.Engine.Body;

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
    /// <para><b>Every language goes through here</b>, graphical included. This used to say graphical bodies were
    /// not this class's business and that a write onto one is refused — true when the only writable language was
    /// ST, and false since the root and child body writers were put on the shared <c>BodyCodec</c> dispatch: an
    /// editable FBD/LD body is ENCODED (via <c>GraphSplice</c>/<c>GraphWriter</c>, which still own the graph
    /// itself), and only a READ-ONLY language (CFC, SFC, IL) or a language CHANGE is refused. While the old rule
    /// stood in the child writer, an FBD method could not be pushed at all — restating one unchanged aborted the
    /// whole push.</para>
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

        /// <summary>Write the item's body — in WHATEVER language the pushed text is.
        /// <para>There is no textual-vs-graphical fork here, and that is the point. The language is read from the
        /// text, the codec for it is looked up, and the codec owns the element: ST patches its <c>&lt;xhtml&gt;</c>
        /// in place (so a no-op write returns the ORIGINAL bytes), network text replaces the whole
        /// <c>&lt;FBD&gt;</c>/<c>&lt;LD&gt;</c> element (its NAME is the language, and the language can change),
        /// and a read-only language refuses.</para>
        /// <para>The ONE rule that used to be three copies: a write is refused when the pushed language differs
        /// from the one in the IDE, or when the IDE's is read-only. That subsumes every case the old guards
        /// covered by hand — including IL, which used to slip through a graphical-only narrowing as "textual" and
        /// then be silently rewritten as ST.</para></summary>
        public static string SetBody(string xml, string itemName, string bodyText, string? declaration)
        {
            var doc = XDocument.Parse(xml);
            var body = PlcOpenDocument.ItemBody(doc, itemName);
            if (body is null)
                // An interface, a DUT and a GVL have NO <body> in their document — they carry a declaration and
                // nothing else. Pushing no code to one is the ordinary case and writes nothing; pushing code IS
                // an error and says so, rather than silently discarding it. (Not a fallback: the two outcomes are
                // different requests, and only one of them is unsatisfiable.)
                return string.IsNullOrEmpty(bodyText) ? xml
                    : throw new InvalidOperationException(
                        $"'{itemName}' has no <body> in its PLCopen document — this kind carries no code of its own");

            var pushed = Body.BodyCodec.For(Body.NetworkText.LanguageOf(bodyText) ?? "ST");
            // A body recording NO language decision (a blank ST — what a fresh POU is created with) counts as no
            // body at all, so establishing FBD on it is the ordinary create rather than a mismatch. An empty
            // <FBD/> does NOT qualify: that POU was made graphical on purpose.
            var found = Body.BodyCodec.PresentWith(body);
            var present = found is { } f && !f.Codec.IsUncommitted(f.Element) ? f.Codec : null;

            if (present is not null && present.ReadOnly)
                throw new InvalidOperationException(
                    $"'{itemName}' is a read-only {present.Language} body — edit it in the IDE, not via push.");
            if (present is not null && !string.Equals(present.Language, pushed.Language, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException(
                    $"'{itemName}' has a {present.Language} body in the IDE but the push carries {pushed.Language} — " +
                    "edit it in the IDE, or delete it first to replace it.");

            return pushed.Encode(body, bodyText, declaration) ? PlcOpenDocument.Serialize(doc) : xml;
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

        private const string ThreeS = "http://www.3s-software.com/plcopenxml/";

        /// <summary>Is this owner an INTERFACE? Both vendors export one as an <c>&lt;Interface&gt;</c> element with
        /// no <c>&lt;pou&gt;</c> anywhere — so the element name is the kind, and no caller has to pass one in.</summary>
        private static bool IsInterface(XElement owner) => owner.Name.LocalName == "Interface";

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
            // The SAME codec dispatch SetChildText uses for an UPDATE. Writing the text verbatim into <ST> meant
            // a member CREATED with an editable FBD/LD body landed as ST source literally reading
            // "NETWORK 1 FBD ..." — accepted by the import and silently wrong. The ordinary way to reach it is a
            // RENAME, which is remove + add, so renaming a graphical method destroyed the very diagram it was
            // renaming. Empty text still yields the vendors' <ST><xhtml/> shape byte-for-byte, because StCodec is
            // the identity codec and takes its "no ST element yet" arm here.
            XElement Body(string value)
            {
                var body = new XElement(ns + "body");
                Body_.BodyCodec.For(Body_.NetworkText.LanguageOf(value) ?? "ST").Encode(body, value, declaration);
                return body;
            }

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
            // An INTERFACE's method is a SIGNATURE — it has no body in the document (measured: CODESYS exports
            // Interface/Methods/Method as interface + InterfaceAsPlainText, no <body>), and the IDE has no slot to
            // put one in. Emitting an empty one would invent an element the vendor never produces.
            if (elementName == "Method" && !IsInterface(owner)) member.Add(Body(bodyText ?? ""));
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
                // An INTERFACE property's accessors are signatures — no <body>, matching the vendor's own export.
                // (Measured: the importer accepts one either way, so this is about not emitting an element the
                // format does not have there, rather than about being rejected.)
                foreach (var acc in new[] { "GetAccessor", "SetAccessor" })
                    member.Add(IsInterface(owner)
                        ? new XElement(ns + acc, new XElement(ns + "interface"))
                        : new XElement(ns + acc, new XElement(ns + "interface"), Body("")));
            }
            if (!string.IsNullOrEmpty(declaration)) member.Add(Text("InterfaceAsPlainText", declaration!));

            // WHERE a member goes is the one thing that differs per KIND, and it is the whole reason the document
            // covers more than POUs now. An INTERFACE groups its members in plain <Methods>/<Properties>
            // containers; a POU hangs each off its own <addData>/<data> wrapper. Same member element, two homes —
            // read off the owner, because the owner element IS the kind.
            if (IsInterface(owner))
            {
                // Method → Methods, Property → PROPERTIES. Naive "+ s" produced <Propertys>, and the importer
                // does not complain about a container it does not recognise — it silently drops the member
                // inside it. The push then reported success while the property never existed, which is why the
                // group name is spelled out per kind rather than derived.
                var group = elementName == "Property" ? "Properties" : elementName + "s";
                var container = owner.Elements().FirstOrDefault(e => e.Name.LocalName == group);
                if (container is null)
                {
                    container = new XElement(ns + group);
                    // Both containers precede the interface's own InterfaceAsPlainText, which stays last.
                    var iapt = owner.Elements().FirstOrDefault(e => e.Name.LocalName == "InterfaceAsPlainText");
                    if (iapt is not null) iapt.AddBeforeSelf(container); else owner.Add(container);
                }
                container.Add(member);
            }
            else
            {
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
            }
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
                // Insert before the property's own InterfaceAsPlainText, which stays last. Deliberately NOT
                // "before the other accessor": the vendors disagree on order — CODESYS emits Set then Get
                // (BoxFB), TwinCAT emits Get then Set (FB_TcMembers) — so a new accessor simply lands after the
                // ones already there, which is valid on both. This comment used to assert "vendors emit Set
                // before Get" as a universal; it was measured on one vendor.
                var iapt = prop.Elements().FirstOrDefault(e => e.Name.LocalName == "InterfaceAsPlainText");
                if (iapt is not null) iapt.AddBeforeSelf(acc); else prop.Add(acc);
                changed = true;
            }

            // An INTERFACE accessor is a signature and has no body anywhere in the vendor's export. `code` is ""
            // for one — a getter that EXISTS but holds no code, which is the whole reason null and "" stay
            // distinct on this path. Anything else is a caller writing code where the format has nowhere to put
            // it, and that is worth failing over rather than dropping.
            if (IsInterface(prop.Ancestors().First(a => a.Name.LocalName is "Interface" or "pou")))
            {
                if (!string.IsNullOrEmpty(code))
                    throw new InvalidOperationException(
                        $"interface property '{propertyName}' cannot carry {(getter ? "getter" : "setter")} code — " +
                        "an interface accessor is declaration-only");
            }
            else
            {
                var body = acc.Elements().FirstOrDefault(e => e.Name.LocalName == "body");
                if (body is null) { body = new XElement(ns + "body"); acc.Add(body); changed = true; }
                var st = body.Elements().FirstOrDefault(e => e.Name.LocalName == "ST");
                if (st is null) { st = new XElement(ns + "ST"); body.RemoveNodes(); body.Add(st); changed = true; }
                var innerBody = st.Elements().FirstOrDefault(e => e.Name.LocalName == "xhtml");
                if (innerBody is null) { if (st.Value != code) { st.ReplaceNodes(new XElement(xh + "xhtml", code)); changed = true; } }
                else if (innerBody.Value != code) { innerBody.ReplaceNodes(code); changed = true; }
            }

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
                                          string? declaration, string? bodyText, string? scopeDeclaration)
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
                // The SAME dispatch the ROOT body uses (SetBody above) — not a second, stricter rule. A child was
                // held to "ST or refuse" long after the root learned to encode editable graphical bodies, so an
                // FBD/LD METHOD or ACTION could not be pushed AT ALL: restating one unchanged aborted the whole
                // push. Only a READ-ONLY body (CFC/SFC) and a language CHANGE are refusals; a CFC method child is
                // still the shape that first exposed the direct-children blind spot, and CfcCodec.Locate is what
                // keeps that covered.
                var pushed = Body.BodyCodec.For(Body.NetworkText.LanguageOf(bodyText) ?? "ST");
                var found = Body.BodyCodec.PresentWith(body);
                var present = found is { } f && !f.Codec.IsUncommitted(f.Element) ? f.Codec : null;
                if (present is not null && present.ReadOnly)
                    throw new InvalidOperationException(
                        $"child '{childName}' of '{itemName}' has a read-only {present.Language} body — " +
                        "edit it in the IDE, not via push.");
                if (present is not null && !string.Equals(present.Language, pushed.Language, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException(
                        $"child '{childName}' of '{itemName}' has a {present.Language} body in the IDE but the " +
                        $"push carries {pushed.Language} — edit it in the IDE, or delete it first to replace it.");
                changed |= pushed.Encode(body, bodyText, scopeDeclaration);
            }

            return changed ? PlcOpenDocument.Serialize(doc) : xml;
        }
    }
}
