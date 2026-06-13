using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace VoltBridge.Connector
{
    /// <summary>A launchable CODESYS-family IDE install.</summary>
    public sealed record IdeInstall(string Id, string DisplayName, string? Version, string ExePath, string Variant);

    /// <summary>
    /// Discovers every CODESYS-family IDE on the machine — stock CODESYS AND OEM
    /// forks (Lenze PLC Designer, Schneider EcoStruxure Machine Expert, WAGO
    /// e!COCKPIT, ABB Automation Builder, …) — so the user can pick which to open.
    /// Three sources, deduped by exe path: a Program Files glob, the registry
    /// uninstall keys, and a manual list in %APPDATA%\Volt\connector.json.
    /// All best-effort: forks vary, so the manual list is the guaranteed escape hatch.
    /// </summary>
    public static class CodesysDiscovery
    {
        public static List<IdeInstall> Discover()
        {
            var byPath = new Dictionary<string, IdeInstall>(StringComparer.OrdinalIgnoreCase);
            void Add(IdeInstall i)
            {
                if (string.IsNullOrEmpty(i.ExePath) || !File.Exists(i.ExePath)) return;
                var key = Path.GetFullPath(i.ExePath);
                if (!byPath.ContainsKey(key)) byPath[key] = i with { ExePath = key };
            }

            foreach (var i in FromGlob()) Add(i);
            foreach (var i in FromRegistry()) Add(i);
            foreach (var i in FromManual()) Add(i);

            return byPath.Values
                .OrderBy(i => i.Variant != "CODESYS")                            // stock CODESYS first
                .ThenByDescending(i => i.Version ?? "", StringComparer.OrdinalIgnoreCase)
                .ToList();
        }

        private static readonly Regex VersionRx = new(@"\d+\.\d+\.\d+\.\d+", RegexOptions.Compiled);

        // ── Source 1: Program Files glob (stock CODESYS) ──
        private static IEnumerable<IdeInstall> FromGlob()
        {
            foreach (var pf in new[]
            {
                Environment.GetEnvironmentVariable("ProgramFiles"),
                Environment.GetEnvironmentVariable("ProgramFiles(x86)"),
            })
            {
                if (string.IsNullOrEmpty(pf) || !Directory.Exists(pf)) continue;
                List<string> dirs;
                try { dirs = Directory.EnumerateDirectories(pf, "CODESYS *").ToList(); }
                catch { continue; }
                foreach (var dir in dirs)
                {
                    var exe = Path.Combine(dir, "CODESYS", "Common", "CODESYS.exe");
                    if (!File.Exists(exe)) continue;
                    var ver = VersionRx.Match(Path.GetFileName(dir)).Value;
                    yield return new IdeInstall(MakeId(exe),
                        string.IsNullOrEmpty(ver) ? "CODESYS" : $"CODESYS {ver}",
                        NullIfEmpty(ver), exe, "CODESYS");
                }
            }
        }

        // ── Source 2: registry uninstall keys (forks) ──
        // Display-name tokens that identify a CODESYS-based product, mapped to a vendor label.
        private static readonly (string Token, string Variant)[] ForkTokens =
        {
            ("PLC Designer", "Lenze"),
            ("EcoStruxure Machine Expert", "Schneider"),
            ("SoMachine", "Schneider"),
            ("e!COCKPIT", "WAGO"),
            ("Automation Builder", "ABB"),
            ("IndraWorks", "Bosch Rexroth"),
            ("CODESYS", "CODESYS"),
        };
        private static readonly string[] FamilyPublishers = { "3S-Smart", "3S ", "CODESYS" };

        private static IEnumerable<IdeInstall> FromRegistry()
        {
            var roots = new (RegistryHive Hive, string Sub)[]
            {
                (RegistryHive.LocalMachine, @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
                (RegistryHive.LocalMachine, @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
                (RegistryHive.CurrentUser,  @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
            };
            foreach (var (hive, sub) in roots)
            {
                RegistryKey? root = null;
                try { root = RegistryKey.OpenBaseKey(hive, RegistryView.Default).OpenSubKey(sub); }
                catch { }
                if (root == null) continue;
                using (root)
                {
                    foreach (var name in SafeSubKeyNames(root))
                    {
                        RegistryKey? k = null;
                        try { k = root.OpenSubKey(name); } catch { }
                        if (k == null) continue;
                        using (k)
                        {
                            if (k.GetValue("DisplayName") is not string display || display.Length == 0) continue;
                            var publisher = k.GetValue("Publisher") as string ?? "";
                            var variant = MatchVariant(display, publisher);
                            if (variant == null) continue;

                            var exe = ResolveForkExe(k.GetValue("DisplayIcon") as string, k.GetValue("InstallLocation") as string);
                            if (exe == null) continue;
                            var ver = (k.GetValue("DisplayVersion") as string) ?? VersionRx.Match(display).Value;
                            yield return new IdeInstall(MakeId(exe), display.Trim(), NullIfEmpty(ver), exe, variant);
                        }
                    }
                }
            }
        }

        private static string? MatchVariant(string display, string publisher)
        {
            foreach (var p in FamilyPublishers)
            {
                if (publisher.IndexOf(p, StringComparison.OrdinalIgnoreCase) < 0) continue;
                foreach (var (tok, v) in ForkTokens)
                    if (display.IndexOf(tok, StringComparison.OrdinalIgnoreCase) >= 0) return v;
                return "CODESYS";
            }
            foreach (var (tok, v) in ForkTokens)
                if (display.IndexOf(tok, StringComparison.OrdinalIgnoreCase) >= 0) return v;
            return null;
        }

        private static string? ResolveForkExe(string? displayIcon, string? installLocation)
        {
            if (!string.IsNullOrEmpty(displayIcon))
            {
                var p = displayIcon.Trim().Trim('"');
                var dot = p.IndexOf(".exe", StringComparison.OrdinalIgnoreCase);
                if (dot >= 0) p = p.Substring(0, dot + 4); // drop any ",iconIndex" suffix
                p = p.Trim().Trim('"');
                if (p.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) && File.Exists(p)) return p;
            }
            if (!string.IsNullOrEmpty(installLocation) && Directory.Exists(installLocation))
            {
                foreach (var rel in new[] { @"CODESYS\Common", "Common", "" })
                {
                    var dir = Path.Combine(installLocation, rel);
                    if (!Directory.Exists(dir)) continue;
                    var codesys = Path.Combine(dir, "CODESYS.exe");
                    if (File.Exists(codesys)) return codesys;
                    string? first = null;
                    try { first = Directory.EnumerateFiles(dir, "*.exe").FirstOrDefault(); } catch { }
                    if (first != null) return first;
                }
            }
            return null;
        }

        // ── Source 3: manual override (%APPDATA%\Volt\connector.json) ──
        private static IEnumerable<IdeInstall> FromManual()
        {
            var path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Volt", "connector.json");
            if (!File.Exists(path)) yield break;
            ConnectorSettings? cfg = null;
            try
            {
                cfg = JsonSerializer.Deserialize<ConnectorSettings>(File.ReadAllText(path),
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            }
            catch { }
            if (cfg?.CodesysInstalls == null) yield break;
            foreach (var m in cfg.CodesysInstalls)
            {
                if (string.IsNullOrEmpty(m.ExePath)) continue;
                yield return new IdeInstall(MakeId(m.ExePath!),
                    string.IsNullOrEmpty(m.DisplayName) ? Path.GetFileNameWithoutExtension(m.ExePath!) : m.DisplayName!,
                    null, m.ExePath!, "Manual");
            }
        }

        /// <summary>Persist a hand-picked exe to %APPDATA%\Volt\connector.json so it shows
        /// up on every future launch — the guaranteed backup when auto-detection misses a
        /// fork or an unusual install path.</summary>
        public static void AddManualInstall(string exePath, string? displayName)
        {
            var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Volt");
            Directory.CreateDirectory(dir);
            var path = Path.Combine(dir, "connector.json");
            ConnectorSettings cfg = new();
            if (File.Exists(path))
            {
                try { cfg = JsonSerializer.Deserialize<ConnectorSettings>(File.ReadAllText(path), new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new(); }
                catch { }
            }
            cfg.CodesysInstalls ??= new List<ManualInstall>();
            if (!cfg.CodesysInstalls.Any(m => string.Equals(m.ExePath, exePath, StringComparison.OrdinalIgnoreCase)))
                cfg.CodesysInstalls.Add(new ManualInstall { DisplayName = displayName, ExePath = exePath });
            try { File.WriteAllText(path, JsonSerializer.Serialize(cfg, new JsonSerializerOptions { WriteIndented = true })); }
            catch { }
        }

        private static IEnumerable<string> SafeSubKeyNames(RegistryKey k)
        {
            try { return k.GetSubKeyNames(); } catch { return Array.Empty<string>(); }
        }

        private static string MakeId(string exePath) =>
            "cds-" + Math.Abs(Path.GetFullPath(exePath).ToLowerInvariant().GetHashCode()).ToString("x");

        private static string? NullIfEmpty(string? s) => string.IsNullOrEmpty(s) ? null : s;

        private sealed class ConnectorSettings { public List<ManualInstall>? CodesysInstalls { get; set; } }
        private sealed class ManualInstall
        {
            public string? DisplayName { get; set; }
            public string? ExePath { get; set; }
            public string? ScriptArgs { get; set; }
        }
    }
}
