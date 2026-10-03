using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.St;

namespace Volt.Engine.Format.Network;

/// <summary>
/// The network text graphical-body contract. An EDITABLE graphical body (FBD/LD — a POU's, a method's, an
/// action's or an accessor's) states its language on its boundary line, <c>IMPLEMENTATION FBD</c> or
/// <c>IMPLEMENTATION LD</c>, which stays the body's first line and round-trips; the language rides on that one line for
/// the whole body (openspec <c>implementation-keyword</c>). CFC/SFC/IL are NOT network-text bodies, and neither is an
/// LD/FBD body the text cannot represent: each is its UNSUPPORTED line alone (<c>IMPLEMENTATION CFC UNSUPPORTED</c>,
/// <c>IMPLEMENTATION LD UNSUPPORTED</c>, <see cref="ImplementationMarker.IsUnsupportedBody"/>).
/// </summary>
public static class NetworkText
{
    /// <summary>The text is an editable graphical network-text body — its first line states LD or FBD.</summary>
    public static bool Is(string? impl) => LanguageOf(impl) != null;

    /// <summary>A network's TITLE or comment as the drivers hold it: trimmed at the end, and none where nothing is
    /// left. Both vendors' readers trim these (the IDE keeps the newline an engineer typed after a title) and both
    /// writers compare ignoring trailing whitespace, so a trailing space, an empty title or a closing empty <c>//</c>
    /// line is no fact a push can write. The one rule: the vendor readers build the model by it, the text reader reads
    /// by it — so the gate calls such a text not canonical — and the text writer refuses a model that breaks it.</summary>
    public static string? Stored(string? s) =>
        string.IsNullOrEmpty(s) ? null : s!.TrimEnd() is { Length: > 0 } t ? t : null;

    /// <summary>The body's language ("FBD"/"LD", from the <c>IMPLEMENTATION</c> line it opens with), or null if not a
    /// network-text body. The line is the body's FIRST line: a network-text body is that line and its networks, nothing
    /// before them. A body stating ST is no network text — its language is the ST path's, and an ST body in memory
    /// carries no line at all (<see cref="ImplementationMarker.Split"/>).</summary>
    public static string? LanguageOf(string? impl)
    {
        if (impl == null) return null;
        var text = impl.TrimStart();
        var eol = text.IndexOf('\n');
        var lang = ImplementationMarker.LanguageOf(eol < 0 ? text : text.Substring(0, eol));
        return Languages.IsNetwork(lang) ? lang : null;
    }

    /// <summary>An LD or FBD body as a PULL hands it up: its network text, from <paramref name="read"/> — the driver's
    /// own reader and <see cref="NetworkTextWriter"/> — or its UNSUPPORTED line and why. The ONE decision every driver's
    /// pull (and <c>FakeIde</c>) makes for such a body, so the vendors cannot answer the same body differently.
    ///
    /// <para>Hidden, with the reason the pull message names, when network text is off in this process
    /// (<see cref="NetworkTextSwitch"/>) — asked FIRST, so a production bridge reads no network at all and one it could
    /// not read is hidden for the same reason as every other — or when the body holds a fact the text has no spelling
    /// for (<see cref="UnrepresentableBodyException"/>, raised by the reader or the writer). That is never a missing
    /// POU: an escaping throw costs the whole item (<c>Versioning.SafeVersion</c> stamps it unreadable and the fetch
    /// drops it, declaration and siblings with it).</para></summary>
    public static (string Body, string? Unsupported) Pulled(BodyLanguage language, Func<string> read)
    {
        var hidden = ImplementationMarker.Unsupported(Spelling(language));
        if (!NetworkTextSwitch.Enabled) return (hidden, NetworkTextSwitch.DisabledReason);
        try { return (read(), null); }
        catch (UnrepresentableBodyException ex) { return (hidden, ex.Reason); }
    }

