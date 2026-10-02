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
/// exactly that reason.
/// <para>The dict-based <c>StAssembler</c> that used to share this format is DELETED, retiring its
/// `ponytail:` note (which prescribed exactly this once the two round-trip tests stopped driving it): it had no
/// production call site, and it had already diverged here — it invented `END_&lt;KIND&gt;` where this throws
/// a coded refusal. ChildDirectiveTests and InterfaceRoundTripTests now certify THIS emitter, against
/// a golden of the whole emitted text.</para></summary>
public static class StWriter
{
    public static string Write(ItemContent item)
    {
        if (!HasBody(item.Kind))
            return item.Declaration.TrimEnd('\n') + "\n";

        var sb = new StringBuilder();
        sb.Append(item.Declaration.TrimEnd('\n'));

        // NOT trimmed: the reader already dropped the ONE blank line this join re-inserts, so a newline still
        // leading the body is the engineer's and has to survive the round trip.
        // The BOUNDARY LINE, always — see ImplementationMarker. An empty body gets it too: the line records where the
        // DECLARATION ends and what language the body is in, facts that do not depend on whether code follows it.
        // A body Volt does not show is its UNSUPPORTED line (IMPLEMENTATION CFC UNSUPPORTED, …) and nothing under it.
        var (boundary, impl) = ImplementationMarker.Split(item.Body ?? "");
        if (ImplementationMarker.AppliesTo(item.Kind)) sb.Append('\n').Append(boundary);
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
            .OrderBy(c => KindOrder(c.Kind))
            .ThenBy(c => c.Name, StringComparer.Ordinal)
            .ToList();

        if (item.Kind == ItemKind.Kinds.Interface)
        {
            foreach (var c in children) { sb.Append('\n').Append('\n'); sb.Append(AssembleChild(c, item.Kind)); }
            sb.Append('\n').Append('\n').Append(EndKeyword(item));
        }
        else
        {
            sb.Append('\n').Append('\n').Append(EndKeyword(item));
            foreach (var c in children) { sb.Append('\n').Append('\n'); sb.Append(AssembleChild(c, item.Kind)); }
        }

        sb.Append('\n');
        return sb.ToString();
    }

    private static bool HasBody(string kind) =>
        kind is not (ItemKind.Kinds.Gvl or ItemKind.Kinds.Dut);

    // No silent fallback — an invented `END_<KIND>` would write syntactically wrong ST into the user's repo.
    // The kind comes from the IDE's tree, and a kind with no END line (`method`/`property`/`action` handed up as
    // an item) fails loud here, exactly like the sibling ItemKind.ExtFor (which throws on the same kind a few lines
    // later in Materializer — so this fallback was masked, not unreachable). A PULL-side refusal: the item is listed
    // `unreadable`, coded UNSUPPORTED (a kind with no mapping). It was INVALID_CODE_HEADER, which no longer exists: a push
    // reads no top-level header, and a pull refusal is never observable as a code.
    //
    // A POU's END line MIRRORS ITS OWN HEADER (openspec `push-without-header-check` 5.Q.3): `X.pou` is one kind whatever
    // its text says, so there is no kind to spell the line from, and the owner keeps the line — it is the boundary
    // between the POU and its members. `PROGRAM` closes with `END_PROGRAM`, `FUNCTION_BLOCK` with `END_FUNCTION_BLOCK`,
    // `FUNCTION` with `END_FUNCTION`, read by `StReader.PouHeaderKeyword` in the reader's own view; the reader accepts
    // any of the three as the boundary, so the line decides nothing on the way back in.
    private static string EndKeyword(ItemContent item) => item.Kind switch
    {
        ItemKind.Kinds.Pou => "END_" + (StReader.PouHeaderKeyword(item.Declaration) ?? FallbackPouHeader),
        ItemKind.Kinds.Interface => "END_INTERFACE",
        _ => throw new BridgeException(BridgeErrorCodes.Unsupported, $"No END keyword for kind '{item.Kind}'"),
    };

    /// <summary>THE ONE END-LINE FALLBACK (design 5.Qa, F1): a POU whose declaration opens with none of PROGRAM /
    /// FUNCTION_BLOCK / FUNCTION — an empty or prose text, a NAMESPACE, INTERFACE text in a POU object — closes with
    /// <c>END_FUNCTION_BLOCK</c>: the push's create seed's own END line (every POU is created as a function block) and
    /// the shape that accepts every member kind. Intentional, tested and COUNTED: the pull logs every item it fires for
    /// (<c>Materializer</c>), and it fires for no POU a vendor compiles (16,990 / 16,990 corpus POUs open with one of
    /// the three). Omitting the line would leave a file with members unsplittable; refusing the pull would make a
    /// broken text that the push lets through unpullable.</summary>
    public const string FallbackPouHeader = "FUNCTION_BLOCK";

