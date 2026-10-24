using System;
using System.Collections.Generic;
using System.IO;
using Volt.Wire;
using Volt.Contracts;

namespace Volt.Connector
{
    /// <summary>Wires the connector's two halves in one place: the pipe-backed project SOURCES (the connection
    /// model the tray/window/control-plane view) and the worker exe (spawned per-XAE by the supervisor). Adding a
    /// vendor is a source here + — for an ExternalAttach vendor — its worker exe; nothing else.</summary>
    public static class ConnectorSetup
    {
        /// <summary>One <see cref="PerPipeProjectSource"/> per vendor — BOTH now discover a pipe per running IDE
        /// (<c>volt.bridge.&lt;vendor&gt;.&lt;pid&gt;</c>) and fan out. They speak the same health/connect/disconnect
        /// wire, so the connector never branches on vendor — the vendor difference is entirely behind the pipe.</summary>
        public static IReadOnlyList<IProjectSource> Sources() => new IProjectSource[]
        {
            // CODESYS: one in-proc host per running IDE. TwinCAT: one per-XAE worker the supervisor spawns per XAE
            // window (see TrayContext.ReconcileTwincatWorkers) — from here, identical per-pipe discovery + fan-out.
            new PerPipeProjectSource(ConnectorVendors.Twincat, PipeNames.PrefixForVendor(ConnectorVendors.Twincat)),
            new PerPipeProjectSource(ConnectorVendors.Codesys, PipeNames.PrefixForVendor(ConnectorVendors.Codesys)),
        };

        private const string TwincatWorkerExe = "VoltBridgeTwincat.exe";

        /// <summary>The TwinCAT worker builds the supervisor spawns one of per XAE window (<c>--xae-pid &lt;pid&gt;</c>), the
        /// one of that XAE's bitness (<see cref="TwincatWorkers"/>). Shipped: the x64 build on the connector's runtime
        /// beside it, the x86 build single-file in <c>x86\</c>. Dev: each build's own output (<c>ide.ps1</c> builds them
        /// with <c>-r win-x86</c> / <c>-r win-x64</c>). A build that can't be found is null.</summary>
        public static TwincatWorkers TwincatWorkers() => new(
            X86: ResolveWorker("VOLT_TWINCAT_BRIDGE_X86", Path.Combine("x86", TwincatWorkerExe), "Volt.Ide.Twincat",
                Path.Combine("win-x86", TwincatWorkerExe)),
            X64: ResolveWorker("VOLT_TWINCAT_BRIDGE_X64", TwincatWorkerExe, "Volt.Ide.Twincat",
                Path.Combine("win-x64", TwincatWorkerExe)));

        /// <summary>Resolve a worker exe: env override → next to the connector (shipped) → the dev build output.
        ///
        /// <para><paramref name="projectDir"/> is relative to <c>src/</c>, which is where four levels up from the
        /// connector's own bin lands. It used to read <c>../volt-cli/src/Volt.Ide.Twincat</c> — left over from
        /// when the connector was its OWN package — and so resolved to <c>volt-cli/volt-cli/src/…</c>, a path
        /// that cannot exist. The consequence was invisible rather than loud: <see cref="TwincatXaeProbe"/>
        /// returns null for a missing exe, null means "the probe FAILED" (not "no XAE"), and a failed probe
        /// deliberately leaves the fleet untouched — so a dev build detected no TwinCAT at all, reported an
        /// empty project list, and logged nothing.</para></summary>
        private static string? ResolveWorker(string envVar, string shipped, string projectDir, string built)
        {
            var baseDir = AppContext.BaseDirectory;
            foreach (var c in new[]
            {
                Environment.GetEnvironmentVariable(envVar),
                Path.Combine(baseDir, shipped),
                Path.Combine(baseDir, "..", "..", "..", "..", projectDir, "bin", "Release", "net10.0-windows", built),
                Path.Combine(baseDir, "..", "..", "..", "..", projectDir, "bin", "Debug", "net10.0-windows", built),
            })
            {
                if (string.IsNullOrEmpty(c)) continue;
                var full = Path.GetFullPath(c);
                if (File.Exists(full)) return full;
            }
            return null;
        }
    }
}