    /// <summary>How a body language is spelled — on its <c>IMPLEMENTATION</c> line, and in the vendor-neutral language
    /// vocabulary (<see cref="Languages"/>). The one mapping: the marker's writer, its reader and the view-change
    /// refusal each spelled it by hand.</summary>
    public static string Spelling(BodyLanguage language) => language == BodyLanguage.Ld ? Languages.Ld : Languages.Fbd;

    /// <summary>The vendors' name for a network body's object — <c>NWLImplementationObject</c> on both — and the language
    /// its line states when the body names no view at all (<see cref="ViewLanguage"/>).</summary>
    public const string UnviewedNetwork = "NWL";

    /// <summary>The language a network body's line states, from the view mode the vendor stores on it (CODESYS's aspect
    /// member and TwinCAT's archive slot are both <c>DefaultViewMode</c>, DIALECT N1): <c>LD</c> or <c>FBD</c>, read as
    /// network text; <c>IL</c>, a view Volt does not author; and a view Volt has never seen under the vendor's own name
    /// (<see cref="ImplementationMarker.VendorLanguage"/>), or <see cref="UnviewedNetwork"/> when the body states none.
    /// The last three are the body's UNSUPPORTED line. ONE answer for both vendors, so the same body is the same line on
    /// each (D27, openspec bridge-refusal-review 2.23, 2.29): an unknown or missing view used to be a throw outside
    /// <see cref="Pulled"/>, which took the whole POU out of refs and fetch.</summary>
    public static string ViewLanguage(string? viewMode)
    {
        if (string.IsNullOrWhiteSpace(viewMode)) return UnviewedNetwork;
        var mode = viewMode!.Trim();
        if (mode.Equals(Languages.Ld, StringComparison.OrdinalIgnoreCase)) return Languages.Ld;
        if (mode.Equals(Languages.Fbd, StringComparison.OrdinalIgnoreCase)) return Languages.Fbd;
        if (mode.Equals(Languages.Il, StringComparison.OrdinalIgnoreCase)) return Languages.Il;
        return ImplementationMarker.VendorLanguage(mode);
    }

    /// <summary>The body language <paramref name="spelled"/> names (<see cref="Spelling"/>), or null for any other word.</summary>
    public static BodyLanguage? LanguageNamed(string? spelled) => spelled switch
    {
        Languages.Ld => BodyLanguage.Ld,
        Languages.Fbd => BodyLanguage.Fbd,
        _ => null,
    };

    /// <summary>Whether a box a driver BUILDS has an ENO output: the model's fact where it has one, and where the text
    /// states none (<see cref="Box.HasEnoOutput"/> null), the text's own reading of the box
    /// (<see cref="NetworkSpelling.TextHasEno"/>) — the rule the reader built the model by, so the built box is the
    /// one the text describes. The one door a driver has to that rule; a copy of it in a driver is free to drift.</summary>
    /// <param name="consumed">Whether something consumes the box — everything but a top-level item.</param>
    public static bool HasEnoOutput(Box b, bool consumed) =>
        b.HasEnoOutput ?? NetworkSpelling.TextHasEno(isExecute: b.StCode is not null, hasEnable: b.Enable is not null,
                                                     enoSuffix: NetworkSpelling.ConnectedByEno(b), consumed: consumed);

    /// <summary>A WIRE'S PRODUCER, CARRYING THE TYPE THE TEXT DECLARED THE WIRE WITH as the stored output type of the slot
    /// the wire is connected to (<see cref="Box.OutputTypes"/>) — what a driver building the box writes where its vendor
    /// keeps a box's output type. The text states a data wire's type only in its <c>VAR_TEMP</c> (spec: "on push the
    /// declared type is taken as written"), and the vendor derives none itself (DIALECT N21: CODESYS's
    /// <c>OutputParams</c> holds exactly what the writer appended). Built without it, <c>g1 := (a + b);</c> declared
    /// <c>INT</c> read back as a wire of unknown type: the next pull was UNSUPPORTED, and the next push of the same text
    /// was refused by the change gate rendering the live network. Only a box connected by a data slot takes it — a
    /// consumer of ENO reads a BOOL the rule already knows, and a bit operator stores no slot to carry one (census 1.6);
    /// a type already stored is its own answer.</summary>
    public static Node WithDeclaredType(Node producer, string? declared) =>
        producer is Box { OutputTypes: null, StCode: null, ConnectedSlot: { } slot } b && declared is not null
        && !NetworkSpelling.ConnectedByEno(b)
            ? b with { OutputTypes = Enumerable.Repeat<string?>(null, slot).Append(declared).ToList() }
            : producer;

