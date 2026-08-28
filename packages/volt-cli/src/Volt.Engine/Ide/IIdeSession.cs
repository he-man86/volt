using System;
using System.Collections.Generic;
using Volt.Contracts;
using Volt.Engine.Library;
using Volt.Engine.Format.Body;

namespace Volt.Engine.Ide;

/// <summary>The IDE connection: attach/detach, liveness/degraded state, the STA marshalling hook, and
/// build. No project-content access — that is <see cref="IProjectTree"/> / <see cref="ICodeStore"/>.
/// <para>This is the vendor SEAM: it exposes PRIMITIVES (attach, state reads, marshalling), never wire POLICY. A
/// method here must not decide a wire-visible outcome — those are enforced ONCE in <c>Wire/BridgePipeHost</c> so
/// both vendors behave identically (e.g. the select post-condition and the not-connected precondition are checked
/// there against <see cref="IsConnected"/>, not in each driver). See ARCHITECTURE.md, "the parity boundary."</para></summary>
public interface IIdeSession
{
    bool IsConnected { get; }

    /// <summary>This bridge's vendor (a <see cref="Volt.Wire.Vendors"/> value). Constant for the driver's
    /// lifetime — a bridge never changes vendor — so it is always safe to read live.</summary>
    string Vendor { get; }

    /// <summary>The project this bridge is serving RIGHT NOW, or null when nothing is attached. A LIVE state read,
    /// the companion to <see cref="IsConnected"/> — deliberately NOT read off the cached health snapshot, which is
    /// throttled per vendor and can lag a reconnect. Together these two are the ONLY source for the not-connected +
    /// right-project precondition (<c>Sync/OpGuard</c>), so a read and a write can never disagree about the bridge.
    /// <para>Called from inside an op, on the marshalled IDE thread, so an implementation MAY touch its object model
    /// (CODESYS reads the primary project's path); it must not marshal again and must not throw.</para></summary>
    string? ServedProjectName { get; }
    /// <summary>The IDE version, shown per-instance in the connector's project label. Not a wire top-level field.</summary>
    string? IdeVersion { get; }
    // NB: there is deliberately NO Connect() here. The startup attach is vendor-shaped (CODESYS: an in-proc snapshot
    // on its primary thread; TwinCAT: attach to a specific XAE by pid, `Connect(int)`), so each driver exposes its own
    // and its own host calls it. Core never connects — `Ops.Connect` maps to SelectProject; nothing here is Core's.
    void Disconnect();

    // ── degraded state ──
    bool IsDegraded { get; }
    void MarkDegraded(string reason);
    void ClearDegraded();
    /// <summary>The ambient poll response: the flat <see cref="HealthResponse.Projects"/> array (liveness + the
    /// connectable-projects list, per row) from the CACHED snapshot — NEVER a live walk on the request.
    /// <para>The one member here that looks like wire POLICY and is not: it is composed ONCE, in
    /// <c>DriverBase</c> (cache read + probe throttle + the live served-row overlay). A vendor supplies only the row
    /// snapshot and cannot return a <see cref="HealthResponse"/> at all, so the seam rule above holds.</para></summary>
    HealthResponse BuildHealthResponse();
    /// <summary>Should this transport/RPC exception flip the session to degraded? (TwinCAT: dead-COM
    /// HRESULTs; CODESYS in-proc: never.)</summary>
    bool ShouldMarkDegraded(Exception ex);
    /// <summary>SYNCHRONOUSLY re-establish the live binding after a transient failure — the op-level retry calls this
    /// (on the marshalled thread) before retrying a read that hit a dead channel. TwinCAT re-acquires a fresh DTE for
    /// the DESIRED project by its stable name; CODESYS is in-proc (no cross-process channel to drop), so it is a
    /// no-op. Must not throw.</summary>
    void Recover();

    // ── threading ──
    /// <summary>Run a unit of IDE work on the vendor's required (STA / primary) thread.</summary>
    T RunOnStaThread<T>(Func<T> fn);

    // ── project selection (the connector's `connect` op; discovery rides on `health`.Projects) ──
    /// <summary>Bind the given instance/project/sub-project so this bridge serves it — the connector's `select`.
    /// TwinCAT re-resolves the chosen project on the live DTE (no worker respawn); CODESYS confirms/rebinds its
    /// active project. A PRIMITIVE: it attaches what it can and leaves the model connected-or-not
    /// (<see cref="IsConnected"/>); it does NOT decide the wire outcome. The Core `select` handler enforces the
    /// post-condition uniformly — a select that leaves the bridge not-connected is refused there with the shared
    /// PLC_DISCONNECTED, identically on both vendors. Must not throw a vendor-specific exception for that case.</summary>
    void SelectProject(ConnectRequest sel);

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
}
