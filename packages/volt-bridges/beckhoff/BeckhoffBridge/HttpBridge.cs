using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using BeckhoffBridge.Handlers;

namespace BeckhoffBridge;

/// <summary>
/// HTTP server that routes requests to the appropriate handler.
/// Uses TcpListener for plain HTTP. Loopback-only; the `volt` CLI
/// connects directly to 127.0.0.1.
/// </summary>
internal sealed class HttpBridge
{
	private readonly BeckhoffConnection _connection;
	private readonly TcpListener _listener;
	private readonly string _version;
	private Thread? _listenerThread;
	private volatile bool _running;
	private long _lastRequestUnixSeconds = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

	/// <summary>Seconds since the most recent request landed. The main
	/// loop reads this every 60s for the IDLE heartbeat — when it's been
	/// quiet for at least a minute, we log a "still alive" line.</summary>
	public long SecondsSinceLastRequest =>
		Math.Max(0, DateTimeOffset.UtcNow.ToUnixTimeSeconds() - _lastRequestUnixSeconds);

	// Handlers — public wire surface
	private readonly HealthHandler _health;
	private readonly RefsHandler _refs;
	private readonly FetchHandler _fetch;
	private readonly PushHandler _push;
	private readonly BuildHandler _build;
	private readonly DebugHandler _debug;
	private readonly TreeHandler _tree;
	// SetHandler / CreateHandler / UpdateHandler / RenameHandler / DeleteHandler
	// / GetHandler still exist as internal helpers called by PushHandler and
	// FetchHandler — they're no longer wired to HTTP routes directly.

	public HttpBridge(BeckhoffConnection connection, int port, string version)
	{
		_connection = connection;
		_version = version;

		_listener = new TcpListener(IPAddress.Loopback, port);

		// Initialize handlers
		_health = new HealthHandler(connection, version);
		_refs = new RefsHandler(connection);
		_fetch = new FetchHandler(connection);
		_push = new PushHandler(connection);
		_build = new BuildHandler(connection);
		_debug = new DebugHandler(connection);
		_tree = new TreeHandler(connection);
	}

	/// <summary>Start listening for requests.</summary>
	public void Start()
	{
		_listener.Start();
		_running = true;
		_listenerThread = new Thread(ListenLoop)
		{
			Name = "BeckhoffBridge-HTTP",
			IsBackground = true,
		};
		_listenerThread.Start();
	}

	/// <summary>Stop the server.</summary>
	public void Stop()
	{
		_running = false;
		_listener.Stop();
		_listenerThread?.Join(TimeSpan.FromSeconds(5));
	}

	private void ListenLoop()
	{
		while (_running)
		{
			try
			{
				var client = _listener.AcceptTcpClient();
				// Handle each connection on a thread pool thread
				ThreadPool.QueueUserWorkItem(_ => HandleConnection(client));
			}
			catch (SocketException) when (!_running)
			{
				break;
			}
			catch (Exception ex)
			{
				Log.Warn($"Accept error: {ex.Message}");
			}
		}
	}

	private void HandleConnection(TcpClient client)
	{
		_lastRequestUnixSeconds = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
		try
		{
			client.ReceiveTimeout = 30_000;
			client.SendTimeout = 30_000;

			Stream stream = client.GetStream();

			// Read the request as raw bytes. Earlier versions used a
			// StreamReader for headers AND body, which broke for any body
			// containing multi-byte UTF-8 (em-dash, accented chars, smart
			// quotes): Content-Length is bytes but StreamReader.Read
			// returns chars, so the read loop kept asking for more chars
			// that would never arrive and blocked until ReceiveTimeout.
			// Browsers saw a 30s hang followed by a network error.
			var parsed = ReadHttpRequest(stream);
			if (parsed == null) return;
			var (method, path, bodyText) = parsed.Value;

			// Process and write response
			HandleRequest(stream, method, path, bodyText);
		}
		catch (Exception ex)
		{
			if (ex is not IOException)
				Log.Warn($"Connection error: {ex.Message}");
		}
		finally
		{
			client.Close();
		}
	}