    private static int KindOrder(string kind) => kind switch
    {
        ItemKind.Kinds.Method or ItemKind.Kinds.InterfaceMethod => 0,
        ItemKind.Kinds.Action => 1,
        ItemKind.Kinds.Property or ItemKind.Kinds.InterfaceProperty => 2,
        _ => 3,
    };

    private static string AssembleChild(Member child, string ownerKind)
    {
        if (child.Kind is ItemKind.Kinds.Property or ItemKind.Kinds.InterfaceProperty)
            return AssembleProperty(child, ownerKind);
        var decl = child.Declaration.TrimEnd('\n');
        // The boundary line first, then `%FOLDER`, then the code — an UNSUPPORTED line is that boundary too, so a hidden
        // member's `%FOLDER` follows it; above it, the directive would be DECLARATION text and the folder lost.
        var (boundary, code) = ImplementationMarker.Split(child.Body ?? "");
        var impl = PrependFolder(child.Folder, code);
        var end = child.Kind switch
        {
            // An interface's members are the same ST constructs as a POU's; only the WIRE kind differs.
            ItemKind.Kinds.Method or ItemKind.Kinds.InterfaceMethod => "END_METHOD",
            ItemKind.Kinds.Action => "END_ACTION",
            _ => throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"No END keyword for POU child kind '{child.Kind}'"),
        };
        if (!ImplementationMarker.AppliesTo(child.Kind) || !ImplementationMarker.AppliesTo(ownerKind))
            return impl.Length == 0 ? $"{decl}\n{end}" : $"{decl}\n{impl}\n{end}";
        return impl.Length == 0 ? $"{decl}\n{boundary}\n{end}" : $"{decl}\n{boundary}\n{impl}\n{end}";
    }

    private static string AssembleProperty(Member child, string ownerKind)
    {
        // An INTERFACE property's accessors are signatures — no body, so no boundary to mark.
        var marked = ImplementationMarker.AppliesTo(child.Kind) && ImplementationMarker.AppliesTo(ownerKind);
        var parts = new List<string> { child.Declaration.TrimEnd('\n') };
        if (!string.IsNullOrEmpty(child.Folder)) parts.Add($"%FOLDER {child.Folder}");
        // Presence is the object. This used to re-derive it from two nullable fields — the same rule the reader
        // applied, spelled a second time, which is exactly the kind of duplication ItemContent exists to remove.
        if (child.Getter is { } get) parts.Add(AssembleAccessor("GET", get.Declaration, get.Body, marked));
        if (child.Setter is { } set) parts.Add(AssembleAccessor("SET", set.Declaration, set.Body, marked));
        parts.Add("END_PROPERTY");
        return string.Join("\n", parts);
    }

    private static string AssembleAccessor(string keyword, string? decl, string? impl, bool marked)
    {
        // NOT trimmed. `AccessorDeclaration.Keep` already dropped the trailing newlines this join would
        // double, and a LEADING newline is the engineer's blank line - six accessors in pro2193 hold one.
        // Trimming here took back exactly what the read had just been fixed to preserve.
        var d = decl ?? "";
        var (boundary, i) = ImplementationMarker.Split(impl ?? "");
        var lines = new List<string> { keyword };
        if (d.Length > 0) lines.Add(d);
        if (marked) lines.Add(boundary);   // an accessor splits the same way, so it is marked the same way
        if (i.Length > 0) lines.Add(i);
        lines.Add($"END_{keyword}");
        return string.Join("\n", lines);
    }

    /// <summary>Prepend a `%FOLDER &lt;path&gt;` directive to a child body — the child's sub-folder
    /// within the POU. The signature line stays a clean identifier; this `%FOLDER` line sits at the top
    /// of the body, ahead of its graphical content (the `NETWORK` marker for editable FBD/LD).</summary>
    private static string PrependFolder(string? folder, string impl)
    {
        if (string.IsNullOrEmpty(folder)) return impl;
        return impl.Length == 0 ? $"%FOLDER {folder}" : $"%FOLDER {folder}\n{impl}";
    }
}
