using System.Collections.Generic;
using System.Threading.Tasks;

namespace Volt.Cli.Connector
{
    /// <summary>One scan of a source: the projects it can connect to right now, plus whether its bridge was
    /// reachable at all. Reachability is the ONE bit the flat rows can't express — a bridge that is up with no
    /// project open yields zero rows, exactly like a bridge that is down — so it rides alongside the rows instead
    /// of a second `health` round-trip. Everything else (serving, degraded, dirty) is already ON each row.</summary>
    public sealed record SourceScan(IReadOnlyList<DetectedProject> Projects, bool Reachable);

    /// <summary>
    /// The connection model's SOURCE seam: enumerate the projects that can be connected to, bind one, and report
    /// health. One implementation (<see cref="PerPipeProjectSource"/>) serves BOTH vendors over the discovered
    /// per-pid pipes — a vendor's attach mechanism lives below the <c>IIdeDriver</c> seam, and the load-bearing
    /// ExternalAttach/InIdeLoad asymmetry is now the connector's worker LIFECYCLE (<see cref="TwincatFleet"/>), not
    /// this interface. Everything above it (the <see cref="ConnectionManager"/>, the tray, the window, the control
    /// plane) is vendor-neutral.
    /// </summary>
    public interface IProjectSource
    {
        /// <summary>Vendor id: "codesys" | "twincat" — matches <see cref="DetectedProject.Vendor"/> + the pipe name.</summary>
        string Vendor { get; }

        /// <summary>Human platform name for the prefix/logo ("CODESYS" | "TwinCAT").</summary>
        string DisplayName { get; }

        /// <summary>One `health` poll: the projects this source can currently connect to (each row self-describing —
        /// serving/status/dirty) plus whether the bridge was reachable. <c>Reachable</c> = this source found at least
        /// one live bridge ENDPOINT; an endpoint that is discovered but then fails to answer is still
        /// <c>Reachable: true</c> with zero rows. <c>(empty, Reachable: false)</c> means there was nothing to talk to
        /// at all. Never throws for "not reachable".</summary>
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