	/// <summary>
	/// Read an HTTP request from a stream byte-by-byte. Returns method, path,
	/// and body text. Headers are guaranteed ASCII per the HTTP spec, so we
	/// can decode them as UTF-8 once we've found the `\r\n\r\n` separator.
	/// The body is read using Content-Length (bytes) directly against the
	/// underlying stream — never via a char-based reader.
	/// </summary>
	private static (string method, string path, string? bodyText)? ReadHttpRequest(Stream stream)
	{
		const int maxHeaderBytes = 64 * 1024;
		var ms = new MemoryStream();
		var temp = new byte[4096];
		int headerEnd = -1;

		while (ms.Length < maxHeaderBytes)
		{
			int n = stream.Read(temp, 0, temp.Length);
			if (n == 0) return null;
			ms.Write(temp, 0, n);

			byte[] all = ms.GetBuffer();
			int len = (int)ms.Length;
			for (int i = 3; i < len; i++)
			{
				if (all[i - 3] == '\r' && all[i - 2] == '\n' && all[i - 1] == '\r' && all[i] == '\n')
				{
					headerEnd = i - 3;
					break;
				}
			}
			if (headerEnd >= 0) break;
		}

		if (headerEnd < 0) return null;

		byte[] buffer = ms.GetBuffer();
		int totalLen = (int)ms.Length;
		string headerText = Encoding.UTF8.GetString(buffer, 0, headerEnd);
		var lines = headerText.Split("\r\n");
		if (lines.Length == 0) return null;

		var requestLineParts = lines[0].Split(' ', 3);
		if (requestLineParts.Length < 2) return null;
		string method = requestLineParts[0];
		string path = requestLineParts[1];

		int contentLength = 0;
		for (int j = 1; j < lines.Length; j++)
		{
			if (lines[j].StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase))
			{
				int.TryParse(lines[j].AsSpan(15).Trim(), out contentLength);
			}
		}

		string? bodyText = null;
		if (contentLength > 0)
		{
			var bodyBytes = new byte[contentLength];
			int bodyStart = headerEnd + 4;
			int prefix = Math.Min(totalLen - bodyStart, contentLength);
			if (prefix > 0) Array.Copy(buffer, bodyStart, bodyBytes, 0, prefix);
			int totalRead = prefix;
			while (totalRead < contentLength)
			{
				int read = stream.Read(bodyBytes, totalRead, contentLength - totalRead);
				if (read == 0) break;
				totalRead += read;
			}
			bodyText = Encoding.UTF8.GetString(bodyBytes, 0, totalRead);
		}

