using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Format.St;
using Volt.Engine.Item;
using Volt.Engine.Seam;

namespace Volt.Engine.Format.Body;

/// <summary>
/// A push must not overwrite a body it cannot author: <b>decide from the IDE's LIVE body, never from the incoming
/// text</b> — an unsupported body has no text form, so the incoming text cannot say what it would overwrite.
///
/// <para>An earlier version decided from content — <c>NetworkText.Is(impl) &amp;&amp; !IsEditable(…)</c> — and a
/// marker that matched neither fell through to the textual path, replacing an engineer's diagram with a comment.</para>
///
/// <para><b>It compares FACTS, and reads no text</b> (openspec <c>bridge-refusal-review</c> D6). Each body arrives with
/// the language its line states (<see cref="StatedLanguage"/>): the live one from the driver, which knows it from the
/// vendor's aspect or archive, the pushed one from the ST reader, which parsed the line. Decoding the language back
/// out of the text would hold only while every reader kept that encoding lossless.</para>
///
/// <para><b>One language-change comparison</b> (D7): a body that changes between ST and LD/FBD is a change the VENDOR
/// answers (<c>IVendorStore.RefusedLanguageChange</c>, DIALECT N24) — CODESYS writes it in place, TwinCAT has no route —
/// and nothing else here refuses one. The policy is vendor-neutral and its tests are offline.</para>
/// </summary>
public static class BodyFormatGuard
{
    /// <summary>Refuse a CREATE whose source carries a hidden body. The rule above — decide from the IDE's LIVE
    /// body — has nothing to read on a create, but the verdict does not need one: a UNSUPPORTED line means "there is no
    /// text form for this body", so Volt cannot author the item under any live state.
    ///
    /// <para>Without this a create writes the line as if it were source and the item lands with an EMPTY body while the
    /// push reports success — the corpus-migration gate measured it dropping every CFC/SFC POU of a real project.</para></summary>
    public static void RequireAuthorable(ItemContent pushed, Func<string, KindShape>? shapeOf = null)
    {
        shapeOf ??= ItemKind.ShapeOf;
        if (shapeOf(pushed.Kind).Body) Authorable("the item", pushed.Kind, pushed.Body, pushed.Stated, null);
        foreach (var member in pushed.Members) AuthorableMember(member, shapeOf);
    }

    /// <summary>The create rule for ONE member: every body it carries must be one Volt can author.</summary>
    private static void AuthorableMember(Member member, Func<string, KindShape> shapeOf)
    {
        // Same split as below, by the kind's row (ItemKind.ShapeOf): a property node's code lives in its accessors, not
        // in a body of its own, and an interface method has neither.
        var shape = shapeOf(member.Kind);
        if (shape.Accessors != AccessorShape.None)
        {
            Authorable($"'{member.Name}' GET", ItemKind.Kinds.PropertyGet, member.Getter?.Body, member.Getter?.Stated,
                       member.Declaration);
            Authorable($"'{member.Name}' SET", ItemKind.Kinds.PropertySet, member.Setter?.Body, member.Setter?.Stated,
                       member.Declaration);
        }
        if (shape.Body) Authorable($"'{member.Name}'", member.Kind, member.Body, member.Stated, member.Declaration);
    }

    /// <param name="declaration">The declaration that says whether <paramref name="site"/> is ABSTRACT: the member's
    /// own, its property's for an accessor; read only at a member site.</param>
    private static void Authorable(string what, string site, string? body, StatedLanguage? stated, string declaration)
    {
        // `IMPLEMENTATION NONE` ON A CREATE (openspec abstract-member-parity): accepted under an ABSTRACT member — the
        // create makes a member with a slot on both vendors, `""` is written there and the next pull reads NONE by the
        // fold — and refused anywhere else. A rename or a retype reaches here too (the reconciler's delete + create), so
        // migrating an abstract member into another project lands.
        var pushed = StatedOf(what, "pushed", body, stated);
        if (pushed is { IsNone: true })
        {
            if (!AbstractMemberFold.IsMemberSite(site)) throw NoneOffMemberSite(what);
            if (!StReader.MemberHeaderIsAbstract(declaration)) throw NoneWithoutAbstract(what);
            return;
        }
        if (AbstractMemberFold.IsMemberSite(site) && StReader.MemberHeaderIsAbstract(declaration) && HoldsStatements(pushed, body))
            throw StatementsUnderAbstract(what);
        if (pushed is not { Hidden: true } hidden) return;
        throw new BridgeException(BridgeErrorCodes.Unsupported,
            $"{what} is '{hidden}', a body Volt cannot author — there is no text form for it, so it can only " +
            "be created in the IDE. Remove it from this push.");
    }

