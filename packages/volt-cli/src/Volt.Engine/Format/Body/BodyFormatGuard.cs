using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Format.Network;
using Volt.Engine.Format.St;
using Volt.Engine.Item;

namespace Volt.Engine.Format.Body;

/// <summary>
/// A push must not overwrite a body it cannot author. The rule, unchanged since it was first written:
/// <b>decide from the IDE's LIVE body, never from the incoming text.</b>
///
/// <para>An earlier version tried to decide from content — <c>NetworkText.Is(impl) &amp;&amp; !IsEditable(…)</c> —
/// which could never work, because an unsupported body has no text form and materialized as a marker comment, which
/// <c>NetworkText.Is</c> (a <c>NETWORK n LANG</c> matcher) REJECTED. The marker fell through to the textual path and
/// the write replaced an engineer's diagram with a comment. A hidden body is its UNSUPPORTED
/// <c>IMPLEMENTATION</c> line now (<see cref="ImplementationMarker.IsUnsupportedBody"/>); the rule is unchanged.</para>
///
/// <para><b>This is back in the engine, and it belongs here.</b> It briefly moved to the drivers with the rest
/// of the transport, on the reasoning that only a driver can ask the IDE what a body currently IS. That was
/// true of the old contract and is not true of this one: <c>ReadContent</c> returns the live body, and a body's
/// KIND is readable from the text itself — a UNSUPPORTED line, network text, or neither. The policy is vendor-neutral,
/// the tests for it are offline, and moving it out took five of them with it.</para>
/// </summary>
public static class BodyFormatGuard
{
    /// <summary>What a body IS, as the workspace spells it.</summary>
    private enum Shape { Textual, Network, Unsupported }

    private static Shape ShapeOf(string? body) =>
        ImplementationMarker.IsUnsupportedBody(body) ? Shape.Unsupported
        : NetworkText.Is(body) ? Shape.Network
        : Shape.Textual;

    /// <summary>Refuse a CREATE whose source carries a hidden body. The rule above — decide from the IDE's LIVE
    /// body — has nothing to read on a create, but the verdict does not need one: a UNSUPPORTED line means "there is no
    /// text form for this body", so Volt cannot author the item under any live state.
    ///
    /// <para>Without this the create path wrote the marker (then a comment) as if it were source, and the item landed with an
    /// EMPTY body while the push reported success. Measured by the corpus-migration gate: pushing a real project
    /// into a blank one silently dropped every CFC/SFC POU. The update path had been guarded since the first
    /// data-loss bug; the create path was never covered, and the comment beside it in <c>PushService</c> asserted
    /// the opposite ("root CFC/SFC are unsupported and never reach push").</para></summary>
    public static void RequireAuthorable(ItemContent pushed)
    {
        Authorable("the item", pushed.Body);
        foreach (var member in pushed.Members) AuthorableMember(member);
    }

    /// <summary>The create rule for ONE member: every body it carries must be one Volt can author.</summary>
    private static void AuthorableMember(Member member)
    {
        // Same split as below: a property node's code lives in its accessors, not in a body of its own.
        if (member.Kind == ItemKind.Kinds.Property || member.Kind == ItemKind.Kinds.InterfaceProperty
            || member.Kind == ItemKind.Kinds.InterfaceMethod)
        {
            Authorable($"'{member.Name}' GET", member.Getter?.Body);
            Authorable($"'{member.Name}' SET", member.Setter?.Body);
            return;
        }
        Authorable($"'{member.Name}'", member.Body);
    }

    private static void Authorable(string what, string? body)
    {
        if (!ImplementationMarker.IsUnsupportedBody(body)) return;
        throw new BridgeException(BridgeErrorCodes.Unsupported,
            $"{what} is '{body!.Trim()}', a body Volt cannot author — there is no text form for it, so it can only " +
            "be created in the IDE. Remove it from this push.");
    }

    /// <summary>Refuse a push that would overwrite a body Volt cannot author, or that carries a UNSUPPORTED line over
    /// one it can. <paramref name="live"/> is the item as the IDE holds it now; <paramref name="pushed"/> is the
    /// source being written. Throws <see cref="BridgeException"/>; returns quietly when the write is allowed.</summary>
    public static void RequireWritable(ItemContent live, ItemContent pushed)
    {
        Check("the item", live.Body, pushed.Body);

        var byName = live.Members.ToDictionary(m => m.Name, StringComparer.OrdinalIgnoreCase);
        foreach (var member in pushed.Members)
        {
            // NOT IN THE IDE UNDER THIS NAME AND KIND — a member added, renamed, or retyped (the reconciler deletes a
            // retyped member and creates it again) — is a CREATE of that member, and a create is held to the create
            // rule. Skipping it as "nothing to overwrite" was wrong twice over: a UNSUPPORTED line has no text form, so
            // the member was created as an EMPTY ST body (both drivers skip writing a hidden body), and for a
            // rename or a retype the reconciler had already deleted the diagram the line stood for. The push
            // reported success over a lost CFC chart or ladder.
            if (!byName.TryGetValue(member.Name, out var current) || current.Kind != member.Kind)
            {
                AuthorableMember(member);
                continue;
            }

            // An interface member and a PROPERTY node carry no body of their own: a property's code lives in its
            // GET/SET accessors, which arrive as `Getter`/`Setter`. Asking about `Body` for one would be asking
            // the wrong question. (The accessors are guarded on their own terms below.)
            if (member.Kind == ItemKind.Kinds.Property || member.Kind == ItemKind.Kinds.InterfaceProperty
                || member.Kind == ItemKind.Kinds.InterfaceMethod)
            {
                Check($"'{member.Name}' GET", current.Getter?.Body, member.Getter?.Body);
                Check($"'{member.Name}' SET", current.Setter?.Body, member.Setter?.Body);
                continue;
            }

            Check($"'{member.Name}'", current.Body, member.Body);
        }
    }

