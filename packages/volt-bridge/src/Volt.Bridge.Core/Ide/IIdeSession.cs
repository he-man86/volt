using System;
using System.Collections.Generic;
using Volt.Bridge.Core.Wire;

namespace Volt.Bridge.Core.Ide;

/// <summary>The IDE connection: attach/detach, liveness/degraded state, the STA marshalling hook, and
/// build. No project-content access — that is <see cref="IProjectTree"/> / <see cref="ICodeStore"/>.</summary>
public interface IIdeSession
{
    bool IsConnected { get; }
    string? IdeName { get; }
    string? IdeVersion { get; }
    string Version { get; }
    void Connect();
    void Disconnect();

    // ── degraded state ──
    bool IsDegraded { get; }
    string? DegradedReason { get; }
    void MarkDegraded(string reason);
    void ClearDegraded();
    void TriggerAsyncProbe();
    HealthResponse BuildHealthResponse();
    /// <summary>Should this transport/RPC exception flip the session to degraded? (TwinCAT: dead-COM
    /// HRESULTs; CODESYS in-proc: never.)</summary>
    bool ShouldMarkDegraded(Exception ex);

    // ── threading ──
    /// <summary>Run a unit of IDE work on the vendor's required (STA / primary) thread.</summary>
    T RunOnStaThread<T>(Func<T> fn);

    // ── build ──
    /// <summary>Commit any buffered edits to the IDE's own store (TwinCAT SaveAll; CODESYS no-op,
    /// writes commit immediately). Called before reading versions and after applying a push.</summary>
    void FlushPendingWrites();
    bool Build();
    IReadOnlyList<BridgeDiagnostic> GetBuildDiagnostics();
}
