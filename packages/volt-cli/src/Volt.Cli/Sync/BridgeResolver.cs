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
        // No TwinCAT pipe while an XAE runs: before "start the connector", ask whether that XAE is one an unelevated
        // worker cannot see (environment-dependency-audit 2.2). Only then: a healthy machine pays no token read.
        var shells = ClientVendors.ReachOf(vendor).ShellProcesses;
        if (pipes.Count == 0 && shells.Count > 0
            && UnreachableXae(ProcessElevation.Of(shells.ToArray()), ProcessElevation.Self()) is { } why)
            throw new BridgeError(BridgeErrorCodes.PlcDisconnected, why);
        var pipe = ChooseBridgePipe(pipes, bound, isInit, ProjectNamesOf, vendor);
        return new BridgeClient(pipe);
    }

    /// <summary>Pure decision: given the live pipes for a vendor + the bound project name + a per-pipe project-list
    /// probe, return the one pipe to use, or throw a loud <see cref="BridgeError"/>. Never guesses on ambiguity.
    /// <para>Matches against the pipe's FULL project list (not just its serving project): a per-XAE TwinCAT worker is
    /// NOT connected until the UI selects a project (so it has no serving project yet), and a single XAE window can
    /// hold several projects — so "does this IDE HAVE the bound project open" is the right question, not "is it
    /// currently serving it". For CODESYS (one project per pipe, always serving) this is the same decision as before.</para></summary>
    public static string ChooseBridgePipe(IReadOnlyList<string> pipes, string? boundName, bool isInit,
        Func<string, IReadOnlyList<string>> projectsOf, string vendor)
    {
        var vendorLabel = ClientVendors.Display(vendor);
        // THE REMEDY IS PER-VENDOR, because the two are not the same product (ClientVendors): a TwinCAT user told to
        // "open the project" was told to do the thing they had already done.
        if (pipes.Count == 0)
            throw new BridgeError(BridgeErrorCodes.PlcDisconnected,
                $"no {vendorLabel} bridge is running — {ClientVendors.ReachOf(vendor).NoBridgeRemedy}");
        if (pipes.Count == 1) return pipes[0];

        if (isInit)
            throw new BridgeError(AmbiguousBridge,
                $"{pipes.Count} {vendorLabel} instances are running — set VOLT_PIPE to the one to initialize from, or leave just one open.");

        // A pipe that REFUSES this process (another user's IDE, an elevated one on an older bridge) must not stop the
        // resolve while another pipe has the bound project open; it is named only when no pipe matches — its IDE may be
        // the one holding the project, so "isn't open in any" would be the wrong answer (gate 2b).
        var refusals = new List<BridgeError>();
        var matches = pipes.Where(p =>
        {
            try { return projectsOf(p).Contains(boundName); }
            catch (BridgeError e) when (e.Code == BridgeError.AccessDeniedCode) { refusals.Add(e); return false; }
        }).ToList();
        if (matches.Count == 1) return matches[0];
        if (matches.Count == 0 && refusals.Count > 0)
            throw new BridgeError(BridgeError.AccessDeniedCode,
                $"the bound project '{boundName}' isn't open in any {vendorLabel} this process can reach, and "
                + $"{refusals.Count} of the {pipes.Count} running refused it: " + string.Join(" ", refusals.Select(r => r.Message)));
        if (matches.Count == 0)
            throw new BridgeError(BridgeErrorCodes.PlcDisconnected,
                $"the bound project '{boundName}' isn't open in any of the {pipes.Count} running {vendorLabel} — open it, then retry.");
        throw new BridgeError(AmbiguousBridge,
            $"{matches.Count} running {vendorLabel} have '{boundName}' open — close all but one, then retry.");
    }

    /// <summary>Why no TwinCAT bridge serves an XAE that IS running, when the reason is elevation — or null when it is not.
    /// The TwinCAT worker reaches XAE through the COM Running Object Table, and Windows does not show an elevated
    /// process's ROT entries to an unelevated one (<c>RotInstances</c>): an XAE run "as administrator" while the connector
    /// is not gets no worker, and "start the Volt Connector" would be wrong advice. A shell whose token this process cannot
    /// read runs as another user (measured: an elevated SAME-user token IS readable) — named too, not guessed elevated.
    /// An elevated CLI says nothing here: its own worker question is the connector's, not elevation's.</summary>
    public static string? UnreachableXae(IReadOnlyList<(int Pid, bool? Elevated)> shells, bool selfElevated)
    {
        if (selfElevated) return null;
        var elevated = shells.Where(s => s.Elevated == true).Select(s => s.Pid).ToList();
        var foreign = shells.Where(s => s.Elevated is null).Select(s => s.Pid).ToList();
        if (elevated.Count == 0 && foreign.Count == 0) return null;
        // This user's own unelevated XAE beside them has no worker for the ordinary reason — its remedy stays (gate 2b).
        var own = shells.Where(s => s.Elevated == false).Select(s => s.Pid).ToList();
        var parts = new List<string>();
        if (elevated.Count > 0)
            parts.Add($"TwinCAT XAE (pid {string.Join(", ", elevated)}) runs elevated (\"as administrator\") and Volt does not — "
                + "Windows hides an elevated XAE from an unelevated process, so no TwinCAT worker can attach. Start XAE "
                + "without \"Run as administrator\", or run the Volt Connector (and volt) elevated too, then retry.");
        if (foreign.Count > 0)
            parts.Add($"TwinCAT XAE (pid {string.Join(", ", foreign)}) runs as another Windows user — Volt reaches only the "
                + "XAE of the user it runs as.");
        if (own.Count > 0)
            parts.Add($"TwinCAT XAE (pid {string.Join(", ", own)}) runs as you, unelevated, and has no worker either — "
                + "start the Volt Connector (it runs the TwinCAT worker), then retry.");
        return string.Join(" ", parts);
    }

    // The names of every project the pipe's IDE has open (any status) — a per-XAE TwinCAT window can list several.
    private static IReadOnlyList<string> ProjectNamesOf(string pipe)
    {
        try { return new BridgeClient(pipe).GetHealth().Projects.Select(p => p.Project).ToList(); }
        // A pipe that REFUSES this process is not one that went away: its IDE may well hold the bound project, and "isn't
        // open in any" would send the engineer to open what is open. It propagates, named, to ChooseBridgePipe, which
        // names it only when no other pipe matches (environment-dependency-audit 2.2, gate 2b).
        catch (BridgeError e) when (e.Code == BridgeError.AccessDeniedCode) { throw; }
        catch { return Array.Empty<string>(); } // that host went away between discovery and probe — it just won't match
    }
}
