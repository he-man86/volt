using System.Globalization;
using System;
using System.Collections.Generic;
using Volt.Contracts;
using Volt.Engine.Format.Body;

namespace Volt.Engine.Format.Network;

/// <summary>What <see cref="NetworkTextGate.Validate"/> returns: the model when the body may be pushed, every
/// diagnostic otherwise, and the canonical form — the text the next pull shows — whenever the body read and the writer
/// could spell it.</summary>
public sealed record NetworkGateResult(NetworkBody? Body, IReadOnlyList<NetworkTextDiagnostic> Diagnostics, string? Canonical)
{
    public bool Ok => Body is not null && Diagnostics.Count == 0;
}

/// <summary>
/// The network text v2 pre-push gate: READ the body, then WRITE the model back. A body is pushed when it reads into a
/// complete model the writer can spell; the written text is its canonical form, which the next pull shows.
///
/// <para><b>Canonical form is not a refusal</b> (openspec <c>bridge-refusal-review</c> 2.12). This gate used to compare
/// the body's TOKENS with the canonical text's and refuse any difference as <c>NETWORK_NOT_CANONICAL</c> — header fields
/// in another order, <c>AND(a, b)</c> where infix is canonical, a second wire block — a complete, writable model refused
/// for its spelling, and a family of reader layout rules that existed only to make that comparison pass. The model is
/// written; the IDE holds the model, and the canonical text comes back. Layout is still compared layout-free after a push
/// (<see cref="SameTokens"/>).</para>
///
/// <para><b>What the reader refuses is not re-checked here.</b> Every wire rule, the <c>.ENO</c> rule, edges and the
/// producer-type check are the reader's diagnostics, at their spans. The gate adds the one check that needs the writer: a
/// model the text can hold but the writer cannot spell (refused by name, NETWORK_UNSUPPORTED) — the next pull would hide
/// it.</para>
/// </summary>
public static class NetworkTextGate
{
    public static NetworkGateResult Validate(string text, NetworkScope scope)
    {
        var (read, trace) = NetworkTextReader.ReadTokens(text, scope);
        if (!read.Ok) return new NetworkGateResult(null, read.Diagnostics, null);
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
                        $"network text v2: the writer refused network {e.Network?.ToString(CultureInfo.InvariantCulture) ?? "(none)"}, which the reader did not read: {e.Message}");
            var (line, col) = lexer!.LineCol(offset);
            return new NetworkGateResult(null, new[]
            {
                new NetworkTextDiagnostic(ConflictCodes.NetworkUnsupported,
                    $"network text has no spelling for {e.Reason}: {e.Detail} The push is refused rather than build the " +
                    "IDE a different body than this one.", line, col, length),
            }, null);
        }

        var (again, _) = NetworkTextReader.ReadTokens(canonical, scope);
        if (!again.Ok)
            // Not bad input: the writer produced text its own reader refuses. Loud, because a diagnostic here would
            // blame the engineer for a Volt defect.
            throw new InvalidOperationException(
                "network text v2: the canonical form of a valid body does not read back — " +
                again.Diagnostics[0].Code + ": " + again.Diagnostics[0].Message + "\n\n" + canonical);

        return new NetworkGateResult(read.Body, Array.Empty<NetworkTextDiagnostic>(), canonical);
    }

    /// <summary>
    /// Whether two graphical bodies are one text but for LAYOUT: the same marker and the same tokens, as the gate
    /// compares them — whitespace significant only inside backticks, a TITLE, a comment line and an EXECUTE body, and a
    /// line's end at bracket depth 0 a token of its own (P2: an open line is no layout). A push in another
    /// layout is adopted as that layout when the IDE gives it back canonically; one in another SPELLING (tokens) is
    /// written all the same (<see cref="Validate"/>) and its canonical text comes back on the next pull.
    ///
    /// <para><b>Without a scope, on purpose.</b> It answers the CLI after a push — is the IDE's text of a body a
    /// re-layout of the pushed one, or another program? — and the CLI has no declarations to read against. Tokens need
    /// none: EXECUTE bodies are entered by the lexer's one scope-free copy of the reader's rule
    /// (<see cref="NetworkLexer.Walk"/>), so an ST line inside a snippet is compared whole, as the gate compares it.</para>
    /// </summary>
    public static bool SameTokens(string a, string b)
    {
        if (a is null) throw new ArgumentNullException(nameof(a));
        if (b is null) throw new ArgumentNullException(nameof(b));
        var x = LayoutFree(a);
        var y = LayoutFree(b);
        // A text that does not lex has no tokens to compare past its error, which swallows what follows it: two such
        // texts carrying one message would otherwise be "the same" whatever programs stand behind them.
        if (x is null || y is null || x.Count != y.Count) return false;
        for (var i = 0; i < x.Count; i++)
            if (x[i] != y[i]) return false;
        return true;
    }

    /// <summary>The text's tokens as the gate compares them, or null where it does not lex.</summary>
    private static List<(TokKind, string)>? LayoutFree(string text)
    {
        // The IMPLEMENTATION line is the first non-blank line, and its token is the language it states, as the reader
        // takes it (a line that states none is compared whole).
        var start = 0;
        while (start < text.Length && char.IsWhiteSpace(text[start])) start++;
        var eol = text.IndexOf('\n', start);
        if (eol < 0) eol = text.Length;
        var first = text.Substring(start, eol - start).TrimEnd('\r');
        var keys = new List<(TokKind, string)> { (TokKind.Marker, St.ImplementationMarker.LanguageOf(first) ?? first) };

        // A LINE is no layout (P2): a line without `;` is open for a later line's ENO (P3), so where a line ends is a token
        // of its own here — marked where a token starts a new line at bracket depth 0 after a token that can end one.
        var lx = new NetworkLexer(text, eol);
        var walk = new NetworkLexer.Walk(lx);
        Tok prev = default, before = default;
        var depth = 0;
        for (var t = walk.Next(); t.Kind != TokKind.Eof; t = walk.Next())
        {
            if (t.Kind == TokKind.Error) return null;
            if (prev.Text is not null)
            {
                var continues = NetworkSpelling.ContinuesLine(prev, before);
                if (depth == 0 && t.Kind != TokKind.Snippet && prev.Kind != TokKind.Snippet && prev.Kind != TokKind.Marker &&
                    lx.LineOf(t.Offset) > lx.LineOf(prev.Offset) && !continues)
                    keys.Add((TokKind.Sym, "\n"));
            }
            if (t.IsSym("(")) depth++;
            else if (t.IsSym(")")) depth = Math.Max(0, depth - 1);
            keys.Add(t.Key);
            (before, prev) = (prev, t);
        }
        return keys;
    }
}