		return (method, path, bodyText);
	}

	private void HandleRequest(Stream stream, string method, string path, string? bodyText)
	{
		// CORS preflight
		if (method == "OPTIONS")
		{
			WriteResponse(stream, 204, null);
			return;
		}

		var sw = Stopwatch.StartNew();

		try
		{
			JsonObject? body = null;
			if (!string.IsNullOrWhiteSpace(bodyText))
			{
				body = JsonNode.Parse(bodyText)?.AsObject();
			}

			var description = DescribeRequest(path, body);

			// /logs is a diagnostic endpoint — pure file read, no TwinCAT
			// dependency. Handle before the IDE-attached gate so users can
			// fetch logs to attach to feedback even when nothing else works.
			if (path == "/logs")
			{
				WriteLogsResponse(stream);
				sw.Stop();
				Log.Http($"GET /logs -> 200 ({sw.ElapsedMilliseconds}ms)");
				return;
			}

			// All routes EXCEPT /health require the bridge to be attached
			// to TwinCAT. /health doubles as the "is the bridge up at all"
			// probe and must work in the no-IDE state so the frontend can
			// show "waiting for IDE" instead of a connection error.
			//
			// We do NOT trust the cached `_connection.IsConnected` flag
			// alone — it just checks `_dte != null`, which can stay
			// non-null for seconds after TwinCAT exits (until the next
			// /health call probes and tears down). During that window
			// the walker silently returns 0 items and /refs would lie
			// with a 200-OK empty refs response, which downstream callers
			// interpret as "engineer deleted everything." Actively probe
			// the IDE here (one cheap COM call) and disconnect on failure
			// so the gate is the same single source of truth /health uses.
			if (path != "/health")
			{
				bool ideAlive = _connection.RunOnStaThread(() =>
				{
					if (!_connection.IsConnected) return false;
					bool alive = _connection.ProbeIdeAlive();
					if (!alive)
					{
						// IDE died — drop stale COM refs so subsequent
						// requests also get the truth. Matches what
						// BuildHealthSnapshot does on its own probe path.
						try { _connection.Disconnect(); } catch { /* ignore */ }
					}
					return alive;
				});
				if (!ideAlive)
				{
					throw new BridgeException(
						503,
						"PLC_DISCONNECTED",
						"Bridge is waiting for TwinCAT XAE — open Visual Studio or TcXaeShell with a TwinCAT project loaded."
					);
				}
			}

			// If a prior call caught an RPC failure and flagged the
			// channel DEGRADED, reject non-/health calls fast — repeating
			// the broken call would just produce another 500 and waste
			// the COM round-trip. /health is the recovery path: its
			// probe clears the flag once the channel is responsive.
			if (path != "/health" && _connection.IsDegraded)
			{
				throw BridgeException.Degraded(_connection.DegradedReason ?? "previous call failed");
			}

			object? result = path switch
			{
				"/health"  => _connection.RunOnStaThread(() => _health.Handle()),
				"/refs"    => _connection.RunOnStaThread(() => _refs.Handle()),
				"/fetch"   => _connection.RunOnStaThread(() => _fetch.Handle(body ?? new JsonObject())),
				"/push"    => _connection.RunOnStaThread(() => _push.Handle(body ?? new JsonObject())),
				"/build"   => _connection.RunOnStaThread(() => _build.Handle(body ?? new JsonObject())),
				"/debug"   => _connection.RunOnStaThread(() => _debug.Handle(body ?? new JsonObject())),
				"/tree"    => _connection.RunOnStaThread(() => _tree.Handle(body ?? new JsonObject())),
				_ => null,
			};

			sw.Stop();

			if (result == null)
			{
				WriteResponse(stream, 404, new { error = new { code = "NOT_FOUND", message = $"Endpoint not found: {path}" } });
				return;
			}

			if (description != null)
				Log.Http($"{method} {path} -> 200 ({sw.ElapsedMilliseconds}ms) {description}");

			WriteResponse(stream, 200, result!);
		}
		catch (BridgeException ex)
		{
			sw.Stop();
			// Flip DEGRADED when the underlying cause looks like an RPC
			// failure — even though this handler returned a typed error,
			// the COM channel is suspect and the next call would likely
			// repeat the failure. /health probe clears it on recovery.
			if (BeckhoffConnection.IsRpcFailure(ex.Cause))
			{
				_connection.MarkDegraded($"{path}: {ex.Message}");
			}
			Log.Http($"{method} {path} -> {ex.HttpStatus} ({sw.ElapsedMilliseconds}ms) {ex.Code}: {ex.Message}");
			WriteResponse(stream, ex.HttpStatus, new { error = new { code = ex.Code, message = ex.Message } });
		}
		catch (Exception ex)
		{
			sw.Stop();
			if (BeckhoffConnection.IsRpcFailure(ex))
			{
				_connection.MarkDegraded($"{path}: {ex.Message}");
			}
			Log.Error($"{method} {path} -> 500 ({sw.ElapsedMilliseconds}ms) {ex.Message}");
			// Classify common COM/TwinCAT exceptions into actionable error codes
			if (ex.Message.Contains("already exists", StringComparison.OrdinalIgnoreCase))
			{
				WriteResponse(stream, 400, new { error = new { code = "ALREADY_EXISTS", message = ex.Message } });
			}
			else
			{
				WriteResponse(stream, 500, new { error = new { code = "INTERNAL_ERROR", message = ex.Message } });
			}
		}
	}

	private static string? DescribeRequest(string path, JsonObject? body)
	{
		return path switch
		{
			"/build" => "Build",
			"/refs" => "Refs",
			"/fetch" => "Fetch",
			"/push" => $"Push ({(body?["ops"] as JsonArray)?.Count ?? 0} ops)",
			"/debug" => $"Debug {body?["name"]?.GetValue<string>() ?? body?["path"]?.GetValue<string>()}",
			"/tree" => $"Tree {body?["path"]?.GetValue<string>() ?? "(all roots)"}",
			_ => null,
		};
	}

	/// <summary>
	/// Stream the tail of the bridge logfile as text/plain so the frontend
	/// can auto-attach it to feedback submissions. ~50 KB cap keeps DB
	/// metadata rows small. File missing / unreadable → empty body, never
	/// a 5xx (this endpoint exists *for* triage, breaking it makes things
	/// worse).
	/// </summary>
	private static void WriteLogsResponse(Stream stream)
	{
		const int TailBytes = 50 * 1024;
		byte[] body = [];
		try
		{
			var path = Log.LogFilePath;
			if (File.Exists(path))
			{
				using var f = new FileStream(
					path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
				if (f.Length > TailBytes)
				{
					f.Seek(-TailBytes, SeekOrigin.End);
					// Skip partial first line so the tail begins at a whole
					// timestamped line rather than mid-line.
					int b;
					while ((b = f.ReadByte()) != -1 && b != '\n') { }
				}
				using var ms = new MemoryStream();
				f.CopyTo(ms);
				body = ms.ToArray();
			}
		}
		catch (Exception ex)
		{
			body = Encoding.UTF8.GetBytes($"[bridge /logs error: {ex.Message}]\n");
		}

		var sb = new StringBuilder();
		sb.Append("HTTP/1.1 200 OK\r\n");
		sb.Append("Access-Control-Allow-Origin: *\r\n");
		sb.Append("Access-Control-Allow-Methods: GET, OPTIONS\r\n");
		sb.Append("Access-Control-Allow-Headers: Content-Type\r\n");
		sb.Append("Access-Control-Allow-Private-Network: true\r\n");
		sb.Append("Connection: close\r\n");
		sb.Append("Content-Type: text/plain; charset=utf-8\r\n");
		sb.Append($"Content-Length: {body.Length}\r\n");
		sb.Append("\r\n");
		stream.Write(Encoding.UTF8.GetBytes(sb.ToString()));
		if (body.Length > 0) stream.Write(body);
		stream.Flush();
	}

	private void WriteResponse(Stream stream, int statusCode, object? data)
	{
		var statusText = statusCode switch
		{
			200 => "OK",
			204 => "No Content",
			400 => "Bad Request",
			404 => "Not Found",
			500 => "Internal Server Error",
			503 => "Service Unavailable",
			_ => "OK",
		};

		byte[] bodyBytes;
		if (data != null)
		{
			bodyBytes = JsonSerializer.SerializeToUtf8Bytes(data, JsonOptions.Default);
		}
		else
		{
			bodyBytes = [];
		}

		var sb = new StringBuilder();
		sb.Append($"HTTP/1.1 {statusCode} {statusText}\r\n");
		sb.Append("Access-Control-Allow-Origin: *\r\n");
		sb.Append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n");
		sb.Append("Access-Control-Allow-Headers: Content-Type\r\n");
		sb.Append("Access-Control-Allow-Private-Network: true\r\n");
		sb.Append("Connection: close\r\n");
		if (bodyBytes.Length > 0)
		{
			sb.Append("Content-Type: application/json\r\n");
			sb.Append($"Content-Length: {bodyBytes.Length}\r\n");
		}
		sb.Append("\r\n");

		var headerBytes = Encoding.UTF8.GetBytes(sb.ToString());
		stream.Write(headerBytes);
		if (bodyBytes.Length > 0)
			stream.Write(bodyBytes);
		stream.Flush();
	}
}

