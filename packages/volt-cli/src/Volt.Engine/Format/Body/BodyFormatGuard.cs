using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
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
/// the write replaced an engineer's diagram with a comment.</para>
///
/// <para><b>It compares FACTS, and reads no text</b> (openspec <c>bridge-refusal-review</c> D6). Each body arrives with
/// the language its line states (<see cref="StatedLanguage"/>): the live one from the driver, which knows it from the
/// vendor's aspect or archive, the pushed one from the ST reader, which parsed the line. The guard used to decode the
/// language back out of the text (<c>ShapeOf</c>: an UNSUPPORTED line, network text, or neither) — which held only while
/// every reader kept that encoding lossless, in three places, and misjudged silently where one did not.</para>
///
/// <para><b>One language-change comparison</b> (D7): a body that changes between ST and LD/FBD is a change the VENDOR
/// answers (<c>ICodeStore.RefusedLanguageChange</c>, DIALECT N24) — CODESYS writes it in place, TwinCAT has no route —
/// and nothing else here refuses one. The policy is vendor-neutral and its tests are offline.</para>
/// </summary>
public static class BodyFormatGuard
{
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
        Authorable("the item", pushed.Body, pushed.Stated);
        foreach (var member in pushed.Members) AuthorableMember(member);
    }

    /// <summary>The create rule for ONE member: every body it carries must be one Volt can author.</summary>
    private static void AuthorableMember(Member member)
    {
        // Same split as below: a property node's code lives in its accessors, not in a body of its own.
        if (CarriesAccessors(member))
        {
            Authorable($"'{member.Name}' GET", member.Getter?.Body, member.Getter?.Stated);
            Authorable($"'{member.Name}' SET", member.Setter?.Body, member.Setter?.Stated);
            return;
        }
        Authorable($"'{member.Name}'", member.Body, member.Stated);
    }

    private static void Authorable(string what, string? body, StatedLanguage? stated)
    {
        if (StatedOf(what, "pushed", body, stated) is not { Hidden: true } hidden) return;
        throw new BridgeException(BridgeErrorCodes.Unsupported,
            $"{what} is '{hidden}', a body Volt cannot author — there is no text form for it, so it can only " +
            "be created in the IDE. Remove it from this push.");
    }

    /// <summary>Refuse a push that would overwrite a body Volt cannot author, carries a UNSUPPORTED line over one it
    /// can, or changes a body's language where the vendor cannot (<paramref name="refusedLanguageChange"/>,
    /// <c>ICodeStore.RefusedLanguageChange</c>). <paramref name="live"/> is the item as the IDE holds it now;
    /// <paramref name="pushed"/> is the source being written. Throws <see cref="BridgeException"/>; returns quietly
    /// when the write is allowed.</summary>
    public static void RequireWritable(ItemContent live, ItemContent pushed,
                                       Func<string, string, string, string?> refusedLanguageChange)
    {
        if (refusedLanguageChange is null) throw new ArgumentNullException(nameof(refusedLanguageChange));
        Check("the item", pushed.Kind, live.Body, live.Stated, pushed.Body, pushed.Stated, refusedLanguageChange);

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
            if (CarriesAccessors(member))
            {
                Check($"'{member.Name}' GET", ItemKind.Kinds.PropertyGet, current.Getter?.Body, current.Getter?.Stated,
                      member.Getter?.Body, member.Getter?.Stated, refusedLanguageChange);
                Check($"'{member.Name}' SET", ItemKind.Kinds.PropertySet, current.Setter?.Body, current.Setter?.Stated,
                      member.Setter?.Body, member.Setter?.Stated, refusedLanguageChange);
                continue;
            }

            Check($"'{member.Name}'", member.Kind, current.Body, current.Stated, member.Body, member.Stated,
                  refusedLanguageChange);
        }
    }

    private static bool CarriesAccessors(Member member) =>
        member.Kind is ItemKind.Kinds.Property or ItemKind.Kinds.InterfaceProperty or ItemKind.Kinds.InterfaceMethod;

    /// <param name="site">Which body this is, for the vendor's language-change answer: the item's kind, a member's kind,
    /// or <c>property_get</c> / <c>property_set</c>.</param>
    private static void Check(string what, string site, string? liveBody, StatedLanguage? liveStated, string? pushedBody,
                              StatedLanguage? pushedStated, Func<string, string, string, string?> refusedLanguageChange)
    {
        if (pushedBody is null) return;                      // nothing offered for this slot

        // No live body text is an empty ST body (or a slot with none, which D26 refuses on its own) — what an ST push
        // writes into, as it always was. The pushed body has text here, so it states a language.
        var live = StatedOf(what, "the IDE's", liveBody, liveStated) ?? StatedLanguage.St;
        var pushed = StatedOf(what, "pushed", pushedBody, pushedStated)!;

        // Two hidden bodies share hiding but not a language, and the stated language is the one signal for what a
        // body is. Passing on hiding alone accepted `IMPLEMENTATION SFC UNSUPPORTED` over a CFC chart as a no-op: the
        // drivers write nothing for a hidden body, so the IDE kept its chart while the file and the pushed baseline
        // named another.
        //
        // An LD/FBD body the IDE holds as network text, pushed as its UNSUPPORTED line, is the SAME body hidden: a
        // workspace pulled while network text was off (a production bridge, `NetworkTextSwitch`) pushed at a bridge that
        // has it on. Nothing is written for it (`ImplementationMarker.Written`), so accepting it overwrites nothing —
        // and refusing it blocked the whole item, the ST and declaration edits beside it included, until a re-pull. The
        // language must still be the one the IDE holds.
        if (pushed.Hidden && (live.Hidden || live.IsNetwork))
        {
            if (string.Equals(live.Language, pushed.Language, StringComparison.Ordinal)) return;   // the ordinary no-op
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"{what} is stated '{pushed}' but its body in the IDE is '{StatedLanguage.HiddenIn(live.Language)}' — a " +
                "hidden body cannot change language by push; change it in the IDE.");
        }

        // Pushing the UNSUPPORTED line back is the ordinary NO-OP for a body Volt cannot write, and it is the only way
        // a POU that merely CONTAINS one stays editable at all. It is a refusal only when it does NOT match: a stale
        // or hand-written UNSUPPORTED line over an ST body (the only live body left here) would otherwise silently
        // do nothing.
        if (pushed.Hidden)
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"{what} is stated '{pushed}' — hidden, read-only here and never written — but its body in " +
                "the IDE is ST — the text pushed is not that body's source.");

        if (live.Hidden)
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"{what} is '{live}' in the IDE, a body Volt does not support — edit it in the IDE, not via push.");

        // Both shown. The same language, or LD over FBD and back — a VIEW change, which both vendors write
        // (`DefaultViewMode`, DIALECT N23) — is the ordinary write.
        if (live.Language == pushed.Language || (live.IsNetwork && pushed.IsNetwork)) return;

        // THE ONE LANGUAGE-CHANGE COMPARISON (D7): ST over LD/FBD, or LD/FBD over ST. Whether it can be written is the
        // vendor's fact (DIALECT N24: CODESYS swaps the body's aspect in place; TwinCAT has no in-place route), asked of
        // the driver — whose own write asks the same predicate.
        if (refusedLanguageChange(site, live.Language, pushed.Language) is not { } why) return;
        throw new BridgeException(BridgeErrorCodes.Unsupported,
            $"{what} is {Name(live, liveBody)} in the IDE and pushed as {Name(pushed, pushedBody)}: {why} The route that " +
            "exists: delete it and push it again, which creates the body in the new language.");
    }

    /// <summary>The body's stated language, as its reader handed it up. Null is the reader's word for "no body text":
    /// an empty ST body (TwinCAT stores an empty ST body as no text at all) or a slot with none — never a graphical or
    /// hidden body, which always has text (its keyword line). A body WITH text and no stated language is a reader that
    /// forgot the fact, and is refused loud rather than guessed at.</summary>
    private static StatedLanguage? StatedOf(string what, string whose, string? body, StatedLanguage? stated)
    {
        if (stated is not null) return stated;
        if (string.IsNullOrWhiteSpace(body)) return body is null ? null : StatedLanguage.St;
        throw new InvalidOperationException(
            $"{what}: {whose} body has text but no stated language — the reader that produced it must state one " +
            "(openspec bridge-refusal-review D6).");
    }

    /// <summary>The language a pushed body is WRITTEN in, read by the one rule this guard reads it by — so a driver's
    /// own write (CODESYS's aspect swap) and the guard cannot disagree (review of step 4a: an empty accessor body that
    /// states nothing was ST to the guard and "no language" to the write, which then set "" on a network aspect).
    /// Null for no body.</summary>
    public static StatedLanguage? PushedLanguage(string what, string? body, StatedLanguage? stated) =>
        StatedOf(what, "pushed", body, stated);

    /// <summary>How a refusal names a body's language: the language, or that the body is empty — a refusal that names
    /// only its verdict cannot be diagnosed from the other side of a pipe.</summary>
    private static string Name(StatedLanguage stated, string? body) =>
        string.IsNullOrWhiteSpace(body) ? $"{stated.Language} (empty)" : stated.Language;
}
