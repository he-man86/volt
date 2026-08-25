namespace Volt.Contracts;

/// <summary>The per-row <c>status</c> word, defined once. Produced by the drivers (<c>DriverBase.RowStatus</c>) and
/// forced to <see cref="Idle"/> on pause by <c>BridgePipeHost</c>. It is the ROW'S full connection state — the ONE
/// self-describing field: <see cref="Idle"/> = detected but not the served one, <see cref="Healthy"/>/<see cref="Degraded"/>
/// = served (channel OK / had recent errors). "Is it serving" derives from this (<c>status != idle</c>), so there is no
/// separate <c>serving</c> flag. These strings travel on the wire and onward to the connector + TS as-is.
/// (<see cref="Unavailable"/> is the BRIDGE-level aggregate word — <c>HealthResponse.Status</c> when nothing serves —
/// not a row value.)</summary>
public static class HealthStatus
{
    public const string Healthy = "healthy";
    public const string Degraded = "degraded";
    public const string Idle = "idle";           // per-row: detected, not the served one
    public const string Unavailable = "unavailable"; // bridge-aggregate: nothing serving
}
