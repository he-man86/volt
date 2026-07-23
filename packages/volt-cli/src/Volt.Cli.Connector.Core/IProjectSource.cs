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
        /// <para>Returns FALSE when the bridge did not accept the deselect — which on a mixed install means an
        /// OLD bridge that has no such op and will happily keep serving `volt push`. The UI has to say so: a
        /// Disconnect button that silently does nothing is worse than no button.</para></summary>
        Task<bool> UnbindAsync(DetectedProject project);

        /// <summary>Health of the given project's bridge (the tray colour + status text). <paramref name="selected"/>
        /// is the currently-connected project of this vendor (or null) — a vendor with per-instance bridges
        /// (CODESYS) probes that instance's pipe; a single-bridge vendor (TwinCAT) ignores it.</summary>
        Task<BridgeHealth> ProbeAsync(DetectedProject? selected);
    }
}
