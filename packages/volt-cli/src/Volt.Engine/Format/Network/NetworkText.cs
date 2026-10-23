using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.St;
using Volt.Engine.Item;

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

    /// <summary>A network's TITLE or comment as the drivers hold it: EXACTLY as the IDE stores it (2R.2 S: "Title exact",
    /// "Comment verbatim" — the trailing trim and the CR LF fold went), and none where it stores nothing. The one rule the
    /// vendor readers build the model by and both writers compare by.</summary>
    public static string? Stored(string? s) => string.IsNullOrEmpty(s) ? null : s;

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
    /// for that no network can be shown around (<see cref="UnrepresentableBodyException"/>, raised by the reader or the
    /// writer: since ld-fbd-coverage 1b.4 a fact in a network's TREES makes that one network its UNSUPPORTED line instead,
    /// <see cref="NetworkTextWriter.WritePulled"/>, and only a header the text cannot carry reaches here). That is never a missing
    /// POU: an escaping throw costs the whole item (<c>Versioning.SafeVersion</c> stamps it unreadable and the fetch
    /// drops it, declaration and siblings with it).</para>
    ///
    /// <para>With it, the language the body's line states as a fact (<see cref="StatedLanguage"/>, openspec
    /// <c>bridge-refusal-review</c> D6): shown or hidden is decided HERE, so it is carried, not read back off the text.</para></summary>
    public static (string Body, string? Unsupported, StatedLanguage Stated) Pulled(BodyLanguage language, Func<string> read)
    {
        var spelled = Spelling(language);
        var hidden = ImplementationMarker.Unsupported(spelled);
        if (!NetworkTextSwitch.Enabled) return (hidden, NetworkTextSwitch.DisabledReason, StatedLanguage.HiddenIn(spelled));
        try { return (read(), null, StatedLanguage.Shown(spelled)); }
        catch (UnrepresentableBodyException ex) { return (hidden, ex.Reason, StatedLanguage.HiddenIn(spelled)); }
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
    /// each (D27, openspec bridge-refusal-review 2.23, 2.29). An unknown or missing view never throws: a throw outside
    /// <see cref="Pulled"/> would take the whole POU out of refs and fetch.</summary>
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

    /// <summary>Whether a box a driver BUILDS has an ENO output — the model's fact (<see cref="Box.HasEnoOutput"/>, stated by
    /// every reader). The one door a driver has to it.</summary>
    /// <param name="consumed">Whether something consumes the box — everything but a top-level item.</param>
    public static bool HasEnoOutput(Box b, bool consumed) => b.HasEnoOutput || b.StCode is not null;


    /// <summary>Whether a refusal met in a network's trees can stand as that network's <c>UNSUPPORTED</c> line
    /// (<see cref="Network.Unsupported"/>): its reason is a phrase the line can spell. The door the drivers' readers have to
    /// the rule the text writer shows a network by (<see cref="NetworkTextWriter.WritePulled"/>).</summary>
    public static bool ShownAsUnsupported(string reason) => NetworkSpelling.UnsupportedShape.IsMatch(reason);

    /// <summary>Whether a box type is a bit operator (AND, OR, XOR, NOT) — the boxes the vendor stores no main output for
    /// (census 1.6), so a consumer reading their value is connected by no stored slot.</summary>
    public static bool IsBitOperator(string type) => NetworkSpelling.BitOperators.Contains(type);

    /// <summary>REFUSE TO REBUILD A NETWORK THAT HOLDS A SYMBOL COMMENT — the one rule both drivers apply before a network
    /// is torn down and built again from the text (CODESYS: every changed network; TwinCAT: a changed SHAPE, through the
    /// import). <paramref name="live"/> is the network as the IDE holds it, read by the driver's own reader, which carries
    /// the vendor's <c>Operand.SymbolComment</c> as <see cref="Operand.Comment"/>.
    ///
    /// <para><b>Why a refusal and not a write.</b> Network text has no spelling for it (ld-fbd-coverage 1b.2 decides one),
    /// so a text-derived model carries none, and a rebuilt operand comes back without it. It is not the IDE's to
    /// re-derive either: census 1b.1 found 10 in the six corpora (pro2193 <c>Cylinder_53ValveFB.SetAlarm</c>), each a
    /// copy of a <c>//</c> declaration comment, 4 of them ANOTHER variable's — so the operand's own declaration cannot
    /// regenerate them. A rebuild therefore erased them with no diff to show it (the text never held them). Refused per
    /// NETWORK, naming it and the operands; a network whose text did not change is never rebuilt, so pulling and pushing
    /// such a body unchanged still works.</para></summary>
    public static void RefuseSymbolCommentLoss(string vendor, Network live)
    {
        var held = SymbolCommentOperands(live);
        if (held.Count == 0) return;
        throw new NetworkTextException(
            $"{vendor}: network {live.Order + 1} holds a symbol comment on {string.Join(", ", held)}, which network text " +
            "does not spell yet, so rebuilding this network from the text would erase it with nothing in the diff to " +
            "show it. Edit this network in the IDE; a network whose text is unchanged is never rebuilt.",
            ConflictCodes.NetworkUnsupported);
    }

    /// <summary>The operands of <paramref name="live"/> that hold a symbol comment, each quoted once (<c>'a'</c>) — what a
    /// network built from the text would not carry (<see cref="RefuseSymbolCommentLoss"/>, and the push's pairing,
    /// <see cref="NetworkPairing.RefuseUnseenLoss"/>).</summary>
    public static IReadOnlyList<string> SymbolCommentOperands(Network live) =>
        live.Trees.SelectMany(OperandsOf)
            .Where(o => !string.IsNullOrWhiteSpace(o.Comment))
            .Select(o => $"'{o.Text}'")
            .Distinct()
            .ToList();

    /// <summary>Every operand a tree holds — leaves, assignment targets, a box's instance and its output pins.</summary>
    private static IEnumerable<Operand> OperandsOf(Node n)
    {
        switch (n)
        {
            case Leaf l: yield return l.Operand; break;
            case Assign a: foreach (var t in a.Targets) yield return t; break;
            case Box b:
                if (b.Instance is not null) yield return b.Instance;
                foreach (var o in b.Outputs) yield return o.Value;
                break;
        }
        foreach (var child in n.Children())
            foreach (var o in OperandsOf(child))
                yield return o;
    }

    /// <summary>Editable graphical languages: FBD and LD. (CFC/SFC have no text form — their UNSUPPORTED
    /// <c>IMPLEMENTATION</c> line is materialized for them instead of a network-text body.)</summary>
    public static bool IsEditable(string? language) => Languages.IsNetwork(language);

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
