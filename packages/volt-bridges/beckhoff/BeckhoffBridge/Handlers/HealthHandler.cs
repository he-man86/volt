using System;

namespace BeckhoffBridge.Handlers;

/// <summary>
/// GET /health — bridge liveness + cached IDE state.
///
/// PURE CACHE READ. Never invokes COM, never blocks behind /refs/fetch/push
/// on the STA thread. Returns whatever the connection's IDE-state cache
/// holds and triggers a background async probe when the cache is stale
/// (stale-while-revalidate). See <c>BeckhoffConnection.BuildHealthResponse</c>
/// for the cache mechanics.
///
/// Why decoupled from COM: previously this handler ran on the STA thread
/// (via HttpBridge's RunOnStaThread wrapper) and called ProbeIdeAlive
/// directly. That serialized behind any in-flight /refs walk because
/// TwinCAT COM is STA. A 2s client-side timeout on /health then flipped
/// the extension's connection state to "unreachable" during the STA-
/// thread recovery window after a long /refs walk, clobbering a clean
/// post-pull tree state.
/// </summary>
internal sealed class HealthHandler
{
	private readonly BeckhoffConnection _connection;
	private readonly string _version;

	public HealthHandler(BeckhoffConnection connection, string version)
	{
		_connection = connection;
		_version = version;
	}

	public object Handle()
	{
		return _connection.BuildHealthResponse(_version);
	}
}
