using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Library;
using Volt.Engine.Format.Body;
using Volt.Engine.Item;

namespace Volt.Engine.Format.St;

/// <summary>Assembles a <see cref="ItemContent"/> into canonical workspace Structured Text — the inverse of
/// <see cref="StReader"/>, and the SOLE owner of that format — the two sit in this folder together for
/// exactly that reason.</summary>
public static class StWriter
{
    public static string Write(ItemContent item)
    {
        var shape = ItemKind.ShapeOf(item.Kind);
        // THE OBJECT'S PROPERTIES (openspec bridge-one-to-one §1.2): directly under its IMPLEMENTATION line where it has
        // one, else closing its declaration — a DUT's, a GVL's, an interface's.
        var props = PropertyLines.Write(item.Properties);
        // EVERY TEXT VERBATIM (openspec bridge-one-to-one §1.1 "every character", `trailing-newline-cache`): both vendors
        // keep a declaration's and a body's trailing newlines across a reload, so the file spells them — the text, then
        // the layout's own separator, which is all the reader strips (`StReader.StripSeparator`). Every TrimEnd('\n') that
        // folded them is gone; `…END_VAR\n\n\n` and `…END_VAR` pulled identically, and a push wrote the vendor's away.
        if (!shape.Composite)
            return item.Declaration + "\n" + string.Concat(props.Select(l => l + "\n"));

        var sb = new StringBuilder();
        sb.Append(item.Declaration);

        // NOT trimmed: the reader already dropped the ONE blank line this join re-inserts, so a newline still
        // leading the body is the engineer's and has to survive the round trip.
        // The BOUNDARY LINE, always — see ImplementationMarker. An empty body gets it too: the line records where the
        // DECLARATION ends and what language the body is in, facts that do not depend on whether code follows it.
        // A body Volt does not show is its UNSUPPORTED line (IMPLEMENTATION CFC UNSUPPORTED, …) and nothing under it.
        var (boundary, impl) = ImplementationMarker.Split(item.Body ?? "");
        if (shape.Body) sb.Append('\n').Append(boundary);
        foreach (var line in props) sb.Append('\n').Append(line);
        if (impl.Length > 0)
            sb.Append('\n').Append(impl);

        // `Ordinal`, and it must stay Ordinal — this is a SORT, not a lookup.
        //
        // Every NAME LOOKUP in the engine uses `OrdinalIgnoreCase`, because IEC identifiers are
        // case-insensitive and two members cannot differ only by case. That makes the comparer here look
        // inconsistent, and it is not: a lookup has to find `Calculate` when asked for `calculate`, while a
        // sort only has to be the SAME sort on every pull. Ordinal is; and switching to OrdinalIgnoreCase
        // would move every mixed-case member of every POU in every existing workspace, producing a diff in
        // the engineer's repo that says nothing changed and means nothing changed.
        var children = item.Members
            .OrderBy(c => KindOrder(c.Kind), Comparer<int>.Default)
            .ThenBy(c => c.Name, StringComparer.Ordinal)
            .ToList();

        if (shape.MembersInside)
        {
            foreach (var c in children) { sb.Append('\n').Append('\n'); sb.Append(AssembleChild(c, shape)); }
            sb.Append('\n').Append('\n').Append(EndKeyword(item));
        }
        else
        {
            sb.Append('\n').Append('\n').Append(EndKeyword(item));
            foreach (var c in children) { sb.Append('\n').Append('\n'); sb.Append(AssembleChild(c, shape)); }
        }

        sb.Append('\n');
        return sb.ToString();
    }

    // No silent fallback — an invented `END_<KIND>` would write syntactically wrong ST into the user's repo.
    // The kind comes from the IDE's tree, and a kind with no END line (`method`/`property`/`action` handed up as
    // an item) fails loud here, exactly like the sibling ItemKind.ExtFor. A PULL-side refusal: the item is listed
    // `unreadable`, coded UNSUPPORTED (a kind with no mapping).
    //
    // A POU's END line MIRRORS ITS OWN HEADER (openspec `push-without-header-check` 5.Q.3): `X.pou` is one kind whatever
    // its text says, so there is no kind to spell the line from, and the owner keeps the line — it is the boundary
    // between the POU and its members. `PROGRAM` closes with `END_PROGRAM`, `FUNCTION_BLOCK` with `END_FUNCTION_BLOCK`,
    // `FUNCTION` with `END_FUNCTION`, read by `StReader.PouHeaderKeyword` in the reader's own view; the reader accepts
    // any of the three as the boundary, so the line decides nothing on the way back in.
    private static string EndKeyword(ItemContent item) => item.Kind switch
    {
        ItemKind.Kinds.Pou => "END_" + (StReader.PouHeaderKeyword(item.Declaration) ?? throw NoHeader(null)),
        ItemKind.Kinds.Interface => "END_INTERFACE",
        _ => throw new BridgeException(BridgeErrorCodes.Unsupported, $"No END keyword for kind '{item.Kind}'"),
    };

