using System;
using Volt.Engine.Ide;
using Volt.Engine.Wire;

namespace Volt.Engine.Sync;

/// <summary>The precondition every project-touching op checks itself, instead of the client doing a pre-op health
/// round-trip. Because the guard runs INSIDE the op (on the IDE's marshalled thread, via BridgePipeHost's
/// <c>Busy</c>/<c>RunOnStaThread</c>), it is atomic with the op's work — a concurrent <c>select</c> (which also
/// marshals) can't slip between the check and the op, which a separate pre-op health call structurally cannot
/// guarantee. When the caller supplies no expected identity (init/discovery, or an older client) only the
/// connected check runs.</summary>
public static class OpGuard
{
    /// <summary>Throws <c>PLC_DISCONNECTED</c> if no project is attached, or <c>WRONG_PROJECT</c> if the live
    /// bridge is serving a project other than the one the caller is bound to. Returns the health it read so the
    /// caller can echo the identity back (a read op does, so the client can double-check before it merges).</summary>
    public static HealthResponse RequireBoundProject(IIdeDriver ide, string? expectedPlatform, string? expectedName)
    {
        var h = ide.BuildHealthResponse();
        if (!h.Connected) throw BridgeException.PlcDisconnected();
        if (!string.IsNullOrEmpty(expectedName) &&
            (!string.Equals(h.ProjectName, expectedName, StringComparison.Ordinal) ||
             !string.Equals(h.Platform, expectedPlatform, StringComparison.OrdinalIgnoreCase)))
            throw BridgeException.WrongProject(h.Platform, h.ProjectName, expectedPlatform, expectedName);
        return h;
    }
}
