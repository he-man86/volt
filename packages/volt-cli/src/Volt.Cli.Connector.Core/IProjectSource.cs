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

        /// <summary>Stop serving the given project (the reconciler's unbind) — the bridge refuses sync ops until the
        /// next <see cref="BindAsync"/>. Nothing is torn down: the in-proc host / worker stays loaded and re-bindable,
        /// so it is a gate, not a shutdown. Best-effort: the reconciler ignores the outcome and re-derives from the
        /// bridge's actual serving state next cycle, so any failure (unreachable) just self-corrects.</summary>
        Task UnbindAsync(DetectedProject project);
    }
}
