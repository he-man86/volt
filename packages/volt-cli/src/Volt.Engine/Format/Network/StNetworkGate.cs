using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;

namespace Volt.Engine.Format.Network;

/// <summary>One finding against a network-text body: a <c>NETWORK_*</c> code (<see cref="ConflictCodes"/>), a
/// message that names what was found, and the 1-based span it was found at.</summary>
public sealed record NetworkTextDiagnostic(string Code, string Message, int Line, int Column, int Length);

/// <summary>What <see cref="StNetworkGate.Validate"/> returns: the model when the body may be pushed, every diagnostic
/// otherwise, and the canonical form — the text the next pull shows — whenever the body read and the writer could spell
/// it.</summary>
public sealed record NetworkGateResult(NetworkBody? Body, IReadOnlyList<NetworkTextDiagnostic> Diagnostics, string? Canonical)
{
    public bool Ok => Body is not null && Diagnostics.Count == 0;
}

/// <summary>
/// THE PUSH'S GATE FOR PLAIN-ST NETWORK TEXT (openspec <c>network-text-st</c> 3.1): READ the body
/// (<see cref="StNetworkReader"/>, which refuses by name what a network may not hold), derive what the push builds from the
/// declarations (<see cref="NetworkDerivation"/>), and WRITE the model (<see cref="StNetworkWriter"/>): its text is the
/// canonical form the next pull shows. A model the writer cannot spell is refused (NETWORK_UNSUPPORTED) rather than build
/// the IDE a body the next pull could not show; that the canonical text reads back to the same model is the round-trip
/// oracle's to prove, not a runtime step.
/// </summary>
public static class StNetworkGate
{
    public static NetworkGateResult Validate(string text, NetworkScope scope)
    {
        if (text is null) throw new ArgumentNullException(nameof(text));
        if (scope is null) throw new ArgumentNullException(nameof(scope));
        NetworkBody read;
        try { read = StNetworkReader.Read(text, scope); }
        catch (StNetworkReadException e)
        {
            return new NetworkGateResult(null, new[] { new NetworkTextDiagnostic(ConflictCodes.NetworkParse, e.Message, e.Line, 1, 0) }, null);
        }
        var body = NetworkDerivation.Derive(read, scope);
        try { return new NetworkGateResult(body, Array.Empty<NetworkTextDiagnostic>(), StNetworkWriter.Write(body, scope)); }
        catch (StNetworkUnspellableException e)
        {
            return new NetworkGateResult(null, new[]
            {
                new NetworkTextDiagnostic(ConflictCodes.NetworkUnsupported,
                    $"{e.Message} The push is refused rather than build the IDE a body the next pull cannot show.", NetworkLine(text, e), 1, 0),
            }, null);
        }
    }

    /// <summary>The line of the network the writer refused: the n-th <c>%NETWORK</c> line, n read off the refusal's network
    /// order where it carries one, else the body's first network.</summary>
    private static int NetworkLine(string text, StNetworkUnspellableException e)
    {
        var lines = text.Replace("\r\n", "\n").Split('\n');
        var headers = lines.Select((l, i) => (l, i)).Where(x => x.l == StNetworkWriter.NetworkLine || x.l.StartsWith(StNetworkWriter.NetworkLine + " ", StringComparison.Ordinal))
            .Select(x => x.i + 1).ToList();
        var at = e.Network is { } n && n < headers.Count ? headers[n] : headers.FirstOrDefault();
        return at == 0 ? 1 : at;
    }

    /// <summary>Whether two plain-ST network bodies are one model in <paramref name="scope"/>: the same canonical text, or
    /// the pushed one with the positional FUNCTION pins the IDE names (<see cref="NetworkDerivation.NamedAs"/>). A text that
    /// does not read in that scope is not claimed to be the same.</summary>
    public static bool SameBody(string pushed, string held, NetworkScope scope)
    {
        var cx = Validate(pushed, scope);
        var cy = Validate(held, scope);
        if (cx.Canonical is not { } canonicalX || cy.Canonical is not { } canonicalY) return false;
        if (canonicalX == canonicalY) return true;
        var named = NetworkDerivation.NamedAs(cx.Body!, cy.Body!);
        return !ReferenceEquals(named, cx.Body) && StNetworkWriter.Write(named, scope) == canonicalY;
    }
}