    private static void Check(string what, string? liveBody, string? pushedBody)
    {
        if (pushedBody is null) return;                      // nothing offered for this slot

        var live = ShapeOf(liveBody);
        var pushed = ShapeOf(pushedBody);

        // Two hidden bodies share a SHAPE but not a language, and the stated language is the one signal for what a
        // body is. Passing on shape alone accepted `IMPLEMENTATION SFC UNSUPPORTED` over a CFC chart as a no-op: the drivers write
        // nothing for a hidden body, so the IDE kept its chart while the file and the pushed baseline named another.
        if (live == Shape.Unsupported && pushed == Shape.Unsupported)
        {
            var held = ImplementationMarker.Canonical(liveBody!.Trim());
            var stated = ImplementationMarker.Canonical(pushedBody.Trim());
            if (held == stated) return;                      // the pulled line pushed back: the ordinary no-op
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"{what} is stated '{stated}' but its body in the IDE is '{held}' — a hidden body cannot change " +
                "language by push. Pull first, or change it in the IDE.");
        }

        // An LD/FBD body the IDE holds as network text, pushed as its UNSUPPORTED line, is the SAME body hidden: a
        // workspace pulled while network text was off (a production bridge, `NetworkTextSwitch`) pushed at a bridge that
        // has it on. Nothing is written for it (`ImplementationMarker.Written`), so accepting it overwrites nothing —
        // and refusing it blocked the whole item, the ST and declaration edits beside it included, until a re-pull. The
        // language must still be the one the IDE holds, as between two hidden bodies above.
        if (live == Shape.Network && pushed == Shape.Unsupported)
        {
            var language = NetworkText.LanguageOf(liveBody)!;
            if (ImplementationMarker.UnsupportedLanguageOf(pushedBody) == language) return;
            var held = ImplementationMarker.For(language);
            var stated = ImplementationMarker.Canonical(pushedBody.Trim());
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"{what} is stated '{stated}' but its body in the IDE is '{held}' — a hidden body cannot change " +
                "language by push. Pull first, or change it in the IDE.");
        }

        if (live == pushed) return;                          // same kind of body: the ordinary write

        // Pushing the UNSUPPORTED line back is the ordinary NO-OP for a body Volt cannot write, and it is the only way
        // a POU that merely CONTAINS one stays editable at all. It is a refusal only when it does NOT match: a stale
        // or hand-written UNSUPPORTED line over an ST body (the only live shape left here) would otherwise silently
        // do nothing.
        if (pushed == Shape.Unsupported)
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"{what} is stated '{pushedBody.Trim()}' — hidden, read-only here and never written — but its body in " +
                "the IDE is ST — state its language and push real source, or pull first.");

        if (live == Shape.Unsupported)
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"{what} is '{liveBody!.Trim()}' in the IDE, a body Volt does not " +
                "support — edit it in the IDE, not via push.");

        if (live == Shape.Network)
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"{what} is a graphical body in the IDE — a textual push would overwrite it. " +
                "Edit it in the IDE, or delete it first to replace it. " + Saw(liveBody, pushedBody));

        throw new BridgeException(BridgeErrorCodes.Unsupported,
            $"{what} is a textual body — graphical bodies are authored in the IDE, not created by push.");
    }

    /// <summary>The two LANGUAGES the guard compared. A refusal that names only its verdict cannot be
    /// diagnosed from the other side of a pipe - which cost a debugging round the first time this fired
    /// wrongly - but echoing the first line of each body named only one of them: a graphical body's marker says
    /// "FBD" while a line of ST just says `x := TRUE;`, which is the value, not the language.</summary>
    private static string Saw(string? live, string? pushed) =>
        $"(IDE: {LanguageOf(live)} | pushed: {LanguageOf(pushed)})";

    /// <summary>What language a body is written in, as the workspace spells it: a graphical body's IMPLEMENTATION
    /// line carries it (<c>IMPLEMENTATION FBD</c>), a hidden body is its line, and anything else is ST.</summary>
    private static string LanguageOf(string? body)
    {
        if (body is null) return "<none>";
        if (ImplementationMarker.IsUnsupportedBody(body)) return body.Trim();
        if (NetworkText.Is(body)) return NetworkText.LanguageOf(body) ?? "FBD/LD";
        return body.Trim().Length == 0 ? "<empty>" : "ST";
    }
}
