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

    public interface IProjectSource
    {
        /// <summary>Vendor id: "codesys" | "twincat" — matches <see cref="DetectedProject.Vendor"/> + the pipe name.</summary>
        string Vendor { get; }

        /// <summary>Human platform name for the prefix/logo ("CODESYS" | "TwinCAT").</summary>
        string DisplayName { get; }

        /// <summary>The projects this source can currently connect to — empty if its bridge isn't reachable or
        /// nothing is open. Never throws for "not reachable"; that is an empty list.</summary>
        Task<IReadOnlyList<DetectedProject>> EnumerateAsync();

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

        /// <summary>Health of the given project's bridge (the tray colour + status text). <paramref name="selected"/>
        /// is the currently-connected project of this vendor (or null) — a vendor with per-instance bridges
        /// (CODESYS) probes that instance's pipe; a single-bridge vendor (TwinCAT) ignores it.</summary>
        Task<BridgeHealth> ProbeAsync(DetectedProject? selected);
    }
}
