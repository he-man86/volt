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
            new PerPipeProjectSource(Vendors.Twincat, Vendors.TwincatDisplay, PipeNames.TwincatPrefix),
            new PerPipeProjectSource(Vendors.Codesys, Vendors.CodesysDisplay, PipeNames.CodesysPrefix),
        };

        /// <summary>The TwinCAT worker exe the supervisor spawns one of per XAE window (<c>--xae-pid &lt;pid&gt;</c>),
        /// and probes for live XAE pids (<c>--list-xae-pids</c>). Null when it can't be found (dev without a build).</summary>
        public static string? TwincatExe() =>
            ResolveWorker("VOLT_TWINCAT_BRIDGE", "VoltBridgeTwincat.exe",
                Path.Combine("..", "volt-cli", "src", "Volt.Ide.Twincat"));

        /// <summary>Resolve a worker exe: env override → next to the connector (shipped) → the dev build output.</summary>
        private static string? ResolveWorker(string envVar, string exeName, string projectDir)
        {
            var baseDir = AppContext.BaseDirectory;
            foreach (var c in new[]
            {
                Environment.GetEnvironmentVariable(envVar),
                Path.Combine(baseDir, exeName),
                Path.Combine(baseDir, "..", "..", "..", "..", projectDir, "bin", "Release", "net8.0-windows", exeName),
                Path.Combine(baseDir, "..", "..", "..", "..", projectDir, "bin", "Debug", "net8.0-windows", exeName),
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