    /// <summary>Whether a box type is a comparison operator (GT, GE, LT, LE, EQ, NE) — the engine's one list, the door a
    /// driver has to it so a refusal keyed on "a comparison" cannot drift from the set the text types as BOOL.</summary>
    public static bool IsComparison(string type) => NetworkSpelling.Comparisons.Contains(type);

    /// <summary>Editable graphical languages: FBD and LD. (CFC/SFC have no text form — their UNSUPPORTED
    /// <c>IMPLEMENTATION</c> line is materialized for them instead of a network-text body.)</summary>
    public static bool IsEditable(string? language) => Languages.IsNetwork(language);

    // `NETWORK <n> <LANG>` — v1's per-network header, which carried the order number and the language.
    private static readonly System.Text.RegularExpressions.Regex V1Header =
        new(@"^\s*NETWORK\s+\d+(\s|$)", System.Text.RegularExpressions.RegexOptions.CultureInvariant);

    /// <summary>A line that is a v1 network header (<c>NETWORK 0 LD</c>). Internal on purpose: a line alone says
    /// nothing — the same spelling in a declaration's comment is no v1 text. Outside the reader, ask
    /// <see cref="SourceHoldsV1"/>, which looks at bodies only.</summary>
    internal static bool IsV1Header(string line) => V1Header.IsMatch(line);

