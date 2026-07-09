using System;
using System.IO;

namespace Volt.Bridge.Core.Diagnostics;

public enum VoltLogLevel { Debug, Info, Warn, Error }

/// <summary>
/// Tiny zero-dependency durable logger: timestamped, leveled, source-tagged lines to ONE location that
/// survives a reboot (<c>%LOCALAPPDATA%\Volt\logs</c>), in daily-rotated per-source files, pruned after a
/// retention window. netstandard2.0 with NO framework dependency, so it loads in every host — including the
/// in-process CODESYS bridge (net48) where a logging framework would risk conflicting with the IDE's own
/// assemblies. This is deliberately NOT Serilog/Microsoft.Extensions.Logging: our need is "append a line to a
/// rotating file", which a framework would only make heavier and riskier in-proc.
///
/// <para>No-op until <see cref="Init"/> is called, so a Core consumer that never opts in (tests, the LSP)
/// writes nothing. Never throws into the caller — logging must not break the thing it observes.</para>
/// </summary>
public static class VoltLog
{
    private static readonly object Gate = new object();
    private static string _dir = DefaultDir();
    private static string _source = "volt";
    private static bool _enabled;
    private static VoltLogLevel _level = VoltLogLevel.Info;
    private const int RetentionDays = 14;

    /// <summary>The durable log directory (<c>%LOCALAPPDATA%\Volt\logs</c>), the one place every component writes.</summary>
    public static string Dir { get { lock (Gate) return _dir; } }

    /// <summary>Minimum level emitted. Default <c>Info</c> — Debug lines are silent unless opted in.</summary>
    public static VoltLogLevel Level
    {
        get { lock (Gate) return _level; }
        set { lock (Gate) _level = value; }
    }

    /// <summary>Enable logging for this process under <paramref name="source"/> (e.g. "codesys", "twincat",
    /// "connector"). <paramref name="dir"/> overrides the default location (used by tests).</summary>
    public static void Init(string source, string? dir = null)
    {
        lock (Gate)
        {
            _source = string.IsNullOrEmpty(source) ? "volt" : source;
            _dir = dir ?? DefaultDir();
            _enabled = true;
            try { Directory.CreateDirectory(_dir); Prune(); } catch { /* best effort */ }
        }
    }

    public static void Debug(string message) => Write(VoltLogLevel.Debug, _source, message);
    public static void Info(string message) => Write(VoltLogLevel.Info, _source, message);
    public static void Warn(string message) => Write(VoltLogLevel.Warn, _source, message);
    public static void Error(string message, Exception? ex = null) =>
        Write(VoltLogLevel.Error, _source, ex == null ? message : $"{message} :: {ex}");

    /// <summary>Append an already-produced line from a child process's stdout/stderr under its own source tag
    /// (so a supervised worker's output lands in the same durable store, timestamped).</summary>
    public static void Raw(string source, string line)
    {
        if (string.IsNullOrEmpty(line)) return;
        WriteLine(source, $"[{Timestamp()}][{source}] {line}");
    }

    private static void Write(VoltLogLevel level, string source, string message)
    {
        if (level < _level) return;
        WriteLine(source, $"[{Timestamp()}][{source}][{level.ToString().ToLowerInvariant()}] {message}");
    }

    private static void WriteLine(string source, string line)
    {
        lock (Gate)
        {
            if (!_enabled) return;
            try
            {
                Directory.CreateDirectory(_dir);
                File.AppendAllText(PathFor(source), line + Environment.NewLine);
            }
            catch { /* logging must never throw into the caller */ }
        }
    }

    private static string PathFor(string source) => Path.Combine(_dir, $"{source}-{DateTime.Now:yyyy-MM-dd}.log");
    private static string Timestamp() => DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff");

    private static void Prune()
    {
        try
        {
            var cutoff = DateTime.Now.AddDays(-RetentionDays);
            foreach (var f in Directory.GetFiles(_dir, "*.log"))
                if (File.GetLastWriteTime(f) < cutoff) { try { File.Delete(f); } catch { /* ignore */ } }
        }
        catch { /* best effort */ }
    }

    private static string DefaultDir()
    {
        // %LOCALAPPDATA%\Volt\logs — survives a reboot (unlike %TEMP%, which the OS may clear). Falls back to
        // the temp dir only if LocalApplicationData can't be resolved.
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var baseDir = string.IsNullOrEmpty(local) ? Path.GetTempPath() : local;
        return Path.Combine(baseDir, "Volt", "logs");
    }
}