    /// <summary>Refuse a push that would overwrite a body Volt cannot author, carries a UNSUPPORTED line over one it
    /// can, or changes a body's language where the vendor cannot (<paramref name="refusedLanguageChange"/>,
    /// <c>IVendorStore.RefusedLanguageChange</c>). <paramref name="live"/> is the item as the IDE holds it now;
    /// <paramref name="pushed"/> is the source being written. Throws <see cref="BridgeException"/>; returns quietly
    /// when the write is allowed.</summary>
    public static void RequireWritable(ItemContent live, ItemContent pushed,
                                       Func<string, string, string, string?> refusedLanguageChange,
                                       Func<string, KindShape>? shapeOf = null)
    {
        if (refusedLanguageChange is null) throw new ArgumentNullException(nameof(refusedLanguageChange));
        shapeOf ??= ItemKind.ShapeOf;
        if (shapeOf(pushed.Kind).Body)
            Check("the item", pushed.Kind, live.Body, live.Stated, pushed.Body, pushed.Stated, refusedLanguageChange,
                  live.Declaration, pushed.Declaration);

        var byName = live.Members.ToDictionary(m => m.Name, StringComparer.OrdinalIgnoreCase);
        foreach (var member in pushed.Members)
        {
            // NOT IN THE IDE UNDER THIS NAME AND KIND — a member added, renamed, or retyped (the reconciler deletes a
            // retyped member and creates it again) — is a CREATE of that member, and a create is held to the create
            // rule, not skipped as "nothing to overwrite": a UNSUPPORTED line has no text form, so the member would be
            // created as an EMPTY ST body (both drivers skip writing a hidden body), and for a rename or a retype the
            // reconciler has already deleted the diagram the line stood for.
            if (!byName.TryGetValue(member.Name, out var current) || current.Kind != member.Kind)
            {
                AuthorableMember(member, shapeOf);
                continue;
            }

            // WHAT THE KIND'S ROW SAYS EXISTS (ItemKind.ShapeOf, openspec bridge-refusal-review D11): a PROPERTY node
            // carries no body of its own — its code lives in its GET/SET accessors, which arrive as `Getter`/`Setter` —
            // and an INTERFACE METHOD carries neither a body nor accessors, so nothing of it is checked.
            var shape = shapeOf(member.Kind);
            if (shape.Accessors != AccessorShape.None)
            {
                // An accessor is abstract by its PROPERTY's ABSTRACT (the abstract `Busy`'s GET, C2n), so the property's
                // declarations are the ones the NONE/ABSTRACT rules read.
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
    /// member's own, or its property's for an accessor. Read only at a member site (<see cref="AbstractMemberFold.IsMemberSite"/>).</param>
    /// <param name="pushedDeclaration">The same declaration as pushed.</param>
    private static void Check(string what, string site, string? liveBody, StatedLanguage? liveStated, string? pushedBody,
                              StatedLanguage? pushedStated, Func<string, string, string, string?> refusedLanguageChange,
                              string liveDeclaration, string pushedDeclaration)
    {
        if (pushedBody is null) return;                      // nothing offered for this slot

        // No live body text is an empty ST body (or a slot with none, which D26 refuses on its own) — what an ST push
        // writes into, as it always was. The pushed body has text here, so it states a language.
        var live = StatedOf(what, "the IDE's", liveBody, liveStated) ?? StatedLanguage.St;
        var pushed = StatedOf(what, "pushed", pushedBody, pushedStated)!;

        // `IMPLEMENTATION NONE` AND ABSTRACT (openspec abstract-member-parity, DIALECT C2n) — read before any language
        // rule, because NONE names no language. Both bodies arrive FOLDED (`AbstractMemberFold`): an ABSTRACT member with
        // no code is NONE whatever the IDE object's class or slot, so every answer here is one answer for one text, on
        // both vendors. The table (design.md, step 2) is for MEMBER sites only.
        if (!AbstractMemberFold.IsMemberSite(site))
        {
            // An item's own body and an action's: NONE stays refused whatever the declaration says — `FUNCTION_BLOCK
            // ABSTRACT`'s body is a real body on both vendors, and NONE over it would write "" and clear it silently.
            if (pushed.IsNone) throw NoneOffMemberSite(what);
            if (live.IsNone)
                throw new BridgeException(BridgeErrorCodes.Unsupported,
                    $"{what} is stated '{pushed}', but the IDE holds it as '{ImplementationMarker.NoneLine}', so there is " +
                    "nothing to write that body into. Run `volt pull` to get its line.");
        }
        else
        {
            var d = StReader.MemberHeaderIsAbstract(pushedDeclaration);
            var l = StReader.MemberHeaderIsAbstract(liveDeclaration);
            if (pushed.IsNone)
            {
                if (!d)
                {
                    // NONE kept with ABSTRACT dropped over a live abstract NONE: the drop-ABSTRACT refusal and its remedy.
                    if (live.IsNone && l) throw DropsAbstract(what);
                    // C2l: a CODESYS slotless object can hold its text without ABSTRACT — the IDE already holds it so.
                    if (live.IsNone) return;
                    throw NoneWithoutAbstract(what);
                }
                // NONE over a live NONE is the ordinary no-op (`PushService.OnlyChanged` drops the body, the declaration
                // beside it lands). Over anything else NONE is an EMPTY ST BODY for every rule below — `""` written at the
                // slot over ST code, the language rules (N24) over LD/FBD, the hidden-body refusal over a hidden one.
                if (live.IsNone) return;
                pushed = StatedLanguage.St;
                pushedBody = "";
            }
            else if (live.IsNone)
            {
                // A body over a live NONE. Dropping ABSTRACT there is refused on BOTH vendors (the slot is invisible after
                // the fold, so answering by slot would give one text two outcomes); a body over a non-abstract NONE (only a
                // slotless object reads so, C2l) has nowhere to go.
                if (!d && l) throw DropsAbstract(what);
                if (!d)
                    throw new BridgeException(BridgeErrorCodes.Unsupported,
                        $"{what} is stated '{pushed}', but the IDE holds it as '{ImplementationMarker.NoneLine}' with no " +
                        "body slot, so there is nothing to write that body into. Run `volt pull` to get its line.");
                if (HoldsStatements(pushed, pushedBody)) throw StatementsUnderAbstract(what);
                // A comment (or a network / hidden body) under ABSTRACT over a live NONE: a CODESYS slotless member cannot
                // hold it, and after the fold the slot is invisible — one text, one answer, on both vendors.
                throw new BridgeException(BridgeErrorCodes.Unsupported,
                    $"{what} is stated '{pushed}' with a body that holds no statements, but the IDE holds it as " +
                    $"'{ImplementationMarker.NoneLine}', and an abstract member the IDE may hold with no body slot cannot " +
                    "take one in place. Leave the body empty, or delete the member in one push and add it with the body " +
                    "in the next (a created member has a slot).");
            }
            else if (d && HoldsStatements(pushed, pushedBody)
                     && !(l && live.Language == Languages.St && !live.Hidden && Text(liveBody) == Text(pushedBody)))
            {
                // Statements under ABSTRACT: both compilers refuse them at build (1.1, C0433). Accepted only as the code
                // the IDE already holds under ABSTRACT, unchanged — nothing is written, so a project that does not
                // compile can still push its other items.
                throw StatementsUnderAbstract(what);
            }
        }

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

    /// <summary>Does this pushed ST body hold STATEMENTS — any text left once whitespace and comments are taken away
    /// (a pragma counts: unmeasured, "niche: accepted loss (0 occurrences in the corpora)")? A comment is not a statement
    /// on either compiler (gate 2, measured: a comment-only abstract body builds clean on both). Only an ST body is asked:
    /// a network or hidden body is the language rules'.</summary>
    private static bool HoldsStatements(StatedLanguage? stated, string? body) =>
        stated is { Hidden: false } s && s.Language == Languages.St && body is not null && StTrivia.HasStatements(body);

    /// <summary>Compare on the text as it lands: both drivers trim the trailing newlines (as <c>PushService.Text</c>).</summary>
    private static string Text(string? s) => (s ?? "").TrimEnd('\n');

    private static BridgeException NoneOffMemberSite(string what) =>
        new(BridgeErrorCodes.Unsupported,
            $"{what} is stated '{ImplementationMarker.NoneLine}', which belongs only under an abstract member (a METHOD " +
            "ABSTRACT, or a PROPERTY ABSTRACT's GET/SET) — a POU's own body and an action's are real bodies, even in an " +
            $"abstract function block. State '{ImplementationMarker.For(Languages.St)}'.");

    private static BridgeException NoneWithoutAbstract(string what) =>
        new(BridgeErrorCodes.Unsupported,
            $"{what} is stated '{ImplementationMarker.NoneLine}', but its declaration is not ABSTRACT: the line says " +
            $"abstract and the declaration says concrete. State '{ImplementationMarker.For(Languages.St)}', or declare the " +
            "member ABSTRACT. If the member was made concrete in the IDE, run `volt pull`.");

    private static BridgeException DropsAbstract(string what) =>
        new(BridgeErrorCodes.Unsupported,
            $"{what}: its declaration drops ABSTRACT, but the IDE holds it as an abstract member with no code " +
            $"('{ImplementationMarker.NoneLine}') and the IDE keeps it abstract: a push never re-types a member in place. " +
            "Make the member concrete in the IDE and run `volt pull`, or delete it in one push and add it with " +
            $"'{ImplementationMarker.For(Languages.St)}' in the next.");

    private static BridgeException StatementsUnderAbstract(string what) =>
        new(BridgeErrorCodes.Unsupported,
            $"{what} is declared ABSTRACT and holds statements, and an ABSTRACT member must not contain any statements " +
            "(both compilers refuse it at build, C0433). Remove the code and state " +
            $"'{ImplementationMarker.NoneLine}', or drop ABSTRACT to make the member concrete.");

    /// <summary>The body's stated language, as its reader handed it up. Null is the reader's word for "no body text":
    /// an empty ST body (TwinCAT stores an empty ST body as no text at all) or a slot with none — never a graphical or
    /// hidden body, which always has text (its keyword line). A body WITH text and no stated language is a reader that
    /// forgot the fact, and is refused loud rather than guessed at.</summary>
    private static StatedLanguage? StatedOf(string what, string whose, string? body, StatedLanguage? stated)
    {
        if (stated is not null) return stated;
        if (string.IsNullOrWhiteSpace(body)) return body is null ? null : StatedLanguage.St;
        throw new VoltInvariantException(
            $"{what}: {whose} body has text but no stated language — the reader that produced it must state one " +
            "(openspec bridge-refusal-review D6).");
    }

    /// <summary>The language a pushed body is WRITTEN in, read by the one rule this guard reads it by — so a driver's
    /// own write (CODESYS's aspect swap) and the guard cannot disagree (review of step 4a: an empty accessor body that
    /// states nothing was ST to the guard and "no language" to the write, which then set "" on a network aspect).
    /// Null for no body.</summary>
    ///
    /// <para><b>An <c>IMPLEMENTATION NONE</c> body is written in ST</b> (openspec <c>abstract-member-parity</c>): it is
    /// written as <c>""</c> (<c>ImplementationMarker.Written</c>), the guard treats it as an empty ST body, and the CODESYS
    /// write picks its aspect from this — so NONE over a live LD/FBD member swaps the aspect to ST and writes <c>""</c>
    /// there, instead of writing <c>""</c> into the network implementation.</para>
    public static StatedLanguage? PushedLanguage(string what, string? body, StatedLanguage? stated) =>
        StatedOf(what, "pushed", body, stated) is { IsNone: true } ? StatedLanguage.St : StatedOf(what, "pushed", body, stated);

    /// <summary>How a refusal names a body's language: the language, or that the body is empty — a refusal that names
    /// only its verdict cannot be diagnosed from the other side of a pipe.</summary>
    private static string Name(StatedLanguage stated, string? body) =>
        string.IsNullOrWhiteSpace(body) ? $"{stated.Language} (empty)" : stated.Language;
}
