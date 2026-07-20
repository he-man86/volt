using System;
using System.Collections.Generic;
using System.IO;
using Volt.Cli.Transport;

namespace Volt.Cli.Connector
{
    /// <summary>A headless bridge worker the connector spawns + supervises — an ExternalAttach vendor that
    /// attaches to a running IDE over its external API (TwinCAT COM/DTE, later Siemens/Allen-Bradley). CODESYS is
    /// NOT one: it loads in-proc via user activation and is never spawned (see <see cref="CodesysActivation"/>).</summary>
    public sealed record WorkerSpec(string Id, string DisplayName, string? Exe, string Args = "");

    /// <summary>Wires the connector's two halves in one place: the pipe-backed project SOURCES (the connection
    /// model the tray/window/control-plane view) and the worker SPECS (what to spawn on startup). Adding a vendor
    /// is a source here + — for an ExternalAttach vendor — a worker spec; nothing else.</summary>
    public static class ConnectorSetup
    {
        /// <summary>One <see cref="PipeProjectSource"/> per vendor. Both speak the same instances/select/health
        /// wire, so the connector never branches on vendor — the vendor difference is entirely behind the pipe.</summary>
        public static IReadOnlyList<IProjectSource> Sources() => new IProjectSource[]
        {
            // TwinCAT: one supervised worker on one pipe, ROT-multiplexed. CODESYS: one in-proc host per running
            // IDE, each on its own volt.bridge.codesys.<pid> pipe — discovered + fanned out (multiple live at once).
            new PipeProjectSource("twincat", "TwinCAT", new PipeBridgeWire(PipeNames.Twincat), PipeNames.Twincat),
            new CodesysProjectSource(),
        };

        /// <summary>The workers to spawn + supervise (ExternalAttach only). CODESYS is absent by design.</summary>
        public static IReadOnlyList<WorkerSpec> Workers() => new[]
        {
            new WorkerSpec("twincat", "TwinCAT",
                ResolveWorker("VOLT_TWINCAT_BRIDGE", "VoltBridgeTwincat.exe",
                    Path.Combine("..", "volt-cli", "src", "Volt.Cli.Ide.Twincat"))),
        };

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
