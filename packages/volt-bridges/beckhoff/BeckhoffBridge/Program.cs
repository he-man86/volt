using System;
using System.IO;
using System.Reflection;
using System.Text.Json;
using System.Threading;

namespace BeckhoffBridge;

/// <summary>
/// Beckhoff TwinCAT 3 Bridge for Volt.
///
/// Standalone console app that attaches to a running TwinCAT XAE instance
/// (Visual Studio or TcXaeShell) and exposes an HTTP JSON API on
/// 127.0.0.1:&lt;port&gt;. The `volt` CLI talks to it directly — no relay,
/// no cloud, no telemetry.
///
/// Must run as STA thread because TwinCAT Automation Interface is COM-based.
/// </summary>
internal static class Program
{
	private const int DefaultPort = 8555;
	private static readonly string Version = LoadVersion();

	private static readonly ManualResetEvent ShutdownEvent = new(false);

	[STAThread]
	static int Main(string[] args)
	{
		AppDomain.CurrentDomain.UnhandledException += OnUnhandledException;
		System.Threading.Tasks.TaskScheduler.UnobservedTaskException += OnUnobservedTaskException;

		int port = DefaultPort;

		// Parse command-line arguments
		for (int i = 0; i < args.Length; i++)
		{
			switch (args[i])
			{
				case "--port" when i + 1 < args.Length:
					if (!int.TryParse(args[++i], out port) || port < 1 || port > 65535)
					{
						Log.Error($"Invalid port: {args[i]}");
						return 1;
					}
					break;

				case "--help":
				case "-h":
					PrintUsage();
					return 0;

				case "--version":
				case "-v":
					// Plain stdout — version queries are scripted and shouldn't
					// be polluted with the [HH:MM:SS] STARTUP prefix.
					Console.WriteLine($"BeckhoffBridge {Version}");
					return 0;

				default:
					Log.Error($"Unknown argument: {args[i]}");
					PrintUsage();
					return 1;
			}
		}

		Log.Startup($"BeckhoffBridge {Version}");

		// Register COM message filter (required for STA COM interop)
		ComMessageFilter.Register();

		// Build the connection but do NOT throw on first failure — the bridge
		// stays alive while we wait for TwinCAT to come up. The user can
		// launch the bridge first, then open Visual Studio / TcXaeShell, and
		// we'll auto-attach when it appears (within ~3s).
		var connection = new BeckhoffConnection();
		// Warm the IDE-state cache so the first /health request after
		// startup carries real project info instead of an empty
		// placeholder. The probe queues onto the STA thread (which the
		// main message-pump loop drains in ProcessQueue); idempotent
		// while in flight. See BeckhoffConnection.TriggerAsyncProbe.
		connection.TriggerAsyncProbe();
		Log.Ide("Looking for TwinCAT XAE...");
		bool initialIdeFound = TryAttachToIde(connection, quietOnFail: true);
		if (!initialIdeFound)
		{
			Log.Ide("[WARN] TwinCAT not running yet - retrying every 3s");
			Log.Ide("   Open Visual Studio 2022/2019 or TcXaeShell with a TwinCAT project.");
		}

		// Start HTTP server immediately, even before IDE is found. /health
		// returns connected=false until we attach; CRUD endpoints return
		// PLC_DISCONNECTED with a friendly message so the client shows
		// "no project" rather than 500-erroring.
		HttpBridge bridge;
		try
		{
			bridge = new HttpBridge(connection, port, Version);
			bridge.Start();
		}
		catch (Exception ex)
		{
			Log.Error($"Failed to start server: {ex.Message}");
			Log.Error("Press any key to exit...");
			Console.ReadKey(true);
			connection.Disconnect();
			ComMessageFilter.Revoke();
			return 1;
		}

		Log.Http($"Listening on http://127.0.0.1:{port}");
		MaybePrintReadyBanner(ide: connection.IsConnected);

		Log.Startup("Press Ctrl+C to stop.");

		Console.CancelKeyPress += (_, e) =>
		{
			e.Cancel = true;
			ShutdownEvent.Set();
		};

		// STA message pump: process queued COM calls from the HTTP thread.
		// Also: if we're not yet attached to TwinCAT, retry every ~3 seconds
		// (60 ticks * 50ms). Connect() must run on the STA thread because
		// COM Automation Interface is apartment-bound, so we interleave it
		// with ProcessQueue rather than spawning a separate thread.
		// Heartbeat: every 60s of wall time while the bridge is connected
		// AND no HTTP traffic was seen in the last 60s, log an idle line
		// so users know the process is alive when nothing's happening.
		const int RetryEveryNTicks = 60;
		const int HeartbeatTickInterval = 1200; // 60s @ 50ms
		int ticksSinceLastConnectAttempt = 0;
		int ticksSinceLastHeartbeatCheck = 0;
		bool wasConnected = false;
		while (!ShutdownEvent.WaitOne(50))
		{
			connection.ProcessQueue();

			if (!connection.IsConnected)
			{
				if (++ticksSinceLastConnectAttempt >= RetryEveryNTicks)
				{
					ticksSinceLastConnectAttempt = 0;
					TryAttachToIde(connection, quietOnFail: true);
				}
				wasConnected = false;
			}
			else
			{
				ticksSinceLastConnectAttempt = 0;
				if (!wasConnected)
				{
					wasConnected = true;
					MaybePrintReadyBanner(ide: true);
				}
			}

			if (++ticksSinceLastHeartbeatCheck >= HeartbeatTickInterval)
			{
				ticksSinceLastHeartbeatCheck = 0;
				if (connection.IsConnected && bridge.SecondsSinceLastRequest >= 60)
				{
					Log.Idle($"Bridge healthy - last request {bridge.SecondsSinceLastRequest}s ago");
				}
			}
		}

		connection.ProcessQueue();

		Log.Startup("Shutting down...");
		bridge.Stop();
		connection.Disconnect();
		ComMessageFilter.Revoke();
		Log.Startup("Goodbye.");

		return 0;
	}

