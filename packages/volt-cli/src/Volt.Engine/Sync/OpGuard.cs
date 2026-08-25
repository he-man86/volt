using System;
using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Ide;

namespace Volt.Engine.Sync;

/// <summary>The precondition every project-touching op checks itself, instead of the client doing a pre-op health
/// round-trip. Because the guard runs INSIDE the op (on the IDE's marshalled thread, via BridgePipeHost's
/// <c>RunOp</c>/<c>RunRead</c> → <c>RunOnStaThread</c>), it is atomic with the op's work — a concurrent <c>select</c> (which also
/// marshals) can't slip between the check and the op, which a separate pre-op health call structurally cannot
/// guarantee. When the caller supplies no expected identity (init/discovery, or an older client) only the
/// connected check runs.</summary>
internal static class OpGuard
{
    /// <summary>Throws <c>PLC_DISCONNECTED</c> if no project is attached, or <c>WRONG_PROJECT</c> if the live
    /// bridge is serving a project other than the one the caller is bound to. Returns the LIVE identity it checked,
    /// so a caller can echo it back (a read op does, so the client can double-check before it merges).
    /// <para>Both facts come from the driver's LIVE state (<see cref="IIdeSession.IsConnected"/> +
    /// <see cref="IIdeSession.ServedProjectName"/>), which is what <c>IIdeSession</c> documents as THE precondition
    /// and what <c>RefsService</c> already used. It deliberately does NOT read <c>BuildHealthResponse()</c>: that is
    /// served from a per-vendor THROTTLED cache (~5s on TwinCAT), so deciding a write against it refused pushes with
    /// PLC_DISCONNECTED on stale state while reads of the same bridge succeeded — most visibly right after an IDE
    /// close/reopen, where `connect` and `refs` both pass and the first write fails. One question, one answer.</para></summary>
    public static (string Vendor, string? ProjectName) RequireBoundProject(
        IIdeDriver ide, string? expectedPlatform, string? expectedName)
    {
        if (!ide.IsConnected) throw BridgeException.PlcDisconnected();
        var served = ide.ServedProjectName;
        if (!string.IsNullOrEmpty(expectedName) &&
            (!string.Equals(served, expectedName, StringComparison.Ordinal) ||
             !string.Equals(ide.Vendor, expectedPlatform, StringComparison.OrdinalIgnoreCase)))
            throw BridgeException.WrongProject(ide.Vendor, served, expectedPlatform, expectedName);
        return (ide.Vendor, served);
    }
}
