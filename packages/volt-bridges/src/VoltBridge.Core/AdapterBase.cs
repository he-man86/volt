using System;
using System.Collections.Generic;
using VoltBridge.Core.Models;

namespace VoltBridge.Core;

/// <summary>
/// Shared base for every vendor bridge adapter. Owns the parts that are identical
/// across vendors — degraded-state tracking, the health-response shape, and the
/// delegations to the shared <see cref="Hasher"/> and <see cref="ItemKind"/> — so a
/// concrete adapter implements ONLY genuine IDE access (tree walk, text read/write,
/// create/build) plus the one degraded-policy hook. Diffing two concrete adapters
/// then shows only real IDE differences, not boilerplate.
///
/// It deliberately does NOT implement <see cref="IAdapter"/>: a concrete adapter
/// declares the interface and the compiler satisfies it from these inherited public
/// members plus the adapter's own. That keeps the base free of ~25 abstract stubs.
/// </summary>
public abstract class AdapterBase
{
    // ── degraded state (shared plumbing; the policy hook stays vendor-specific) ──
    private volatile bool _isDegraded;
    private string? _degradedReason;

    public bool IsDegraded => _isDegraded;
    public string? DegradedReason => _degradedReason;

    public void MarkDegraded(string reason)
    {
        if (!_isDegraded) Console.Error.WriteLine($"[bridge] DEGRADED: {reason}");
        _isDegraded = true;
        _degradedReason = reason;
    }

    public void ClearDegraded()
    {
        if (_isDegraded) Console.Error.WriteLine("[bridge] DEGRADED cleared");
        _isDegraded = false;
        _degradedReason = null;
    }

    /// <summary>Vendor hook: should this transport/RPC exception flip the adapter to
    /// degraded? (Beckhoff: dead-COM HRESULTs; CODESYS in-proc: never.)</summary>
    public abstract bool ShouldMarkDegraded(Exception ex);

    // ── identity ─────────────────────────────────────────────────────────
    public virtual string Version => "1.0.0";

    // ── shared classification + version hashing (forward to the Core statics) ──
    public string? MapItemType(int typeCode, bool isTopLevelCrud) => ItemKind.Map(typeCode, isTopLevelCrud);

    public string ComputeItemVersion(dynamic item, string folderPath)
    {
        // Erase dynamic so the text reads dispatch as plain virtual calls.
        var node = (object)item;
        return Hasher.ComputeItemVersion(folderPath, ReadDeclaration(node), ReadImplementation(node));
    }

    public string ComputeProjectVersion(Dictionary<string, string> versions) => Hasher.ComputeProjectVersion(versions);
    public string ComputeStructureVersion(Dictionary<string, string> versions) => Hasher.ComputeStructureVersion(versions);

    // Graphical-body read: textual by default; graphical vendors override.
    public virtual GraphicalBody? ReadGraphicalBody(dynamic item) => null;

    // Graphical-body write: unsupported by default; CODESYS overrides (VG → PLCopenXML → import).
    public virtual void WriteGraphicalBody(dynamic item, string vgText, string declaration)
        => throw new NotSupportedException("this adapter cannot write graphical bodies");

    // The two text reads the shared hashing builds on; everything else about IDE
    // access lives on the concrete adapter.
    public abstract string ReadDeclaration(dynamic item);
    public abstract string ReadImplementation(dynamic item);

    // ── health response (uniform shape; the vendor supplies its snapshot values) ──
    protected HealthResponse BuildHealth(string platform, bool connected, bool ideAlive,
        string? ideName, string? ideVersion, string? projectName, string? plcProjectName, bool projectDirty) =>
        new()
        {
            Status = connected ? (_isDegraded ? "degraded" : "healthy") : "unavailable",
            Platform = platform,
            PlatformVariant = null,
            Connected = connected,
            IdeAlive = ideAlive,
            Degraded = _isDegraded,
            DegradedReason = _degradedReason,
            IdeName = ideName,
            IdeVersion = ideVersion,
            Version = Version,
            ProjectName = projectName,
            PlcProjectName = plcProjectName,
            ProjectDirty = projectDirty,
        };
}
