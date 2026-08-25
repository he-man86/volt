using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Model;
using Volt.Engine.Vocabulary;

namespace Volt.Engine.Document;

/// <summary>Build the ONE PLCopen document a POU write travels in, by SPLICING the pushed source into the item's
/// CURRENT export — never by generating a document from scratch. Everything Volt does not model (attributes,
/// pragmas, object ids, vendor <c>addData</c>, a read-only CFC child's body) is carried through untouched because
/// it is never rewritten.
/// <para>This is the whole reason the change exists: reading and writing a POU through the SAME representation
/// removes the seam all three data-loss bugs lived in — a graphical child flattened because the read said
/// "graphical" and the write decided from text; a body spliced into the wrong element because the read scoped by
/// name and the write by document order; an accessor created as a function block named "Get".</para>
/// <para>Child ADD, UPDATE and REMOVE all travel in this document. Measured on CODESYS 3.5.21.40: a merge import
/// adds a child present only in the document and removes one absent from it — so there is no orphan-deletion walk
/// to run afterwards. What the document CANNOT express is placement: the import flattens POU-internal folders, and
/// <see cref="Volt.Engine.Ide.IProjectTree.Move"/> restores it.</para></summary>
public static class PouDocument
{
    /// <summary>Splice <paramref name="split"/> into <paramref name="xml"/> (the item's own export) and return the
    /// document to import. Order matters: children are reconciled BEFORE the root's declaration and body, so a
    /// failure in the (many, fiddly) child splices happens while the root text is still the original — the whole
    /// document is then discarded unimported, and the IDE is untouched.</summary>
    // ponytail: each splice call re-parses the document, so this is O(children × document). On the corpus's worst
    // POU (68 KB, 54 children) that is well under the pipe's own latency. If it ever shows up in a profile, the
    // upgrade is one XDocument threaded through the splice surface — not a second, batched writer.
    /// <param name="establishing">This item was CREATED by the push in hand, so the body now in the document is
    /// the seed <c>CreateChild</c> just laid down — not an engineer's. The language guard is skipped for it; see
    /// <see cref="PouSplice.SetBody"/>. No default: the two call sites mean different things and a caller that has
    /// to say which cannot get it wrong by omission.</param>
    public static string Splice(string xml, string name, ItemContent split, bool establishing)
    {
        var parsed = PouReader.Parse(xml);
        // The document's own view of what the item HAS, name → member SHAPE. The shape is the other half of the
        // add-vs-update answer: name alone made a member whose KIND changed look like an ordinary update, and the
        // three shapes are not interchangeable — a <Method> owns a <body>, a <Property> owns accessors and no
        // body of its own, an <action> owns no declaration at all. Turning a method into a property in the
        // workspace therefore spliced property text into a method element. A property is a child too: the parser
        // reports it in Properties, not Children.
        var present = new Dictionary<string, PouMember>(StringComparer.OrdinalIgnoreCase);
        foreach (var c in parsed.Children)
            present[c.Name] = c.Shape;
        foreach (var pr in parsed.Properties) present[pr.Name] = PouMember.Property;
        var pushed = new HashSet<string>(split.Members.Select(c => c.Name), StringComparer.OrdinalIgnoreCase);
        var isInterface = split.Kind == ItemKind.Kinds.Interface;

        // Children the push dropped. This replaces the COM orphan walk, and it is strictly better: the walk had to
        // recurse the POU's folders to find them, whereas the export lists every child flat regardless of folder.
        foreach (var gone in present.Keys.Where(n => !pushed.Contains(n)).ToList())
            xml = PouSplice.RemoveChild(xml, name, gone);

        foreach (var child in split.Members)
        {
            // An ACTION is body-only — its `ACTION name` line is synthesized on read, never persisted, so writing
            // one puts a declaration where nothing reads it back. A PROPERTY node has no body of its own; its code
            // lives in the accessors, written below.
            var decl = child.Kind == ItemKind.Kinds.Action ? null : child.Declaration;
            // No body when the member cannot hold one: a PROPERTY node's code lives in its accessors (written
            // below), and every member of an INTERFACE is a signature — the interface document has no <body>
            // element anywhere, for the item or its members.
            var body = child.Kind == ItemKind.Kinds.Property || isInterface ? null : child.Body;

            // A READ-ONLY body (CFC/SFC) materializes as a marker comment, not as source. `null` here means
            // "leave the member's body exactly as it is" — which is the only correct thing to do with a diagram
            // we cannot represent. It must NOT be written (that replaces the engineer's diagram with a comment)
            // and it must NOT be dropped: the member stays in `pushed`, so the removal pass above leaves it be.
            // This is what makes a POU that merely CONTAINS a CFC member editable at all — before it, the guard
            // refused the entire push, so such a POU could not be touched even to edit its own root body.
            if (Vocabulary.BodyMarker.Is(body)) body = null;

            // The scope an FB instance in a CHILD body resolves against is BOTH declarations: an instance used
            // in a method can be declared in the method's own VAR block or in the enclosing POU's. Network text
            // carries only the instance NAME, so without this the child's FB boxes are written typeName="".
            var childScope = split.Declaration + Environment.NewLine + (child.Declaration ?? "");
            var wanted = MemberOf(child.Kind);
            // A member whose SHAPE changed is a remove + add, not an update — the same thing §3.2 already
            // defines a child RENAME as. Updating in place would splice, say, property text into the <Method>
            // element that still carries the old shape.
            if (present.TryGetValue(child.Name, out var had) && had != wanted)
            {
                xml = PouSplice.RemoveChild(xml, name, child.Name);
                present.Remove(child.Name);
            }
            xml = present.ContainsKey(child.Name)
                ? PouSplice.SetChildText(xml, name, child.Name, decl, body, childScope)
                : PouSplice.AddChild(xml, name, child.Name, wanted, decl, body);

            if (child.Kind != ItemKind.Kinds.Property) continue;
            // null code REMOVES the accessor — that is how a push drops a getter, and why the reader keeps an
            // absent accessor (null) distinct from a present-but-bodiless one ("").
            xml = PouSplice.SetAccessor(xml, name, child.Name, true, child.Getter?.Code, child.Getter?.Declaration);
            xml = PouSplice.SetAccessor(xml, name, child.Name, false, child.Setter?.Code, child.Setter?.Declaration);
        }

        xml = PouSplice.SetDeclaration(xml, name, split.Declaration);
        xml = PouSplice.SetBody(xml, name, split.Body, split.Declaration, establishing);

        // LAST, because it describes what the splices above left behind: the document's own structure block has to
        // agree with the members the document now carries. It is not decoration on TwinCAT — its importer creates a
        // POU child ONLY if the block declares it (DIALECT D4h), so every method, action and property of a
        // one-document write was being dropped there in silence. CODESYS emits the block `handleUnknown="discard"`
        // and throws it away, which is exactly why the disagreement could stand this long.
        return ProjectStructure.Sync(xml, name, split.Members.Select(c => c.Name).ToList());
    }

    /// <summary>Volt's wire kind → the PLCopen member shape. This mapping lives HERE, in the layer that knows what
    /// a push is, so the document layer never has to know Volt's vocabulary. No fallback: an unrecognized child
    /// kind is a bug (a new kind missed here), not a method.</summary>
    private static PouMember MemberOf(string kind) => kind switch
    {
        ItemKind.Kinds.Method => PouMember.Method,
        ItemKind.Kinds.Action => PouMember.Action,
        ItemKind.Kinds.Property => PouMember.Property,
        _ => throw new BridgeException(BridgeErrorCodes.BadRequest,
            $"unknown POU child kind '{kind}' — only method, action and property have a PLCopen member shape"),
    };
}