	/// <summary>One-time "everything is up" banner.</summary>
	private static bool _readyBannerShown;
	private static readonly object _readyLock = new();
	private static void MaybePrintReadyBanner(bool ide)
	{
		if (!ide) return;
		lock (_readyLock)
		{
			if (_readyBannerShown) return;
			_readyBannerShown = true;
		}
		Log.Ready("[OK] Bridge is up.");
	}

	/// <summary>Read version from embedded version.json (single source of truth).</summary>
	private static string LoadVersion()
	{
		try
		{
			// Try embedded resource first (works in single-file publish)
			using var stream = Assembly.GetExecutingAssembly()
				.GetManifestResourceStream("version.json");
			if (stream != null)
			{
				using var reader = new StreamReader(stream);
				var doc = JsonDocument.Parse(reader.ReadToEnd());
				return doc.RootElement.GetProperty("version").GetString() ?? "0.0.0";
			}

			// Fallback: read from file next to the exe
			var exeDir = AppContext.BaseDirectory;
			var filePath = Path.Combine(exeDir, "version.json");
			if (File.Exists(filePath))
			{
				var doc = JsonDocument.Parse(File.ReadAllText(filePath));
				return doc.RootElement.GetProperty("version").GetString() ?? "0.0.0";
			}
		}
		catch { /* fall through */ }

		return "0.0.0";
	}

	/// <summary>
	/// Attempt to attach to a running TwinCAT XAE. Used both at startup
	/// and as a retry from the main STA loop while waiting for the user
	/// to launch their IDE. Returns true on first success.
	///
	/// `quietOnFail = true` suppresses the verbose diagnostic so the
	/// console isn't spammed every 3s while we're polling.
	/// </summary>
	private static bool TryAttachToIde(BeckhoffConnection connection, bool quietOnFail)
	{
		try
		{
			connection.Connect();
		}
		catch (Exception ex)
		{
			if (!quietOnFail)
			{
				Log.Error($"Failed to attach to TwinCAT XAE: {ex.Message}");
				Log.Ide("Open TwinCAT XAE first, then this bridge will attach automatically.");
			}
			return false;
		}

		Log.Ide($"[OK] Attached to {connection.IdeName ?? "TwinCAT XAE"} {connection.IdeVersion ?? string.Empty}".TrimEnd());
		Log.Ide($"[OK] Project loaded: {connection.ProjectName}");
		return true;
	}

	private static void OnUnhandledException(object sender, UnhandledExceptionEventArgs e)
	{
		try
		{
			var ex = e.ExceptionObject as Exception;
			Log.Error($"UNHANDLED: {ex?.Message ?? "(non-Exception)"}");
			if (ex != null) Log.Error(ex.ToString());
		}
		catch { /* never let the crash handler crash */ }
	}

	private static void OnUnobservedTaskException(object? sender,
		System.Threading.Tasks.UnobservedTaskExceptionEventArgs e)
	{
		try
		{
			Log.Error($"UNOBSERVED TASK: {e.Exception.Message}");
			Log.Error(e.Exception.ToString());
			e.SetObserved();
		}
		catch { /* never let the crash handler crash */ }
	}

	private static void PrintUsage()
	{
		Console.WriteLine($"BeckhoffBridge {Version} -- TwinCAT 3 Bridge for Volt");
		Console.WriteLine();
		Console.WriteLine("Usage: BeckhoffBridge [options]");
		Console.WriteLine();
		Console.WriteLine("Options:");
		Console.WriteLine($"  --port <port>      HTTP port (default: {DefaultPort})");
		Console.WriteLine("  --version, -v      Show version");
		Console.WriteLine("  --help, -h         Show this help");
	}
}
