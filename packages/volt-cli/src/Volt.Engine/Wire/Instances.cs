using System.Collections.Generic;

namespace Volt.Engine.Wire;

/// <summary>
/// The vendor-neutral shape of the <c>instances</c> / <c>select</c> wire ops — how the connector discovers the
/// projects a bridge can connect to, and picks one. Both bridges produce/consume this identical shape (TwinCAT
/// enumerates running XAE instances over COM/ROT; CODESYS reports its in-proc primary project), so the connector
/// never branches on vendor. Detection is deliberately identity-only: the top-level project (TwinCAT solution /
/// CODESYS project) — never what's INSIDE it (PLC applications). Which PLC app to sync is a content concern,
/// resolved lazily by the sync ops, not part of connecting.
/// </summary>
public sealed record IdeProject(string Project, bool Dirty);

/// <summary>One running IDE instance the bridge can see, and the projects it has open.</summary>
public sealed record IdeInstance(string InstanceId, string? Name, string? Version, List<IdeProject> Projects);

/// <summary>The <c>instances</c> response: every instance the bridge can currently see.</summary>
public sealed record InstancesResult(List<IdeInstance> Instances);

/// <summary>The <c>select</c> request: which instance/project the connector picked. Either may be null (a
/// single-instance vendor); the driver binds what it can from these coordinates. No PLC-app field — connecting
/// is identity-only.</summary>
public sealed class SelectRequest
{
    public string? InstanceId { get; set; }
    public string? Project { get; set; }
}
