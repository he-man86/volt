namespace Volt.Cli.Transport;

/// <summary>The <c>/health</c> payload <c>status</c> word, defined once. Produced by the drivers
/// (<c>DriverBase</c>), defaulted on <c>HealthResponse</c>, and forced on pause by <c>BridgePipeHost</c>; consumed
/// by the connector's <c>HealthProbe.FromWire</c>. A C#-internal wire vocabulary (the connector re-serializes its
/// own <c>BridgeStatus</c> enum onward, so these strings never reach TS). Values travel on the wire as-is.</summary>
public static class HealthStatus
{
    public const string Healthy = "healthy";
    public const string Degraded = "degraded";
    public const string Unavailable = "unavailable";
}
