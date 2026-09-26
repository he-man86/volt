using System;
using System.Collections.Generic;
using Volt.Contracts;
using Volt.Engine.Format.Body;

namespace Volt.Engine.Format.Network.Next;

/// <summary>What <see cref="NextNetworkTextGate.Validate"/> returns: the model when the body may be pushed, every
/// diagnostic otherwise, and the canonical form whenever the body parsed (a NOT_CANONICAL finding carries it too).</summary>
public sealed record NextGateResult(NetworkBody? Body, IReadOnlyList<NextNetworkTextDiagnostic> Diagnostics, string? Canonical)
{
    public bool Ok => Body is not null && Diagnostics.Count == 0;
}

/// <summary>
/// The network text v2 pre-push gate: read, write back, and accept iff the TOKENS agree —
/// <c>Tokens(Write(Read(x))) == Tokens(x)</c>. Specified by the spec requirement "the round trip is checked on
/// tokens and on models"; built beside the v1 <see cref="NetworkTextGate"/>.
///
/// <para><b>Tokens, not bytes.</b> v1 compared lines, so it could only accept Volt's own layout and had to demand
/// Volt's numbering. Whitespace here is layout everywhere except where it is content — inside backticks, a TITLE,
/// a comment line and an EXECUTE body — and those arrive as ONE token each, compared whole. So re-wrapping a
/// 30-pin call one pin per line passes, and changing any token does not: a NOT_CANONICAL finding always names a
/// token, never a space.</para>
///
/// <para><b>What the reader already refuses is not re-checked here.</b> Every wire rule, the <c>.ENO</c> rule,
/// edges, reserved names and the producer-type check are the reader's diagnostics, at their spans. The gate adds
/// the two checks that need the writer: a model the text can hold but the writer cannot spell (refused by name,
/// NETWORK_UNSUPPORTED), and a body that is valid but not the canonical form.</para>
/// </summary>
public static class NextNetworkTextGate
{
    public static NextGateResult Validate(string text, BodyLanguage language, NextNetworkScope scope)
    {
        var (read, trace) = NextNetworkTextReader.ReadTokens(text, language, scope);
        if (!read.Ok) return new NextGateResult(null, read.Diagnostics, null);
        var tokens = trace.Tokens;
        var lexer = trace.Lexer;

        string canonical;
        try
        {
            canonical = NextNetworkTextWriter.Write(read.Body!, scope);
        }
        catch (NextUnrepresentableException e)
        {
            // The text reads, and the model it reads to has a fact the writer has no spelling for — the refusal
            // a pull turns into the marker, raised here by name so the push never reaches the IDE. Reported where
            // the engineer wrote it: the construct the writer was on, else the network's header.
            var (offset, length) =
                e.At is not null && trace.Spans.TryGetValue(e.At, out var span) ? span
                : e.Network is { } n && n < trace.Headers.Count ? (trace.Headers[n].Offset, trace.Headers[n].Length)
                : (0, 1);
            var (line, col) = lexer!.LineCol(offset);
            return new NextGateResult(null, new[]
            {
                new NextNetworkTextDiagnostic(ConflictCodes.NetworkUnsupported,
                    $"network text has no spelling for {e.Marker}: {e.Detail} The push is refused rather than build the " +
                    "IDE a different body than this one.", line, col, length),
            }, null);
        }

        var (again, canonicalTrace) = NextNetworkTextReader.ReadTokens(canonical, language, scope);
        var canonicalTokens = canonicalTrace.Tokens;
        if (!again.Ok)
            // Not bad input: the writer produced text its own reader refuses. Loud, because a diagnostic here would
            // blame the engineer for a Volt defect.
            throw new InvalidOperationException(
                "network text v2: the canonical form of a valid body does not read back — " +
                again.Diagnostics[0].Code + ": " + again.Diagnostics[0].Message + "\n\n" + canonical);

        for (var i = 0; i < Math.Max(tokens.Count, canonicalTokens.Count); i++)
        {
            if (i < tokens.Count && i < canonicalTokens.Count && tokens[i].Key == canonicalTokens[i].Key) continue;
            var at = i < tokens.Count ? tokens[i] : tokens[tokens.Count - 1];
            var (line, col) = lexer!.LineCol(at.Offset);
            var expected = i < canonicalTokens.Count ? Show(canonicalTokens[i]) : "the end of the body";
            var found = i < tokens.Count ? Show(tokens[i]) : "the end of the body";
            return new NextGateResult(null, new[]
            {
                new NextNetworkTextDiagnostic(ConflictCodes.NetworkNotCanonical,
                    $"graphical body is not in canonical form: {found} where the canonical form has {expected}. It would " +
                    "not come back from the IDE as written. Use this body:\n\n" + canonical.TrimEnd('\n'),
                    line, col, Math.Max(1, at.Length)),
            }, canonical);
        }

        return new NextGateResult(read.Body, Array.Empty<NextNetworkTextDiagnostic>(), canonical);
    }

    private static string Show(Tok t) => t.Kind switch
    {
        TokKind.String => "the title \"" + t.Text + "\"",
        TokKind.Comment => "the comment line '" + t.Text + "'",
        TokKind.Snippet => "an EXECUTE body",
        TokKind.Wires => "the wire block (" + t.Text + ")",
        TokKind.Backtick => "`" + t.Text + "`",
        TokKind.Marker => "the marker for " + t.Text,
        _ => "'" + t.Text + "'",
    };
}
