using System;
using System.Collections.Generic;
using Volt.Contracts;
using Volt.Engine.Format.Body;

namespace Volt.Engine.Format.Network;

/// <summary>What <see cref="NetworkTextGate.Validate"/> returns: the model when the body may be pushed, every
/// diagnostic otherwise, and the canonical form whenever the body parsed (a NOT_CANONICAL finding carries it too).</summary>
public sealed record NetworkGateResult(NetworkBody? Body, IReadOnlyList<NetworkTextDiagnostic> Diagnostics, string? Canonical)
{
    public bool Ok => Body is not null && Diagnostics.Count == 0;
}

/// <summary>
/// The network text v2 pre-push gate: read, write back, and accept iff the TOKENS agree —
/// <c>Tokens(Write(Read(x))) == Tokens(x)</c>. Specified by the spec requirement "the round trip is checked on
/// tokens and on models". It replaced v1's gate, which compared LINES and so could only accept Volt's own layout.
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
public static class NetworkTextGate
{
    public static NetworkGateResult Validate(string text, NetworkScope scope)
    {
        var (read, trace) = NetworkTextReader.ReadTokens(text, scope);
        if (!read.Ok) return new NetworkGateResult(null, read.Diagnostics, null);
        var tokens = trace.Tokens;
        var lexer = trace.Lexer;

        string canonical;
        try
        {
            canonical = NetworkTextWriter.Write(read.Body!, scope);
        }
        catch (NetworkUnrepresentableException e)
        {
            // The text reads, and the model it reads to has a fact the writer has no spelling for — the refusal
            // a pull turns into the marker, raised here by name so the push never reaches the IDE. Reported where
            // the engineer wrote it: the construct the writer was on, else the network's header.
            // Both are always there: the writer records the network of every refusal, the reader marks every node
            // the writer can name, and a body that read has one header per network. A miss is a Volt defect, and
            // reporting it at 1:1 would blame the engineer's first line for it.
            var (offset, length) =
                e.At is not null
                    ? trace.Spans.TryGetValue(e.At, out var span) ? span
                      : throw new InvalidOperationException(
                          $"network text v2: the writer refused a node the reader did not mark ({e.At.GetType().Name}): {e.Message}")
                    : e.Network is { } n && n < trace.Headers.Count ? (trace.Headers[n].Offset, trace.Headers[n].Length)
                    : throw new InvalidOperationException(
                        $"network text v2: the writer refused network {e.Network?.ToString() ?? "(none)"}, which the reader did not read: {e.Message}");
            var (line, col) = lexer!.LineCol(offset);
            return new NetworkGateResult(null, new[]
            {
                new NetworkTextDiagnostic(ConflictCodes.NetworkUnsupported,
                    $"network text has no spelling for {e.Marker}: {e.Detail} The push is refused rather than build the " +
                    "IDE a different body than this one.", line, col, length),
            }, null);
        }

        var (again, canonicalTrace) = NetworkTextReader.ReadTokens(canonical, scope);
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
            return new NetworkGateResult(null, new[]
            {
                new NetworkTextDiagnostic(ConflictCodes.NetworkNotCanonical,
                    $"graphical body is not in canonical form: {found} where the canonical form has {expected}. It would " +
                    "not come back from the IDE as written. Use this body:\n\n" + canonical.TrimEnd('\n'),
                    line, col, Math.Max(1, at.Length)),
            }, canonical);
        }

        return new NetworkGateResult(read.Body, Array.Empty<NetworkTextDiagnostic>(), canonical);
    }

    /// <summary>
    /// Whether two graphical bodies are one text but for LAYOUT: the same marker and the same tokens, whitespace
    /// significant only where the gate says it is (inside backticks, a TITLE, a comment line and an EXECUTE body).
    ///
    /// <para><b>Without a scope, on purpose.</b> It answers the CLI after a push — is the IDE's text of a body a
    /// re-layout of the pushed one, or another program? — and the CLI has no declarations to read against. Tokens need
    /// none: the lexer's one raw mode, an EXECUTE body, is entered exactly where the reader enters it (the word at
    /// value position, not a pin name), so an ST line inside a snippet is compared whole, as the gate compares it.</para>
    /// </summary>
    public static bool SameTokens(string a, string b)
    {
        if (a is null) throw new ArgumentNullException(nameof(a));
        if (b is null) throw new ArgumentNullException(nameof(b));
        var x = LayoutFree(a);
        var y = LayoutFree(b);
        if (x.Count != y.Count) return false;
        for (var i = 0; i < x.Count; i++)
            if (x[i] != y[i]) return false;
        return true;
    }

    private static List<(TokKind, string)> LayoutFree(string text)
    {
        // The marker is the first non-blank line, and its token is the language it names, as the reader takes it (a
        // line that is no marker is compared whole).
        var start = 0;
        while (start < text.Length && char.IsWhiteSpace(text[start])) start++;
        var eol = text.IndexOf('\n', start);
        if (eol < 0) eol = text.Length;
        var first = text.Substring(start, eol - start).TrimEnd('\r');
        var keys = new List<(TokKind, string)> { (TokKind.Marker, St.ImplementationMarker.LanguageOf(first) ?? first) };

        var lx = new NetworkLexer(text, eol);
        for (var t = lx.Next(); t.Kind != TokKind.Eof; t = lx.Next())
        {
            keys.Add(t.Key);
            if (!t.Is("EXECUTE") || lx.PinOperatorFollows()) continue;
            // `EXECUTE(EN := c)`: the pin list is ordinary tokens, up to the parenthesis that closes it.
            if (lx.PeekOnLine() == '(')
                for (var depth = 0; ;)
                {
                    var p = lx.Next();
                    keys.Add(p.Key);
                    if (p.Kind == TokKind.Eof) return keys;
                    if (p.IsSym("(")) depth++;
                    else if (p.IsSym(")") && --depth == 0) break;
                }
            var (snippet, end) = lx.ExecuteBody();
            keys.Add(snippet.Key);
            // An error has consumed its text and the lexer goes on from it, as the reader's recovery does.
            if (snippet.Kind != TokKind.Error) keys.Add(end.Key);
        }
        return keys;
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
