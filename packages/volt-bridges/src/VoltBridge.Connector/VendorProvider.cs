using System;
using System.Collections.Generic;
using System.IO;

namespace VoltBridge.Connector
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

        // ── InIdeLoad: how to launch the IDE so its in-process bridge loads ──
        public string? IdeExe { get; set; }
        public string IdeLaunchArgs { get; set; } = "";

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
                    WorkerExe = Resolve("VOLT_TWINCAT_BRIDGE", "BeckhoffBridge.exe", "VoltBridge.Beckhoff"),
                },
                new VendorProvider
                {
                    Id = "codesys",
                    DisplayName = "CODESYS",
                    Port = 8556,
                    Archetype = Archetype.InIdeLoad,
                    // Opt-in: enable from the tray menu when you use CODESYS, so an
                    // unused vendor doesn't keep the aggregate tray icon red.
                    Enabled = false,
                    IdeExe = ResolveCodesysExe(),
                    IdeLaunchArgs = BuildCodesysLaunchArgs(),
                },
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
            var env = Environment.GetEnvironmentVariable("VOLT_CODESYS_EXE");
            if (!string.IsNullOrEmpty(env) && File.Exists(env)) return env;
            // Best-effort default install location (configurable later).
            foreach (var p in new[]
            {
                @"C:\Program Files\CODESYS 3.5.21.40\CODESYS\Common\CODESYS.exe",
                @"C:\Program Files\CODESYS 3.5.18.30\CODESYS\Common\CODESYS.exe",
            })
            {
                if (File.Exists(p)) return p;
            }
            return null;
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
