using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Cli.Transport;

namespace Volt.Cli.Sync;

/// <summary>
/// Resolves WHICH bridge the CLI talks to — the data-safety seam for multiple live IDEs. An explicit
/// <c>--pipe</c>/<c>VOLT_PIPE</c> always wins (dev, tests, and the shells set it for <c>volt init</c>). TwinCAT is
/// one supervised worker on one pipe. CODESYS runs an in-proc host PER open IDE, each on its own
/// <c>volt.bridge.codesys.&lt;pid&gt;</c>, so this discovers them and picks the one serving the BOUND project — and
/// on 0 or an ambiguous match it REFUSES loudly rather than guess, so <c>push</c> can never land in the wrong IDE.
/// </summary>
public static class BridgeResolver
{
    public static BridgeClient Resolve(string root, string vendor, string? pipeOverride, bool isInit)
    {
        if (!string.IsNullOrEmpty(pipeOverride)) return new BridgeClient(pipeOverride!);
        if (vendor != "codesys") return BridgeClient.ForVendor(vendor); // TwinCAT: the one worker pipe

        // `init` has no binding yet (bound name is null → the >1 case demands VOLT_PIPE / a single open IDE).
        var bound = isInit ? null : Config.LoadConfig(root).Project.ProjectName;
        var pipe = ChooseCodesysPipe(PipeDiscovery.List(PipeNames.CodesysPrefix), bound, isInit, ProjectNameOf);
        return new BridgeClient(pipe);
    }

    /// <summary>Pure decision: given the live CODESYS pipes + the bound project name + a name-probe, return the one
    /// pipe to use, or throw a loud <see cref="BridgeError"/>. Never guesses on ambiguity.</summary>
    public static string ChooseCodesysPipe(IReadOnlyList<string> pipes, string? boundName, bool isInit, Func<string, string?> nameOf)
    {
        if (pipes.Count == 0)
            throw new BridgeError("PLC_DISCONNECTED",
                "no CODESYS bridge is running — activate Volt in your CODESYS (tray → “Activate in CODESYS…”), then retry.");
        if (pipes.Count == 1) return pipes[0];

        if (isInit)
            throw new BridgeError("AMBIGUOUS_BRIDGE",
                $"{pipes.Count} CODESYS instances are running — set VOLT_PIPE to the one to initialize from, or leave just one open.");

        var matches = pipes.Where(p => nameOf(p) == boundName).ToList();
        if (matches.Count == 1) return matches[0];
        if (matches.Count == 0)
            throw new BridgeError("PLC_DISCONNECTED",
                $"the bound project '{boundName}' isn't open in any of the {pipes.Count} running CODESYS — open it, then retry.");
        throw new BridgeError("AMBIGUOUS_BRIDGE",
            $"{matches.Count} running CODESYS have '{boundName}' open — close all but one, then retry.");
    }

    private static string? ProjectNameOf(string pipe)
    {
        try { return new BridgeClient(pipe).GetHealth().ProjectName; }
        catch { return null; } // that host went away between discovery and probe — it just won't match
    }
}
