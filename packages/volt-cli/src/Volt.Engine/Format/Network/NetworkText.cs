using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.St;

namespace Volt.Engine.Format.Network;

/// <summary>
/// The network text graphical-body contract. An EDITABLE graphical body (FBD/LD — a POU's, a method's, an
/// action's or an accessor's) starts with its own implementation marker, <c>(* @volt-implementation FBD *)</c> or
/// <c>(* @volt-implementation LD *)</c>, and round-trips; the language rides on that one line for the whole body
/// (openspec <c>network-text-literal-nwl</c>, "the body language and the v1 refusal"). CFC/SFC/IL are NOT
/// network-text bodies — they materialize as <c>BodyMarker.For</c>'s informational comment.
/// </summary>
public static class NetworkText
{
    /// <summary>The text is an editable graphical network-text body — its first line is a language marker.</summary>
    public static bool Is(string? impl) => LanguageOf(impl) != null;

    /// <summary>The body's language ("FBD"/"LD" from its implementation marker), or null if not a network-text
    /// body. The marker is the body's FIRST line: a network-text body is the marker and its networks, nothing
    /// before them.</summary>
    public static string? LanguageOf(string? impl)
    {
        if (impl == null) return null;
        var text = impl.TrimStart();
        var eol = text.IndexOf('\n');
        return ImplementationMarker.LanguageOf(eol < 0 ? text : text.Substring(0, eol));
    }

    /// <summary>How a body language is spelled — on its implementation marker, and in the vendor-neutral language
    /// vocabulary (<see cref="Languages"/>). The one mapping: the marker's writer, its reader and the view-change
    /// refusal each spelled it by hand.</summary>
    public static string Spelling(BodyLanguage language) => language == BodyLanguage.Ld ? Languages.Ld : Languages.Fbd;

    /// <summary>The body language <paramref name="spelled"/> names (<see cref="Spelling"/>), or null for any other word.</summary>
    public static BodyLanguage? LanguageNamed(string? spelled) => spelled switch
    {
        Languages.Ld => BodyLanguage.Ld,
        Languages.Fbd => BodyLanguage.Fbd,
        _ => null,
    };

    /// <summary>Refuse a push that changes the body's VIEW between FBD and LD.
    ///
    /// <para>The view is a property of the whole implementation object (the vendors' <c>DefaultViewMode</c>), and
    /// network text spells it ONCE, on the body's implementation marker — so this is one comparison, the marker's
    /// language against the IDE's view. Neither driver writes the member on an update, so an edited marker would be
    /// accepted, write nothing, and be reverted by the next pull.</para>
    ///
    /// <para>Refusing rather than writing, for now, because whether the member is settable on a live CODESYS
    /// aspect is NOT measured — TwinCAT has <c>TcArchive.WithViewMode</c> and uses it on the create route only.
    /// A field that is rendered, accepted and ignored is the worst of the three; say so instead.</para></summary>
    public static void RefuseViewModeChange(BodyLanguage? live, BodyLanguage pushed)
    {
        if (live is not { } was || was == pushed) return;

        throw new NotSupportedException(
            $"the graphical body's view is {Spelling(was)} and the pushed text says {Spelling(pushed)}. Volt cannot " +
            "change a body's view — it is one property of the whole body, and nothing here writes it — so the " +
            "push is refused rather than silently applying every other edit and reverting this one on the next " +
            "pull. Switch the view in the IDE and pull.");
    }

    /// <summary>Editable graphical languages: FBD and LD. (CFC/SFC have no text form — an informational
    /// marker is materialized for them instead of a network-text body.)</summary>
    public static bool IsEditable(string? language) => Languages.IsNetwork(language);

    // `NETWORK <n> <LANG>` — v1's per-network header, which carried the order number and the language.
    private static readonly System.Text.RegularExpressions.Regex V1Header =
        new(@"^\s*NETWORK\s+\d+(\s|$)", System.Text.RegularExpressions.RegexOptions.CultureInvariant);

    /// <summary>A line that is a v1 network header (<c>NETWORK 0 LD</c>).</summary>
    public static bool IsV1Header(string line) => V1Header.IsMatch(line);

    /// <summary>The body is network text v1: its first non-blank line is a <c>NETWORK &lt;n&gt; &lt;LANG&gt;</c>
    /// header. v1 bodies follow the BARE implementation marker, so none of them reaches the v2 reader through
    /// <see cref="Is"/> — without this they would read as ST and a push would write their text into the IDE as
    /// Structured Text.</summary>
    private static bool IsV1(string? body)
    {
        if (body is null) return false;
        foreach (var line in body.Split('\n'))
            if (line.Trim().Length > 0) return IsV1Header(line);
        return false;
    }

    /// <summary>The v1 refusal's wording, one sentence for every place that meets v1 text (spec, "the body
    /// language and the v1 refusal": no translator, re-pull).</summary>
    public static string V1Refusal(string what) =>
        $"this is network text v1 ({what}), which Volt no longer reads and does not translate: re-pull the POU to get " +
        "the current form, and redo the edit on it.";

    /// <summary>Refuse a v1 body by name (<c>NETWORK_PARSE</c>, "re-pull"); a no-op for any other body.</summary>
    public static void RefuseV1(string? body)
    {
        if (IsV1(body)) throw new NetworkTextException(V1Refusal("`NETWORK <n> <LANG>` headers"));
    }

    /// <summary>The push path's gate: validate a network-text body against the declarations it can see and
    /// return its model, or throw <see cref="NetworkTextException"/> carrying the FIRST finding — its
    /// <c>NETWORK_*</c> code and line. The language is the body's own marker: a view change is refused
    /// separately, against the IDE's view (<see cref="RefuseViewModeChange"/>), where the drivers know it.</summary>
    public static NetworkBody Validate(string body, NetworkScope scope)
    {
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