/// <summary>
/// Exception type for bridge errors that map to specific HTTP status codes.
/// </summary>
internal class BridgeException : Exception
{
	public int HttpStatus { get; }
	public string Code { get; }
	/// <summary>
	/// Original underlying exception (e.g. the COMException that ComCall
	/// caught). Carried separately because base.InnerException is also
	/// used by the framework for stack traces; downstream consumers
	/// (HttpBridge degraded-detection) walk this chain explicitly.
	/// </summary>
	public Exception? Cause { get; }

	public BridgeException(int httpStatus, string code, string message, Exception? cause = null) : base(message, cause)
	{
		HttpStatus = httpStatus;
		Code = code;
		Cause = cause;
	}

	public static BridgeException NotFound(string type, string name) =>
		new(404, "NOT_FOUND", $"{type} '{name}' not found");

	public static BridgeException AlreadyExists(string name) =>
		new(400, "ALREADY_EXISTS", $"'{name}' already exists");

	public static BridgeException BadRequest(string message) =>
		new(400, "BAD_REQUEST", message);

	public static BridgeException NotConnected() =>
		new(503, "PLC_DISCONNECTED", "Not connected to TwinCAT XAE");

	public static BridgeException Degraded(string reason) =>
		new(503, "PLC_DEGRADED",
			$"TwinCAT COM channel is unresponsive — {reason}. Retry after the bridge's next /health probe confirms recovery (or restart TwinCAT if it persists).");
}

/// <summary>
/// Shared JSON serialization options.
/// </summary>
internal static class JsonOptions
{
	public static readonly JsonSerializerOptions Default = new()
	{
		PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
		WriteIndented = false,
	};
}