    /// <summary>A POU whose declaration opens with none of PROGRAM / FUNCTION_BLOCK / FUNCTION — an empty or prose text,
    /// a NAMESPACE, INTERFACE text in a POU object — has no END line its text can mirror, and Volt invents none (openspec
    /// <c>bridge-one-to-one</c> finding 8, task 3.5). It closed with the one documented fallback, <c>END_FUNCTION_BLOCK</c>
    /// (design 5.Qa, F1), a line the IDE does not hold; 16,990 of 16,990 corpus POUs open with one of the three, so the
    /// refusal meets only a text mid-edit in the IDE, which pulls again once it declares itself. A PULL refusal: the
    /// item is listed unreadable, by name (<paramref name="name"/>, null where the writer has none).</summary>
    public static BridgeException NoHeader(string? name) =>
        new(BridgeErrorCodes.Unsupported,
            $"{(name is null ? "this POU" : $"'{name}'")}: its declaration opens with no PROGRAM / FUNCTION_BLOCK / FUNCTION, " +
            "so its file has no END line to mirror and Volt invents none — it is not pulled until its text declares what " +
            "it is in the IDE.");

    private static int KindOrder(string kind) => kind switch
    {
        ItemKind.Kinds.Method or ItemKind.Kinds.InterfaceMethod => 0,
        ItemKind.Kinds.Action => 1,
        ItemKind.Kinds.Property or ItemKind.Kinds.InterfaceProperty => 2,
        _ => 3,
    };

    /// <summary>A member block. Whether it carries the boundary line is its kind's row (<see cref="ItemKind.ShapeOf"/>):
    /// a method's and an action's <c>Body</c>, a property's accessors <c>WithBodies</c> — and none at all inside an owner
    /// whose members sit in its block (<c>MembersInside</c>, an interface), whose members are signatures. That is the
    /// owner's row, the one the reader splits such a block by, so an ACTION inside an interface (0 in the six corpora) is
    /// written as the reader reads it: unmarked.</summary>
    private static string AssembleChild(Member child, KindShape owner)
    {
        if (child.Kind is ItemKind.Kinds.Property or ItemKind.Kinds.InterfaceProperty)
            return AssembleProperty(child, owner);
        var decl = child.Declaration;   // verbatim: the boundary line (or the END line) is its separator
        // The boundary line first, then the property lines (`%CLASS`, `%FOLDER`, the rest: PropertyLines), then the code —
        // an UNSUPPORTED line is that boundary too, so a hidden member's lines follow it; above it, they would be
        // DECLARATION text and the folder lost. A member with no boundary (an interface's) closes its declaration with them.
        var (boundary, code) = ImplementationMarker.Split(child.Body ?? "");
        var impl = Prepend(PropertyLines.Write(child.Properties, child.Folder), code);
        var end = child.Kind switch
        {
            // An interface's members are the same ST constructs as a POU's; only the WIRE kind differs.
            ItemKind.Kinds.Method or ItemKind.Kinds.InterfaceMethod => "END_METHOD",
            ItemKind.Kinds.Action => "END_ACTION",
            _ => throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"No END keyword for POU child kind '{child.Kind}'"),
        };
        if (owner.MembersInside || !ItemKind.ShapeOf(child.Kind).Body)
            return impl.Length == 0 ? $"{decl}\n{end}" : $"{decl}\n{impl}\n{end}";
        return impl.Length == 0 ? $"{decl}\n{boundary}\n{end}" : $"{decl}\n{boundary}\n{impl}\n{end}";
    }

    private static string AssembleProperty(Member child, KindShape owner)
    {
        // An INTERFACE property's accessors are signatures — no body, so no boundary to mark.
        var marked = !owner.MembersInside && ItemKind.ShapeOf(child.Kind).Accessors == AccessorShape.WithBodies;
        var parts = new List<string> { child.Declaration };   // verbatim, joined to what follows by one newline
        parts.AddRange(PropertyLines.Write(child.Properties, child.Folder));   // closing its declaration: it has no boundary
        // Presence is the object (ItemContent's Accessor): a null accessor is none.
        if (child.Getter is { } get) parts.Add(AssembleAccessor("GET", get.Declaration, get.Body, marked));
        if (child.Setter is { } set) parts.Add(AssembleAccessor("SET", set.Declaration, set.Body, marked));
        parts.Add("END_PROPERTY");
        return string.Join("\n", parts);
    }

    private static string AssembleAccessor(string keyword, string? decl, string? impl, bool marked)
    {
        // NOT trimmed: the declaration travels verbatim, and a LEADING newline is the engineer's blank line (six
        // accessors in pro2193 hold one).
        var d = decl ?? "";
        var (boundary, i) = ImplementationMarker.Split(impl ?? "");
        var lines = new List<string> { keyword };
        if (d.Length > 0) lines.Add(d);
        if (marked) lines.Add(boundary);   // an accessor splits the same way, so it is marked the same way
        if (i.Length > 0) lines.Add(i);
        lines.Add($"END_{keyword}");
        return string.Join("\n", lines);
    }

    /// <summary>Prepend a member's property lines (<c>%CLASS</c>, its <c>%FOLDER</c> — the member's sub-folder within the
    /// POU — and the rest) to its body. The signature line stays a clean identifier; the lines sit at the top of the
    /// body, ahead of its graphical content (the `NETWORK` marker for editable FBD/LD).</summary>
    private static string Prepend(IReadOnlyList<string> lines, string impl)
    {
        if (lines.Count == 0) return impl;
        var head = string.Join("\n", lines);
        return impl.Length == 0 ? head : $"{head}\n{impl}";
    }
}
