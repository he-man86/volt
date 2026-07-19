using System;
using System.Collections.Generic;
using Volt.Engine.Wire;

namespace Volt.Engine.Ide;

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

    // ── project discovery + selection (the connector's `instances` / `select` ops) ──
    /// <summary>Every IDE instance the bridge can currently see + the projects each has open — what the
    /// connector shows in its one unified project selector. TwinCAT enumerates running XAE instances over
    /// COM/ROT; CODESYS reports its in-proc primary project. Empty when nothing is reachable.</summary>
    InstancesResult EnumerateInstances();

    /// <summary>Bind the given instance/project/sub-project so this bridge serves it — the connector's `select`.
    /// TwinCAT re-resolves the chosen project on the live DTE (no worker respawn); CODESYS confirms/rebinds its
    /// active project. Throws if the requested project isn't currently open.</summary>
    void SelectProject(SelectRequest sel);

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

    /// <summary>DEBUG (read-only): each library signature's implemented interfaces + all property values, filtered
    /// by element name — introspects how the language model represents a DUT (alias/struct/enum/union). Empty on
    /// drivers without a signature model (TwinCAT). Surfaced at <c>GET /debug?libsig=NAME</c>.</summary>
    IReadOnlyList<IReadOnlyDictionary<string, string>> DebugLibrarySignatures(string? nameFilter);

    /// <summary>DEBUG (read-only): the PLCopen export (our normal code-XML transport) for the item named
    /// <paramref name="name"/>, or "" if unavailable. Surfaced at <c>GET /debug?xmlof=NAME</c>.</summary>
    string DebugItemXml(string name);

    /// <summary>DEBUG (read-only): reflect the change-detection surface of a target object model member (e.g.
    /// "project", "objmgr") — its type, interfaces, and change/version/event-named members — to investigate what
    /// signal the IDE exposes. Empty when unsupported. Surfaced at <c>GET /debug?reflect=TARGET</c>.</summary>
    string DebugReflect(string target);
}
