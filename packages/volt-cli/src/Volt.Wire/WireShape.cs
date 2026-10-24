using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;

namespace Volt.Wire;

/// <summary>
/// THE CLIENT CHECKS THE BRIDGE'S SHAPE (wire-final-shape 4.3c). The protocol number stays 1, and a bridge of the
/// previous release reads this client's envelope leniently and serves it — so the bridge's own <c>PROTOCOL_MISMATCH</c>
/// cannot refuse that pair. Its <c>health</c> can: every bridge of this wire states <c>languages</c> and <c>kinds</c>, and
/// one whose <c>health</c> lacks either predates it. Every client of this wire (the CLI's <c>BridgeClient</c>, the
/// connector's scan) reads <c>health</c> first and calls <see cref="Require"/> before any other op.
///
/// <para>It reads the RAW answer, not the DTO: <c>HealthResponse</c>'s list defaults would turn an absent member into an
/// empty one. An empty list is a fact and passes; an absent member (or <c>null</c>) is the older bridge.</para>
/// </summary>
public static class WireShape
{
    /// <summary>Client-local (like <see cref="PipeAccessDeniedException.Code"/>): the bridge never sends it.</summary>
    public const string PredatesWireCode = "BRIDGE_PREDATES_WIRE";

    /// <summary>The <c>health</c> members every bridge of this wire states.</summary>
    private static readonly string[] Required = { "languages", "kinds" };

    /// <summary>Refuses <paramref name="health"/> (the raw <c>health</c> result from <paramref name="pipe"/>) when it
    /// lacks a member this wire requires.</summary>
    /// <exception cref="BridgePredatesWireException">naming the pipe, what is missing and the bridge's version.</exception>
    public static void Require(JsonElement health, string pipe)
    {
        var missing = health.ValueKind == JsonValueKind.Object
            ? Required.Where(m => !health.TryGetProperty(m, out var v) || v.ValueKind != JsonValueKind.Array).ToList()
            : Required.ToList();
        if (missing.Count == 0) return;
        string? version = health.ValueKind == JsonValueKind.Object
                          && health.TryGetProperty("bridgeVersion", out var bv) && bv.ValueKind == JsonValueKind.String
            ? bv.GetString() : null;
        throw new BridgePredatesWireException(pipe, version, missing);
    }
}

/// <summary>A bridge whose <c>health</c> lacks a member of this wire (<see cref="WireShape.Require"/>): refused by name,
/// before any other op, so nothing is read from it and nothing is misread.</summary>
public sealed class BridgePredatesWireException : Exception
{
    public string PipeName { get; }

    public BridgePredatesWireException(string pipeName, string? bridgeVersion, IReadOnlyList<string> missing)
        : base($"this bridge predates this wire: update it. The IDE bridge on pipe '{pipeName}'"
               + (bridgeVersion is null ? "" : $" (bridge {bridgeVersion})")
               + $" states no {string.Join(", ", missing.Select(m => "`" + m + "`"))} in its health. Install this Volt "
               + "release and restart the IDE so it loads the updated bridge. Nothing was done.") =>
        PipeName = pipeName;
}
