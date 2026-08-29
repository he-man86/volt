namespace Volt.Connector
{
    /// <summary>At-a-glance bridge state the tray icon colour reflects, derived by
    /// <see cref="ConnectionManager.Aggregate"/> from the self-describing project rows (serving/status) plus whether
    /// any channel was reachable. Distinguishes "worker not up" (Unreachable) from "IDE not ready" (Unavailable) so
    /// the tray can say the right thing.</summary>
    public enum BridgeStatus
    {
        Unknown,
        Connected,    // healthy
        Degraded,     // channel had recent errors but still serving
        Unavailable,  // bridge up, but no IDE/project
        Unreachable,  // nothing listening on the port
    }
}
