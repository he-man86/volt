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

    // ── library signatures ──
    /// <summary>Extract every referenced-library element's SIGNATURE (declaration only, no body) from the
    /// resolved language model (builds first). CODESYS reflects the compile context; TwinCAT returns none for
    /// now (no equivalent surface yet).</summary>
    IReadOnlyList<Library.LibSignature> ExtractLibrarySignatures();

    /// <summary>Names of the PROJECT POUs (FB/PRG/FUNCTION) CODESYS actually COMPILED. A project POU absent from
    /// this set is DEAD code (uncalled) — no compiler ground truth, like exclude-from-build. Null ⇒ can't
    /// determine (e.g. no compile context / TwinCAT), so the caller marks nothing.</summary>
    ISet<string>? GetCompiledPouNames();
}
