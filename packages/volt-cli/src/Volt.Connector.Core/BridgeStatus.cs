namespace Volt.Connector
{
    /// <summary>At-a-glance bridge state the tray icon colour reflects, derived by
    /// <see cref="ConnectionManager.Aggregate"/> from the self-describing project rows (serving/status) plus whether
    /// any channel was reachable: a reachable channel with nothing wanted served is Unavailable, no reachable channel
    /// at all is Unknown.</summary>
    public enum BridgeStatus
    {
        Unknown,
        Connected,    // healthy
        Degraded,     // channel had recent errors but still serving
        Unavailable,  // bridge up, but no IDE/project
    }
}
