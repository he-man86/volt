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
        if (ItemKind.ShapeOf(pushed.Kind).Body) Authorable("the item", pushed.Body, pushed.Stated);
        foreach (var member in pushed.Members) AuthorableMember(member);
    }

    /// <summary>The create rule for ONE member: every body it carries must be one Volt can author.</summary>
    private static void AuthorableMember(Member member)
    {
        // Same split as below, by the kind's row (ItemKind.ShapeOf): a property node's code lives in its accessors, not
        // in a body of its own, and an interface method has neither.
        var shape = ItemKind.ShapeOf(member.Kind);
        if (shape.Accessors != AccessorShape.None)
        {
            Authorable($"'{member.Name}' GET", member.Getter?.Body, member.Getter?.Stated);
            Authorable($"'{member.Name}' SET", member.Setter?.Body, member.Setter?.Stated);
        }
        if (shape.Body) Authorable($"'{member.Name}'", member.Body, member.Stated);
    }

    private static void Authorable(string what, string? body, StatedLanguage? stated)
    {
        // `IMPLEMENTATION NONE` ON A CREATE (openspec abstract-member-push): the create makes a member WITH a slot
        // (CODESYS: a `POUMethodObject`, DIALECT C2n), so the next pull would contradict the file. A rename or a retype
        // of a pulled abstract member reaches here too — the reconciler turns it into delete + create.
        if (StatedOf(what, "pushed", body, stated) is { NoSlot: true })
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"{what} is stated '{ImplementationMarker.NoneLine}' on a member this push CREATES (added, renamed or " +
                $"retyped), and a created member has a body slot. Change its line to '{ImplementationMarker.For(Languages.St)}' " +
                "and push again.");
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
        if (ItemKind.ShapeOf(pushed.Kind).Body)
            Check("the item", pushed.Kind, live.Body, live.Stated, pushed.Body, pushed.Stated, refusedLanguageChange,
                  live.Declaration, pushed.Declaration);

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

            // WHAT THE KIND'S ROW SAYS EXISTS (ItemKind.ShapeOf, openspec bridge-refusal-review D11): a PROPERTY node
            // carries no body of its own — its code lives in its GET/SET accessors, which arrive as `Getter`/`Setter` —
            // and an INTERFACE METHOD carries neither a body nor accessors, so nothing of it is checked. It used to be
            // asked about accessors it does not have (`CarriesAccessors` meant "has no body").
            var shape = ItemKind.ShapeOf(member.Kind);
            if (shape.Accessors != AccessorShape.None)
            {
                // An accessor's slot follows its PROPERTY's ABSTRACT (the abstract `Busy`'s GET, C2n), so the property's
                // declarations are the ones the no-slot rule reads.
                Check($"'{member.Name}' GET", ItemKind.Kinds.PropertyGet, current.Getter?.Body, current.Getter?.Stated,
                      member.Getter?.Body, member.Getter?.Stated, refusedLanguageChange, current.Declaration,
                      member.Declaration);
                Check($"'{member.Name}' SET", ItemKind.Kinds.PropertySet, current.Setter?.Body, current.Setter?.Stated,
                      member.Setter?.Body, member.Setter?.Stated, refusedLanguageChange, current.Declaration,
                      member.Declaration);
            }

            if (shape.Body) Check($"'{member.Name}'", member.Kind, current.Body, current.Stated, member.Body, member.Stated,
                  refusedLanguageChange, current.Declaration, member.Declaration);
        }
    }

    /// <param name="site">Which body this is, for the vendor's language-change answer: the item's kind, a member's kind,
    /// or <c>property_get</c> / <c>property_set</c>.</param>
    /// <param name="liveDeclaration">The declaration that says whether the site is ABSTRACT, as the IDE holds it: the
    /// member's own, or its property's for an accessor. Read only for a member with no body slot.</param>
    /// <param name="pushedDeclaration">The same declaration as pushed.</param>
    private static void Check(string what, string site, string? liveBody, StatedLanguage? liveStated, string? pushedBody,
                              StatedLanguage? pushedStated, Func<string, string, string, string?> refusedLanguageChange,
                              string? liveDeclaration, string? pushedDeclaration)
    {
        if (pushedBody is null) return;                      // nothing offered for this slot

        // No live body text is an empty ST body (or a slot with none, which D26 refuses on its own) — what an ST push
        // writes into, as it always was. The pushed body has text here, so it states a language.
        var live = StatedOf(what, "the IDE's", liveBody, liveStated) ?? StatedLanguage.St;
        var pushed = StatedOf(what, "pushed", pushedBody, pushedStated)!;

        // A MEMBER WITH NO BODY SLOT (`IMPLEMENTATION NONE`, openspec abstract-member-push) — read before any language
        // rule, because NONE names no language. NONE over a live NONE is the ordinary no-op (nothing is written for it,
        // `ImplementationMarker.Written`; the declaration beside it lands). Anything else over a live NONE would send a
        // body at a slot the object does not have (D26's `RequireSlot` stays the driver's backstop). NONE over a member
        // that HAS a slot would silently do nothing — the silent no-op this guard exists to stop.
        //
        // NONE over NONE with ABSTRACT REMOVED from the declaration (gate 3 review) is a RE-TYPE, not a no-op: the IDE's
        // slotless object stays abstract whatever its text (DIALECT C2l), NONE writes no body, so the push would report
        // success while the file says "concrete" and the IDE keeps an abstract member with no slot. The reconciler does
        // not see it (same name, same kind), so it is refused here. Only a REMOVAL is refused: a declaration the IDE
        // already holds without ABSTRACT, pushed back unchanged, changes nothing.
        if (live.NoSlot && pushed.NoSlot)
        {
            if (IsAbstract(liveDeclaration) && !IsAbstract(pushedDeclaration))
                throw new BridgeException(BridgeErrorCodes.Unsupported,
                    $"{what}: its declaration drops ABSTRACT, but the IDE holds it as an abstract member with no body " +
                    $"slot ('{ImplementationMarker.NoneLine}'), and CODESYS keeps such a member abstract whatever its text — " +
                    "a re-type the push cannot make in place. Make the member concrete in the IDE and run `volt pull`, " +
                    "or delete it in one push and add it with 'IMPLEMENTATION ST' in the next.");
            return;
        }
        if (live.NoSlot)
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"{what} is stated '{pushed}', but the IDE holds it with no body slot (an abstract member: " +
                $"'{ImplementationMarker.NoneLine}'), so there is nothing to write that body into. Run `volt pull` to get " +
                $"its line; a body needs the member made concrete in the IDE.");
        if (pushed.NoSlot)
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"{what} is stated '{ImplementationMarker.NoneLine}', but the IDE holds a body slot there ('{live}'), so " +
                $"the line states a member the IDE does not have. If the member was made concrete in the IDE, run `volt " +
                $"pull`; if the line was edited by hand, state '{ImplementationMarker.For(Languages.St)}'.");

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

    private static bool IsAbstract(string? declaration) =>
        declaration is not null && StReader.MemberHeaderIsAbstract(declaration);

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
