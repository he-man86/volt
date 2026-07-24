using System.Collections.Generic;
using System.Threading.Tasks;

namespace Volt.Cli.Connector
{
    /// <summary>
    /// A vendor's adapter into the connection model: enumerate the projects it can connect to, bind one, and
    /// report health. This is the ONLY place a vendor's attach mechanism lives — TwinCAT enumerates/binds over
    /// COM/ROT (via its worker), CODESYS over the in-proc <c>ScriptProjects</c> — and it is the boundary the
    /// load-bearing ExternalAttach/InIdeLoad asymmetry is kept behind. Everything above it (the
    /// <see cref="ConnectionManager"/>, the tray, the window, the control plane) is vendor-neutral.
    /// </summary>
    /// <remarks>Placed above the interface it serves.</remarks>
    /// <summary>What happened when we told a bridge to stop serving.</summary>
    public enum UnbindResult
    {
        /// <summary>The bridge accepted it and is now refusing sync. The only real disconnect.</summary>
        Gated,
        /// <summary>The bridge answered but has no `deselect` op — it predates the gate and KEEPS SERVING. The
        /// user must restart that IDE (CODESYS: re-run start_volt_codesys.py) to finish updating.</summary>
        Unsupported,
        /// <summary>Nothing answered: the IDE closed or its host is gone. Already disconnected in every sense
        /// that matters — nothing to fix, nothing to warn about.</summary>
        Unreachable,
    }

    /// <summary>One scan of a source: the projects it can connect to right now, plus whether its bridge was
    /// reachable at all. Reachability is the ONE bit the flat rows can't express — a bridge that is up with no
    /// project open yields zero rows, exactly like a bridge that is down — so it rides alongside the rows instead
    /// of a second `health` round-trip. Everything else (serving, degraded, dirty) is already ON each row.</summary>
    public sealed record SourceScan(IReadOnlyList<DetectedProject> Projects, bool Reachable);

    public interface IProjectSource
    {
        /// <summary>Vendor id: "codesys" | "twincat" — matches <see cref="DetectedProject.Vendor"/> + the pipe name.</summary>
        string Vendor { get; }

        /// <summary>Human platform name for the prefix/logo ("CODESYS" | "TwinCAT").</summary>
        string DisplayName { get; }

        /// <summary>One `health` poll: the projects this source can currently connect to (each row self-describing —
        /// serving/status/dirty) plus whether the bridge was reachable. Empty + unreachable if its bridge isn't up or
        /// nothing is open. Never throws for "not reachable"; that is <c>(empty, Reachable: false)</c>.</summary>
        Task<SourceScan> ScanAsync();

        /// <summary>Bind the given project so its bridge serves it (retarget the worker / rebind the in-proc host).
        /// The project's <see cref="DetectedProject.Attach"/> is this source's own payload.</summary>
        Task BindAsync(DetectedProject project);

        /// <summary>Stop serving the given project — the bridge refuses sync ops until the next
        /// <see cref="BindAsync"/>. Nothing is torn down: the in-proc host / worker stays loaded and re-bindable,
        /// so Disconnect is a gate, not a shutdown. Never throws (an unreachable bridge is already disconnected).
        /// <para>The three outcomes are genuinely different to the user, so they are NOT collapsed into a bool:
        /// an OLD bridge keeps serving `volt push` and needs an IDE restart, while an UNREACHABLE one is simply
        /// gone and there is nothing to warn about. Reporting "out of date, still syncing" for a closed IDE sends
        /// people hunting a problem that doesn't exist.</para></summary>
        Task<UnbindResult> UnbindAsync(DetectedProject project);
    }
}
