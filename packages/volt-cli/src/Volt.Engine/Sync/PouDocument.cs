using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Cli.Transport;
using Volt.Engine.Graphical;
using Volt.Engine.Workspace;
using Volt.Engine.Workspace.SourceText;
using Volt.Engine.PlcOpen;

namespace Volt.Engine.Sync;

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
    public static string Splice(string xml, string name, StSplitter.StSplitResult split)
    {
        var parsed = PouReader.Parse(xml);
        // The document's own view of what the item HAS — the only honest basis for add-vs-update. A property is a
        // child too: the parser reports it in Properties, not Children.
        var present = new HashSet<string>(
            parsed.Children.Select(c => c.Name).Concat(parsed.Properties.Select(p => p.Name)),
            StringComparer.OrdinalIgnoreCase);
        var pushed = new HashSet<string>(split.Children.Select(c => c.Name), StringComparer.OrdinalIgnoreCase);
        var isInterface = split.PouKind == ItemKind.Kinds.Interface;

        // Children the push dropped. This replaces the COM orphan walk, and it is strictly better: the walk had to
        // recurse the POU's folders to find them, whereas the export lists every child flat regardless of folder.
        foreach (var gone in present.Where(n => !pushed.Contains(n)).ToList())
            xml = PouSplice.RemoveChild(xml, name, gone);

        foreach (var child in split.Children)
        {
            // An ACTION is body-only — its `ACTION name` line is synthesized on read, never persisted, so writing
            // one puts a declaration where nothing reads it back. A PROPERTY node has no body of its own; its code
            // lives in the accessors, written below.
            var decl = child.Kind == ItemKind.Kinds.Action ? null : child.Declaration;
            // No body when the member cannot hold one: a PROPERTY node's code lives in its accessors (written
            // below), and every member of an INTERFACE is a signature — the interface document has no <body>
            // element anywhere, for the item or its members.
            var body = child.Kind == ItemKind.Kinds.Property || isInterface ? null : child.Implementation;

            // A READ-ONLY body (CFC/SFC) materializes as a marker comment, not as source. `null` here means
            // "leave the member's body exactly as it is" — which is the only correct thing to do with a diagram
            // we cannot represent. It must NOT be written (that replaces the engineer's diagram with a comment)
            // and it must NOT be dropped: the member stays in `pushed`, so the removal pass above leaves it be.
            // This is what makes a POU that merely CONTAINS a CFC member editable at all — before it, the guard
            // refused the entire push, so such a POU could not be touched even to edit its own root body.
            if (Materializer.IsGraphicalBodyMarker(body)) body = null;

            xml = present.Contains(child.Name)
                ? PouSplice.SetChildText(xml, name, child.Name, decl, body)
                : PouSplice.AddChild(xml, name, child.Name, MemberOf(child.Kind), decl, body);

            if (child.Kind != ItemKind.Kinds.Property) continue;
            // null code REMOVES the accessor — that is how a push drops a getter, and why the reader keeps an
            // absent accessor (null) distinct from a present-but-bodiless one ("").
            xml = PouSplice.SetAccessor(xml, name, child.Name, true, child.Getter?.Implementation, child.Getter?.Declaration);
            xml = PouSplice.SetAccessor(xml, name, child.Name, false, child.Setter?.Implementation, child.Setter?.Declaration);
        }

        xml = PouSplice.SetDeclaration(xml, name, split.PouDeclaration);
        return PouSplice.SetBody(xml, name, split.PouImplementation);
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
