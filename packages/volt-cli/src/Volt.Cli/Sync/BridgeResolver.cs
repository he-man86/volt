using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Wire;
using Volt.Contracts;

namespace Volt.Cli.Sync;

/// <summary>
/// Resolves WHICH bridge the CLI talks to — the data-safety seam for multiple live IDEs. An explicit
/// <c>--pipe</c>/<c>VOLT_PIPE</c> always wins (dev, tests, and the shells set it for <c>volt init</c>). BOTH vendors
/// run one host per open IDE, each on its own <c>volt.bridge.&lt;vendor&gt;.&lt;pid&gt;</c> pipe (CODESYS in-proc,
/// TwinCAT a per-XAE worker), so this discovers them by the vendor prefix. With exactly ONE live pipe that pipe is
/// used UNPROBED (it saves a health round-trip, and the bridge's own WRONG_PROJECT guard — not this resolver — is what
/// refuses a project mismatch there); the BOUND project name only arbitrates between two or more, and on 0 or an
/// ambiguous match it REFUSES loudly rather than guess, so <c>push</c> can never land in the wrong IDE. There is NO
/// per-vendor branch here (that was the pre-per-XAE special case) — both go through the same discovery, so a new
/// vendor is a prefix, nothing else.
/// </summary>
public static class BridgeResolver
{
    /// <summary>CLI-LOCAL refusal code (never travels the wire, unlike <see cref="BridgeErrorCodes"/>) — pinned here
    /// so the two throw-sites and the tests asserting on it share one spelling.</summary>
    public const string AmbiguousBridge = "AMBIGUOUS_BRIDGE";

    public static BridgeClient Resolve(string root, string vendor, string? pipeOverride, bool isInit)
    {
        if (!string.IsNullOrEmpty(pipeOverride)) return new BridgeClient(pipeOverride!);

        // `init` has no binding yet (bound name is null → the >1 case demands VOLT_PIPE / a single open IDE).
        var bound = isInit ? null : Config.LoadConfig(root).Project.ProjectName;
        var pipes = PipeDiscovery.List(PipeNames.PrefixForVendor(vendor));
        var pipe = ChooseBridgePipe(pipes, bound, isInit, ProjectNamesOf, DisplayOf(vendor));
        return new BridgeClient(pipe);
    }

    /// <summary>Pure decision: given the live pipes for a vendor + the bound project name + a per-pipe project-list
    /// probe, return the one pipe to use, or throw a loud <see cref="BridgeError"/>. Never guesses on ambiguity.
    /// <para>Matches against the pipe's FULL project list (not just its serving project): a per-XAE TwinCAT worker is
    /// NOT connected until the UI selects a project (so it has no serving project yet), and a single XAE window can
    /// hold several projects — so "does this IDE HAVE the bound project open" is the right question, not "is it
    /// currently serving it". For CODESYS (one project per pipe, always serving) this is the same decision as before.</para></summary>
    public static string ChooseBridgePipe(IReadOnlyList<string> pipes, string? boundName, bool isInit,
        Func<string, IReadOnlyList<string>> projectsOf, string vendorLabel)
    {
        if (pipes.Count == 0)
            throw new BridgeError(BridgeErrorCodes.PlcDisconnected,
                $"no {vendorLabel} bridge is running — open the project in {vendorLabel} (for CODESYS: tray → “Activate in CODESYS…”), then retry.");
        if (pipes.Count == 1) return pipes[0];

        if (isInit)
            throw new BridgeError(AmbiguousBridge,
                $"{pipes.Count} {vendorLabel} instances are running — set VOLT_PIPE to the one to initialize from, or leave just one open.");

        var matches = pipes.Where(p => projectsOf(p).Contains(boundName)).ToList();
        if (matches.Count == 1) return matches[0];
        if (matches.Count == 0)
            throw new BridgeError(BridgeErrorCodes.PlcDisconnected,
                $"the bound project '{boundName}' isn't open in any of the {pipes.Count} running {vendorLabel} — open it, then retry.");
        throw new BridgeError(AmbiguousBridge,
            $"{matches.Count} running {vendorLabel} have '{boundName}' open — close all but one, then retry.");
    }

    // The names of every project the pipe's IDE has open (any status) — a per-XAE TwinCAT window can list several.
    private static IReadOnlyList<string> ProjectNamesOf(string pipe)
    {
        try { return new BridgeClient(pipe).GetHealth().Projects.Select(p => p.Project).ToList(); }
        catch { return Array.Empty<string>(); } // that host went away between discovery and probe — it just won't match
    }

    private static string DisplayOf(string vendor) =>
        string.Equals(vendor, Vendors.Twincat, StringComparison.OrdinalIgnoreCase) ? Vendors.TwincatDisplay : Vendors.CodesysDisplay;
}
