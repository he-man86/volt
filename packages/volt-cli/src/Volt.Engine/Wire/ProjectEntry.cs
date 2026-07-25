using System.Collections.Generic;

namespace Volt.Engine.Wire;

/// <summary>
/// One connectable project — a leaf, the unit the connector shows as ONE row in its project picker (a CODESYS or
/// TwinCAT project has no child projects). Self-describing so the wire needs no nesting and no root fields: each
/// bridge's <c>health</c> returns a FLAT list of these (all its own vendor), and the connector simply concatenates
/// every bridge's list into the ONE cross-vendor array it shows (which is why <see cref="Vendor"/> is per-row). A
/// frontend then finds its own row by id and reads that row's state.
/// <list type="bullet">
///   <item><see cref="Vendor"/> — "codesys" | "twincat" (per row: the merged array mixes vendors).</item>
///   <item><see cref="Project"/> — the row's IDENTITY and its `select` address. A project is identified by its
///   NAME (with the vendor); `select` re-resolves it on whichever live instance has it open (CODESYS: its serving
///   pipe; TwinCAT: the running window whose solution holds that project). No instance handle: two projects opened
///   under the same name at once are indistinguishable — the same limit the workspace binding already has.</item>
///   <item><see cref="Version"/> — the IDE version, shown in the row's label.</item>
///   <item><see cref="Status"/> — the IDE's channel health: "healthy" | "degraded" (CODESYS is in-proc → always
///   healthy; only a TwinCAT attach can degrade).</item>
///   <item><see cref="Serving"/> — this bridge is attached to & serving THIS project right now (pull/push work).
///   At most one row per bridge is serving; none while the bridge is paused/disconnected.</item>
///   <item><see cref="Dirty"/> — the project has unsaved changes in the IDE.</item>
/// </list>
/// Detection is identity-only: the top-level project, never the PLC applications inside it (a content concern the
/// sync ops resolve lazily).</summary>
public sealed record ProjectEntry(
    string Vendor,
    string? Version,
    string Project,
    string Status,
    bool Serving,
    bool Dirty);

/// <summary>The <c>connect</c> request: which project the connector picked, by NAME. May be null (a soft/refresh
/// select); the driver binds what it can. No vendor field — the connector routes to the right bridge/pipe by the
/// row's vendor before sending this. No PLC-app field — connecting is identity-only.</summary>
public sealed class ConnectRequest
{
    public string? Project { get; set; }
}
