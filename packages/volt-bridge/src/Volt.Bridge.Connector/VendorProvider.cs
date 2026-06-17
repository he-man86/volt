using System;
using System.Collections.Generic;
using System.IO;

namespace Volt.Bridge.Connector
{
    /// <summary>How a vendor's bridge attaches — the only structural axis that matters.</summary>
    public enum Archetype
    {
        /// <summary>A headless worker process attaches to the running IDE via its external
        /// API (TwinCAT COM/DTE, Siemens Openness, Allen-Bradley LDSDK). The connector
        /// spawns and supervises the worker.</summary>
        ExternalAttach,

        /// <summary>The bridge must load INSIDE the IDE process (CODESYS — no external API).
        /// The connector can't host it; it launches the IDE with the in-proc loader and
        /// monitors the port.</summary>
        InIdeLoad,
    }

    /// <summary>
    /// One vendor plugged into the connector. The connector treats every vendor through
    /// this single shape; adding Siemens/Allen-Bradley is a new descriptor + a worker
    /// binary, nothing else.
    /// </summary>
    public sealed class VendorProvider
    {
        public required string Id { get; init; }            // "twincat", "codesys", …
        public required string DisplayName { get; init; }   // "TwinCAT", "CODESYS"
        public required int Port { get; init; }             // the bridge's HTTP port
        public required Archetype Archetype { get; init; }
        public bool Enabled { get; set; } = true;

        // ── ExternalAttach: the headless worker process ──
        public string? WorkerExe { get; set; }
        public string WorkerArgs { get; set; } = "";

        /// <summary>Which IDE instance/project the worker should attach to (TwinCAT). Null
        /// = first active instance. Pushed to the worker as VOLT_TC_* env on (re)spawn.</summary>
        public TcTarget? Target { get; set; }

        // ── InIdeLoad: how to launch the IDE so its in-process bridge loads ──
        public string? IdeExe { get; set; }
        public string IdeLaunchArgs { get; set; } = "";

        /// <summary>All discovered launchable installs (multiple CODESYS versions + OEM
        /// forks). IdeExe is the first/default; the tray lets the user pick any of these.</summary>
        public IReadOnlyList<IdeInstall> Installs { get; set; } = Array.Empty<IdeInstall>();

        public bool CanLaunchIde => IdeExe != null && File.Exists(IdeExe);
    }

    /// <summary>Built-in providers + path resolution. A later iteration loads overrides
    /// (ports / exe paths / enabled set) from a JSON next to the connector.</summary>
    public static class ConnectorConfig
    {
        public static List<VendorProvider> DefaultProviders()
        {
            return new List<VendorProvider>
            {
                new VendorProvider
                {
                    Id = "twincat",
                    DisplayName = "TwinCAT",
                    Port = 8555,
                    Archetype = Archetype.ExternalAttach,
                    WorkerExe = Resolve("VOLT_TWINCAT_BRIDGE", "Volt.Bridge.Beckhoff.exe", "Volt.Bridge.Beckhoff"),
                },
                CodesysProvider(),
            };
        }

        /// <summary>CODESYS, with every discovered install (multiple versions + OEM forks).</summary>
        private static VendorProvider CodesysProvider()
        {
            var installs = CodesysDiscovery.Discover();
            // Fall back to the VOLT_CODESYS_EXE env override if discovery found nothing.
            if (installs.Count == 0)
            {
                var envExe = ResolveCodesysExe();
                if (envExe != null) installs = new List<IdeInstall> { new("cds-env", "CODESYS", null, envExe, "CODESYS") };
            }
            return new VendorProvider
            {
                Id = "codesys",
                DisplayName = "CODESYS",
                Port = 8556,
                Archetype = Archetype.InIdeLoad,
                // Opt-in: enable from the tray menu when you use CODESYS, so an
                // unused vendor doesn't keep the aggregate tray icon red.
                Enabled = false,
                Installs = installs,
                IdeExe = installs.Count > 0 ? installs[0].ExePath : null,
                IdeLaunchArgs = BuildCodesysLaunchArgs(),
            };
        }

        /// <summary>Resolve a worker exe: env override → next to the connector (shipped) →
        /// the dev build output (Release then Debug).</summary>
        private static string? Resolve(string envVar, string exeName, string projectDir)
        {
            var baseDir = AppContext.BaseDirectory;
            var candidates = new[]
            {
                Environment.GetEnvironmentVariable(envVar),
                Path.Combine(baseDir, exeName),
                Path.Combine(baseDir, "..", "..", "..", "..", projectDir, "bin", "Release", "net8.0-windows", exeName),
                Path.Combine(baseDir, "..", "..", "..", "..", projectDir, "bin", "Debug", "net8.0-windows", exeName),
            };
            foreach (var c in candidates)
            {
                if (string.IsNullOrEmpty(c)) continue;
                var full = Path.GetFullPath(c);
                if (File.Exists(full)) return full;
            }
            return null;
        }

        private static string? ResolveCodesysExe()
        {
            // Env override only — real installs (any version + OEM forks) come from
            // CodesysDiscovery (glob/registry/manual), so there are NO hardcoded versions
            // here to rot when a new CODESYS release ships.
            var env = Environment.GetEnvironmentVariable("VOLT_CODESYS_EXE");
            return !string.IsNullOrEmpty(env) && File.Exists(env) ? env : null;
        }

        /// <summary>Launch CODESYS so the in-proc bridge auto-loads: run the start script
        /// at startup; Host.Start returns, leaving the IDE interactive on :8556.</summary>
        private static string BuildCodesysLaunchArgs()
        {
            var script = Environment.GetEnvironmentVariable("VOLT_CODESYS_SCRIPT");
            if (string.IsNullOrEmpty(script))
            {
                var baseDir = AppContext.BaseDirectory;
                foreach (var c in new[]
                {
                    Path.Combine(baseDir, "codesys-scriptcommands", "start_bridge.py"),
                    Path.Combine(baseDir, "..", "..", "..", "..", "..", "codesys-scriptcommands", "start_bridge.py"),
                })
                {
                    var full = Path.GetFullPath(c);
                    if (File.Exists(full)) { script = full; break; }
                }
            }
            return script == null ? "" : $"--runscript=\"{script}\"";
        }
    }
}
