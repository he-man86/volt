using System;

namespace BeckhoffBridge.Handlers;

/// <summary>
/// GET /health — Returns bridge status, IDE liveness, and project info.
/// The COM probe runs on the STA thread; this handler is invoked from
/// HttpBridge inside RunOnStaThread, so it must NOT marshal again.
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
		return _connection.BuildHealthSnapshot(_version);
	}
}
