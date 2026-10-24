using System;
using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Ide;

namespace Volt.Engine.Sync;

/// <summary>The precondition every project-touching op checks itself, instead of the client doing a pre-op health
/// round-trip. Because the guard runs INSIDE the op (on the IDE's marshalled thread, via BridgePipeHost's
/// <c>RunOp</c>/<c>RunRead</c> → <c>RunOnStaThread</c>), it is atomic with the op's work — a concurrent <c>select</c> (which also
/// marshals) can't slip between the check and the op, which a separate pre-op health call structurally cannot
/// guarantee. A READ (<c>refs</c>, <c>fetch</c>) whose caller supplies no expected identity (init/discovery) runs the
/// connected check only; a WRITE (<c>push</c>, <c>build</c>) must name its project (<see cref="RequireBinding"/>).</summary>
internal static class OpGuard
{
    /// <summary>The guard of a WRITE op — <c>push</c>, and <c>build</c>, which on TwinCAT saves the served solution's
    /// changed documents (DIALECT D45, D46): both identity members are REQUIRED (openspec
    /// <c>push-requires-project-identity</c>). One missing or empty is <c>BAD_REQUEST</c> naming it, whatever the
    /// bridge's state and before anything is walked, so a write never lands in whatever project the bridge happens to
    /// serve. Then the check every op runs (<see cref="RequireBoundProject"/>).</summary>
    public static (string Vendor, string? ProjectName) RequireBinding(
        HostLink link, string op, string? expectedPlatform, string? expectedName)
    {
        var missing = new System.Collections.Generic.List<string>();
        if (string.IsNullOrEmpty(expectedPlatform)) missing.Add("expectedPlatform");
        if (string.IsNullOrEmpty(expectedName)) missing.Add("expectedProjectName");
        if (missing.Count > 0)
            throw new BridgeException(BridgeErrorCodes.BadRequest,
                $"{op}: {string.Join(" and ", missing)} {(missing.Count == 1 ? "is" : "are")} required — a write names " +
                "the project it writes, and the bridge writes into no project it was not named; nothing was done");
        return RequireBoundProject(link, expectedPlatform, expectedName);
    }

    /// <summary>Throws <c>PLC_DISCONNECTED</c> if no project is attached, or <c>WRONG_PROJECT</c> if the live
    /// bridge is serving a project other than the one the caller is bound to. Returns the LIVE identity it checked,
    /// so a caller can echo it back (a read op does, so the client can double-check before it merges).
    /// <para>Both facts come from the driver's LIVE state (<see cref="Seam.IVendorSession.IsConnected"/> +
    /// <see cref="Seam.IVendorSession.ServedProjectName"/>), which is what the session contract states as THE precondition
    /// and what <c>RefsService</c> already used. It deliberately does NOT read <c>BuildHealthResponse()</c>: that is
    /// served from a per-vendor THROTTLED cache (~5s on TwinCAT), so deciding a write against it refused pushes with
    /// PLC_DISCONNECTED on stale state while reads of the same bridge succeeded — most visibly right after an IDE
    /// close/reopen, where `connect` and `refs` both pass and the first write fails. One question, one answer.</para></summary>
    public static (string Vendor, string? ProjectName) RequireBoundProject(
        HostLink link, string? expectedPlatform, string? expectedName)
    {
        var ide = link.Driver;
        if (!ide.IsConnected) throw BridgeException.PlcDisconnected(ide.NotServedBecause);
        var served = ide.ServedProjectName;

        // EACH SUPPLIED EXPECTATION IS CHECKED ON ITS OWN: `ExpectedPlatform` and `ExpectedProjectName` are independent
        // nullable wire fields, so a platform with no name must still be checked — else a client bound to TwinCAT
        // could push into a CODESYS bridge. A read supplying NEITHER runs only the connected check (init/discovery); a
        // write cannot get here without both (RequireBinding).
        var wrongName = !string.IsNullOrEmpty(expectedName)
                        && !Volt.Engine.Item.ItemPath.SameItem(served, expectedName);
        var wrongVendor = !string.IsNullOrEmpty(expectedPlatform)
                          && !string.Equals(ide.Vendor, expectedPlatform, StringComparison.OrdinalIgnoreCase);
        if (wrongName || wrongVendor)
            throw BridgeException.WrongProject(ide.Vendor, served, expectedPlatform, expectedName);
        return (ide.Vendor, served);
    }
}
