using System.Globalization;
using System;
using System.Collections.Generic;
using Volt.Contracts;

namespace Volt.Engine.Format.Network;

/// <summary>What <see cref="NetworkTextGate.Validate"/> returns: the model when the body may be pushed, every
/// diagnostic otherwise, and the canonical form — the text the next pull shows — whenever the body read and the writer
/// could spell it.</summary>
public sealed record NetworkGateResult(NetworkBody? Body, IReadOnlyList<NetworkTextDiagnostic> Diagnostics, string? Canonical)
{
    public bool Ok => Body is not null && Diagnostics.Count == 0;
}

/// <summary>
/// The network text pre-push gate: READ the body (the reader runs the shared validator), derive what the push builds from
/// the declarations (<see cref="NetworkDerivation"/>), and WRITE the model: its text is the canonical form the next pull
/// shows. A non-canonical spelling of a valid model is no refusal (openspec <c>bridge-refusal-review</c> 2.12); a model the
/// writer cannot spell is (NETWORK_UNSUPPORTED), reported where the engineer wrote it. That the canonical text reads back to
/// the same model is the offline oracle's to prove (<c>Read(Write(m)) ≅ m</c>), not a runtime step.
/// </summary>
public static class NetworkTextGate
{
    public static NetworkGateResult Validate(string text, NetworkScope scope)
    {
        var (read, trace) = NetworkTextReader.ReadTokens(text, scope);
        if (!read.Ok) return new NetworkGateResult(null, read.Diagnostics, null);
        var lexer = trace.Lexer;

        var body = NetworkDerivation.Derive(read.Body!, scope, out var origin);
        try
        {
            return new NetworkGateResult(body, Array.Empty<NetworkTextDiagnostic>(), NetworkTextWriter.Write(body, scope));
        }
        catch (NetworkUnrepresentableException e)
        {
            // The text reads, and the model it reads to holds a fact the writer has no spelling for. Reported at the construct
            // the writer was on, else the network's header — both always there: the writer records the network of every
            // refusal, the reader marks every node, and a body that read has one header per network.
            var at = e.At is not null && origin.TryGetValue(e.At, out var written) ? written : e.At;
            var (offset, length) =
                at is not null
                    ? trace.Spans.TryGetValue(at, out var span) ? span
                      : throw new VoltInvariantException(
                          $"network text: the writer refused a node the reader did not mark ({at.GetType().Name}): {e.Message}")
                    : e.Network is { } n && n < trace.Headers.Count ? (trace.Headers[n].Offset, trace.Headers[n].Length)
                    : throw new VoltInvariantException(
                        $"network text: the writer refused network {e.Network?.ToString(CultureInfo.InvariantCulture) ?? "(none)"}, which the reader did not read: {e.Message}");
            var (line, col) = lexer!.LineCol(offset);
            return new NetworkGateResult(null, new[]
            {
                new NetworkTextDiagnostic(e.Code,
                    $"network text has no spelling for {e.Reason}: {e.Detail} The push is refused rather than build the " +
                    "IDE a different body than this one.", line, col, length),
            }, null);
        }
    }

    /// <summary>
    /// Whether two graphical bodies are one text but for LAYOUT: the same marker and the same tokens — whitespace
    /// significant only inside delimited text (a backticked operand, a TITLE, a comment line) and an EXECUTE body. A push in
    /// another layout is adopted as that layout when the IDE gives it back canonically.
    ///
    /// <para><b>Without a scope, on purpose.</b> It answers the CLI after a push — is the IDE's text of a body a re-layout of
    /// the pushed one, or another program? — and the CLI has no declarations to read against. Tokens need none.</para>
    /// </summary>
    public static bool SameTokens(string a, string b)
    {
        if (a is null) throw new ArgumentNullException(nameof(a));
        if (b is null) throw new ArgumentNullException(nameof(b));
        var x = LayoutFree(a);
        var y = LayoutFree(b);
        // A text that does not lex has no tokens to compare past its error, which swallows what follows it.
        if (x is null || y is null || x.Count != y.Count) return false;
        for (var i = 0; i < x.Count; i++)
            if (x[i] != y[i]) return false;
        return true;
    }

    /// <summary>The text's tokens as the gate compares them, or null where it does not lex.</summary>
    private static List<(TokKind, string)>? LayoutFree(string text)
    {
        var start = 0;
        while (start < text.Length && char.IsWhiteSpace(text[start])) start++;
        var eol = text.IndexOf('\n', start);
        if (eol < 0) eol = text.Length;
        var first = text.Substring(start, eol - start).TrimEnd('\r');
        var keys = new List<(TokKind, string)> { (TokKind.Marker, St.PropertyLines.LanguageOf(first) ?? first) };

        var walk = new NetworkLexer.Walk(new NetworkLexer(text, eol));
        for (var t = walk.Next(); t.Kind != TokKind.Eof; t = walk.Next())
        {
            if (t.Kind == TokKind.Error) return null;
            keys.Add(t.Key);
        }
        return keys;
    }
}
