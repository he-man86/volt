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
}