    /// <summary>
    /// Every network-text-v1 construct in a graphical body's text from <paramref name="from"/> (past its marker line),
    /// each with the name the refusal gives it. THE one rule of what is v1: the reader refuses exactly these, before it
    /// parses a statement, and <see cref="HoldsV1"/> names a file for exactly these — so the pull's note and the push
    /// cannot disagree by construction.
    ///
    /// <para>WHY a scan by SHAPE and not by grammar place. A v2 body with v1 in it is what a CLEAN git merge makes of an
    /// un-pushed v1 edit (a <c>LET</c> between two unchanged statements, a whole v1 network appended). That text is
    /// v1-shaped wherever it lands — after <c>IF … THEN</c> (v1's own en-hoist line), after a statement v1 wrote with
    /// no <c>;</c>, after a <c>//</c> comment v1 allowed anywhere. Judging it only where a v2 STATEMENT starts took a
    /// second copy of the reader's grammar that drifted from it five ways; and an error the reader stops at hid a
    /// v1 construct the push would refuse once that error was fixed — when a re-pull no longer helps. The shapes are
    /// exact, so the only place they need is the one kind of name that may be spelled <c>Let</c> bare — a label:</para>
    /// <list type="bullet">
    /// <item><c>LET name :=</c> — v1's wire definition, the only way its writer spelled <c>LET</c>. v2 never has it:
    /// an operand or target spelled <c>LET</c> is backticked (spec, reserved words), and a pin named <c>Let</c> is
    /// followed by <c>:=</c> or <c>=&gt;</c>. A LABEL named <c>Let</c> — on the header's line, or after <c>JMP</c> — is not
    /// judged: it is followed by the next line's statement (<c>LABEL: Let</c>, then <c>out := a;</c>), which spells
    /// the same three tokens.</item>
    /// <item>a number at a FIELD position of a <c>NETWORK</c> header's line — v1's <c>NETWORK &lt;n&gt;</c>. A number
    /// where a field's VALUE stands (after <c>:</c>, or after <c>LABEL</c>/<c>TITLE</c> missing its colon) is a
    /// malformed field, one ordinary fix from v2, and not v1.</item>
    /// </list>
    ///
    /// <para>The text is walked with the reader's own token walk (<see cref="NetworkLexer.Walk"/>): a <c>//</c> comment
    /// is a comment and an EXECUTE body is verbatim ST. A lexical error that swallows the rest of the text (an unclosed
    /// backtick) does not end the scan: it goes on from the next line, as a fixed backtick would let the push.</para>
    /// </summary>
    internal static List<(Tok At, string What)> V1Constructs(string text, int from)
    {
        var found = new List<(Tok, string)>();
        var lx = new NetworkLexer(text, from);
        var walk = new NetworkLexer.Walk(lx);
        var headerLine = -1;
        Tok prev = default, before = default, third = default;   // the last three tokens, comments skipped
        Tok last = default;                     // the last token, comments included: the restart point
        while (true)
        {
            var t = walk.Next();
            if (t.Kind == TokKind.Eof)
            {
                // Each restart starts strictly later, so this ends.
                if (last.Kind != TokKind.Error) return found;
                var next = text.IndexOf('\n', last.Offset);
                if (next < 0) return found;
                lx = new NetworkLexer(text, next + 1);
                walk = new NetworkLexer.Walk(lx);
                (last, prev, before, third, headerLine) = (default, default, default, default, -1);
                continue;
            }
            last = t;
            if (t.Kind is TokKind.Comment or TokKind.Error) continue;

            // `NETWORK` at a line start is a header wherever it stands, as the reader's body loop and recovery take it.
            if (t.Is("NETWORK") && t.AtLineStart) headerLine = lx.LineOf(t.Offset);
            else if (t.Kind == TokKind.Number && headerLine >= 0 && lx.LineOf(t.Offset) == headerLine &&
                     !prev.IsSym(":") && !prev.Is("LABEL") && !prev.Is("TITLE"))
                found.Add((t, "`NETWORK <n> <LANG>` headers"));
            else if (t.IsSym(":=") && prev.Kind == TokKind.Word && before.Is("LET") && !third.Is("JMP") &&
                     lx.LineOf(before.Offset) != headerLine)
                found.Add((before, "`LET` statements"));

            (third, before, prev) = (before, prev, t);
        }
    }

    /// <summary>
    /// The body still holds network text v1 — text the push refuses ("re-pull"): a network-text body holding a v1
    /// construct (<see cref="V1Constructs"/>, the reader's own rule), a whole v1 network included.
    ///
    /// <para>Network text is only ever a body STATED LD or FBD. A whole v1 body under any other line is either a file
    /// from before the <c>IMPLEMENTATION</c> keyword (no boundary line: refused by <see cref="StReader.Read"/>, "pull
    /// once") or an ST body — <c>IMPLEMENTATION ST</c> states ST whatever the body holds, and the IDE's build answers it
    /// (openspec <c>bridge-refusal-review</c> 1.1).</para>
    /// </summary>
    private static bool HoldsV1(string? body)
    {
        if (!Is(body)) return false;
        var eol = body!.IndexOf('\n');
        return eol >= 0 && V1Constructs(body, eol).Count > 0;
    }

    /// <summary>A workspace source file of <paramref name="kind"/> holds network text v1 in any of its bodies — the
    /// POU's, a member's, a property accessor's (<see cref="HoldsV1"/>). Only bodies are looked at: the declaration
    /// is ST whatever its comments spell. Throws what <see cref="StReader.Read"/> throws on a malformed file.</summary>
    private static bool SourceHoldsV1(string source, string kind)
    {
        var item = StReader.Read(source, kind);
        return HoldsV1(item.Body) || item.Members.Any(m =>
            HoldsV1(m.Body) || HoldsV1(m.Getter?.Body) || HoldsV1(m.Setter?.Body));
    }

