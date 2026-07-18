using System;
using System.IO;

namespace Volt.Cli.Connector
{
    /// <summary>The connector's slice of the shared Volt log store (<c>%LOCALAPPDATA%\Volt\logs</c>) — the same
    /// location and line format the bridges write via Core's <c>VoltLog</c>. The connector deliberately does not
    /// reference Core (it only speaks the HTTP wire to workers), so this is its own tiny writer. Source
    /// "connector" for its own lifecycle; a supervised worker's stdout/stderr is re-tagged via <see cref="Raw"/>.</summary>
    internal static class Log
    {
        private static readonly object Gate = new object();

        public static string Dir { get; } = ComputeDir();

        public static void Info(string m) => Write("connector", $"[{Ts()}][connector][info] {m}");
        public static void Warn(string m) => Write("connector", $"[{Ts()}][connector][warn] {m}");
        public static void Error(string m) => Write("connector", $"[{Ts()}][connector][error] {m}");

        public static void Raw(string source, string? line)
        {
            if (string.IsNullOrEmpty(line)) return;
            Write(source, $"[{Ts()}][{source}] {line}");
        }

        private static void Write(string source, string line)
        {
            lock (Gate)
            {
                try
                {
                    Directory.CreateDirectory(Dir);
                    File.AppendAllText(Path.Combine(Dir, $"{source}-{DateTime.Now:yyyy-MM-dd}.log"), line + Environment.NewLine);
                }
                catch { /* logging must never throw */ }
            }
        }

        private static string Ts() => DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff");

        private static string ComputeDir()
        {
            var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var baseDir = string.IsNullOrEmpty(local) ? Path.GetTempPath() : local;
            return Path.Combine(baseDir, "Volt", "logs");
        }
    }
}
