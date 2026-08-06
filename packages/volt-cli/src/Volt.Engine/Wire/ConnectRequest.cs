namespace Volt.Engine.Wire;

/// <summary>The <c>connect</c> request: which project the connector picked, by NAME. May be null (a soft/refresh
/// select); the driver binds what it can. No vendor field — the connector routes to the right bridge/pipe by the
/// row's vendor before sending this. No PLC-app field — connecting is identity-only.
/// <para>The row it answers (<c>ProjectEntry</c>) lives in <c>Volt.Cli.Transport.Wire</c>; this request stays here
/// because it is only ever the <c>connect</c> op's deserialization target, which no client below the Engine
/// constructs.</para></summary>
public sealed class ConnectRequest
{
    public string? Project { get; set; }
}
