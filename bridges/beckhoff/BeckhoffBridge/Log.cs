using System;
using System.IO;

namespace BeckhoffBridge;

/// <summary>
/// Single-channel structured stdout logger for support triage.
///
/// Format: <c>[HH:MM:SS] CATEGORY  message</c> with the category column
/// padded to a constant width so users (and we) can scan a pasted log
/// vertically. Symbols ✓/✗/⚠ are used inline by callers — this class
/// itself is plain text formatting only.
///
/// Categories:
///   STARTUP — version, port, CLI args, banners
///   IDE     — TwinCAT attach attempts, project loaded/unloaded
///   HTTP    — HTTP server lifecycle, request errors
///   IDLE    — periodic heartbeat while connected with no traffic
///   READY   — one-time "everything is up" banner
///   WARN    — non-fatal degradations
///   ERROR   — fatal or unhandled
///
/// Goal: when a user can't connect, they (or we, asking) can read the
/// stdout and tell *which step* failed without a debugger.
/// </summary>
internal static class Log
{
	// 7 chars matches the longest tag (STARTUP / RELAY / WARN with padding).
	private const int CategoryWidth = 7;

	/// <summary>Rolling logfile so users can attach their bridge log to
	/// bug reports without copy-pasting the console. Served via the
	/// HTTP bridge's GET /logs endpoint. ~5 MB cap with one rotation
	/// (.log.1) for bounded disk usage.</summary>
	public static readonly string LogFilePath = Path.Combine(
		Path.GetTempPath(), "plcassist-beckhoff.log");
	private const long LogFileMaxBytes = 5 * 1024 * 1024;
	private static readonly object FileLock = new();

	public static void Startup(string message) => Write("STARTUP", message);
	public static void Ide(string message) => Write("IDE", message);
	public static void Http(string message) => Write("HTTP", message);
	public static void Idle(string message) => Write("IDLE", message);
	public static void Ready(string message) => Write("READY", message);
	public static void Warn(string message) => Write("WARN", message, error: true);
	public static void Error(string message) => Write("ERROR", message, error: true);

	private static void Write(string category, string message, bool error = false)
	{
		var ts = DateTime.Now.ToString("HH:mm:ss");
		var line = $"[{ts}] {category.PadRight(CategoryWidth)} {message}";
		if (error) Console.Error.WriteLine(line);
		else Console.WriteLine(line);
		WriteToFile(line);
	}

	private static void WriteToFile(string line)
	{
		// Best-effort: file logging failure must not break the bridge
		// (it ran for years with stdout-only).
		try
		{
			lock (FileLock)
			{
				RotateIfNeeded();
				File.AppendAllText(LogFilePath, line + Environment.NewLine);
			}
		}
		catch
		{
			// Disk full, permission denied, antivirus locking — all silent.
		}
	}

	private static void RotateIfNeeded()
	{
		try
		{
			var info = new FileInfo(LogFilePath);
			if (info.Exists && info.Length > LogFileMaxBytes)
			{
				var backup = LogFilePath + ".1";
				if (File.Exists(backup)) File.Delete(backup);
				File.Move(LogFilePath, backup);
			}
		}
		catch
		{
			// If rotation fails, fall through and keep appending — bounded
			// growth is preferable to crashing on log writes.
		}
	}

	/// <summary>
	/// Return the last `maxBytes` of the logfile as a UTF-8 string. Used to
	/// attach recent log context to failure telemetry events so admins can
	/// triage without copy-pasting the user's console. Returns "" on any
	/// error — callers treat absence as "no log available".
	/// </summary>
	public static string ReadTail(int maxBytes = 4000)
	{
		try
		{
			lock (FileLock)
			{
				if (!File.Exists(LogFilePath)) return string.Empty;
				using var f = new FileStream(
					LogFilePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
				if (f.Length > maxBytes)
				{
					f.Seek(-maxBytes, SeekOrigin.End);
					// Skip partial first line so tail begins at a whole line.
					int b;
					while ((b = f.ReadByte()) != -1 && b != '\n') { }
				}
				using var ms = new MemoryStream();
				f.CopyTo(ms);
				return System.Text.Encoding.UTF8.GetString(ms.ToArray());
			}
		}
		catch
		{
			return string.Empty;
		}
	}

}
