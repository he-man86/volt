using System;
using System.IO;

namespace Volt.Cli.Transport;

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
    // Gate guards the file append (and _dir, which only it and Init touch). _source/_level are read on every
    // log call from any thread while Init may be writing them, so they are volatile instead — no lock needed to
    // read a single field, and taking one on the hot path would serialize callers that aren't writing a file.
    private static readonly object Gate = new object();
    private static string _dir = DefaultDir();
    private static volatile string _source = "volt";
    private static bool _enabled;
    private static volatile VoltLogLevel _level = VoltLogLevel.Info;
    private const int RetentionDays = 14;

    /// <summary>The durable log directory (<c>%LOCALAPPDATA%\Volt\logs</c>), the one place every component writes.</summary>
    public static string Dir { get { lock (Gate) return _dir; } }

    /// <summary>Minimum level emitted. Default <c>Info</c> — Debug lines are silent unless opted in.</summary>
    public static VoltLogLevel Level
    {
        get => _level;
        set => _level = value;
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
            // Info is the connection/status story; per-op mechanics (fetch/refs/build/…) are Debug. Set
            // VOLT_LOG_DEBUG=1 to surface them for troubleshooting.
            if (string.Equals(Environment.GetEnvironmentVariable("VOLT_LOG_DEBUG"), "1", StringComparison.Ordinal))
                _level = VoltLogLevel.Debug;
            try { Directory.CreateDirectory(_dir); Prune(); } catch { /* best effort */ }
        }
    }

    public static void Debug(string message) => Write(VoltLogLevel.Debug, message);
    public static void Info(string message) => Write(VoltLogLevel.Info, message);
    public static void Warn(string message) => Write(VoltLogLevel.Warn, message);
    public static void Error(string message, Exception? ex = null) =>
        Write(VoltLogLevel.Error, ex == null ? message : $"{message} :: {ex}");

    /// <summary>Append an already-produced line from a child process's stdout/stderr under its own source tag
    /// (so a supervised worker's output lands in the same durable store, timestamped).</summary>
    public static void Raw(string source, string? line)
    {
        if (string.IsNullOrEmpty(line)) return;
        WriteLine(source, $"[{Timestamp()}][{source}] {line}");
    }

    // This process's own source tag — only Raw() logs under someone else's (a supervised worker's).
    private static void Write(VoltLogLevel level, string message)
    {
        if (level < _level) return;
        var source = _source;
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
            // ONLY this source's own files. The store is SHARED — Setup drops install-*.log / uninstall-*.log
            // here, LogWindow puts them in the support bundle and scripts/test-install.ts reads them, and
            // nothing re-creates them. A `*.log` glob made every component the retention policy for its
            // neighbours: whichever process Init'd first destroyed the record of the install a support case is
            // about. Filenames are `{source}-{date}.log` (see PathFor), so the source prefix IS the ownership key.
            var cutoff = DateTime.Now.AddDays(-RetentionDays);
            foreach (var f in Directory.GetFiles(_dir, _source + "-*.log"))
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