    /// <summary>Can a workspace file named <paramref name="wireName"/> hold network text at all? Only a source kind
    /// with an implementation to separate (<see cref="ImplementationMarker.AppliesTo"/>) has a body — a GVL, a DUT, an
    /// interface or a descriptor has none. Asked by NAME because the file name IS the wire name: a
    /// client (the pull's v1 note) asks this and resolves no kind of its own — the kind table is the engine's.</summary>
    public static bool CanHold(string wireName) =>
        Volt.Engine.Item.ItemKind.KindForWireName(wireName) is { } kind
        && Volt.Engine.Item.ItemKind.IsSourceKind(kind)
        && ImplementationMarker.AppliesTo(kind);

    /// <summary><see cref="SourceHoldsV1"/> for the file named <paramref name="wireName"/>. A file that cannot hold
    /// network text (<see cref="CanHold"/>) holds no v1 — that is the answer, not a guess, and it is given before the
    /// text is read, so a GVL or a DUT is never parsed as a body it does not have. Throws what
    /// <see cref="StReader.Read"/> throws on a malformed file.</summary>
    public static bool FileHoldsV1(string wireName, string source) =>
        CanHold(wireName) && SourceHoldsV1(source, Volt.Engine.Item.ItemKind.KindForWireName(wireName)!);

    /// <summary>The v1 refusal's wording, one sentence for every place that meets v1 text (spec, "the body
    /// language and the v1 refusal": no translator, re-pull).</summary>
    public static string V1Refusal(string what) =>
        $"this is network text v1 ({what}), which Volt no longer reads and does not translate: re-pull the POU to get " +
        "the current form, and redo the edit on it.";

    /// <summary>The push path's gate: validate a network-text body against the declarations it can see and
    /// return its model, or throw <see cref="NetworkTextException"/> carrying the FIRST finding — its
    /// <c>NETWORK_*</c> code and line. The language is the body's own marker: a view change is the drivers' to write,
    /// against the IDE's view, where they know it (openspec bridge-refusal-review 2.22, 2.31).</summary>
    public static NetworkBody Validate(string body, NetworkScope scope)
    {
        // Every network-text body a push carries comes through here — the engine's pre-flight, the create arm, and each
        // driver's own write — so this is the one refusal a production bridge needs: before the text is read, and so
        // before anything is written.
        if (!NetworkTextSwitch.Enabled)
        {
            var language = LanguageOf(body) ?? throw new ArgumentException("no network-text body", nameof(body));
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"a body is stated '{ImplementationMarker.For(language)}', and {NetworkTextSwitch.DisabledReason}, so it " +
                $"cannot be pushed: this build shows that body as '{ImplementationMarker.Unsupported(language)}' and " +
                "never writes it. Pull the item to get that line; its declaration stays editable.");
        }

        var result = NetworkTextGate.Validate(body, scope);
        if (result.Ok) return result.Body!;
        var first = result.Diagnostics[0];
        var more = result.Diagnostics.Count > 1 ? $" (and {result.Diagnostics.Count - 1} more finding(s))" : "";
        throw new NetworkTextException(first.Message + more, first.Code) { Line = first.Line };
    }
}

/// <summary>A network-text body the push refuses: the first finding's <c>NETWORK_*</c> code (a published
/// vocabulary, <see cref="ConflictCodes"/>) and its 1-based line.</summary>
public sealed class NetworkTextException : Exception
{
    public string Code { get; }
    public int? Line { get; set; }
    // The default is the general structural failure, and it is the CONST rather than a literal: these codes
    // reach clients on `PushConflict.Code`, so they are a published vocabulary (`ConflictCodes.Network`) and
    // not an implementation detail of this file. A literal default here is how a phantom code got documented.
    public NetworkTextException(string message, string code = ConflictCodes.NetworkParse) : base(message) { Code = code; }
}
