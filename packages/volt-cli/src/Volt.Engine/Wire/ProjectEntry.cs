using System.Collections.Generic;

namespace Volt.Engine.Wire;

/// <summary>
/// One connectable project — a leaf, the unit the connector shows as ONE row in its project picker (a CODESYS or
/// TwinCAT project has no child projects). Self-describing so the wire needs no nesting and no root fields: each
/// bridge's <c>health</c> returns a FLAT list of these (all its own vendor), and the connector simply concatenates
/// every bridge's list into the ONE cross-vendor array it shows (which is why <see cref="Vendor"/> is per-row). A
/// frontend then finds its own row by vendor+name and reads that row's state — the row carries no id; the connector
/// mints the id it keys on (<c>DetectedProject.MakeId</c>) from exactly those two fields.
/// <list type="bullet">
///   <item><see cref="Vendor"/> — "codesys" | "twincat" (per row: the merged array mixes vendors).</item>
///   <item><see cref="Project"/> — the row's IDENTITY and its `select` address. A project is identified by its
///   NAME (with the vendor); `select` re-resolves it on whichever live instance has it open (CODESYS: its serving
///   pipe; TwinCAT: the running window whose solution holds that project). No instance handle: two projects opened
///   under the same name at once are indistinguishable — the same limit the workspace binding already has.</item>
///   <item><see cref="Version"/> — the IDE version, shown in the row's label.</item>
///   <item><see cref="Status"/> — the row's full connection state, the ONE self-describing field: "idle" (detected,
///   not served), "healthy" (served, channel OK), "degraded" (served, recent channel errors). "Is it serving"
///   derives from this (<c>status != "idle"</c>) — there is no separate serving flag. At most one row per bridge is
///   non-idle; all rows are "idle" while the bridge is paused/disconnected. (CODESYS is in-proc → never degrades.)</item>
///   <item><see cref="Dirty"/> — the project has unsaved changes in the IDE.</item>
/// </list>
/// Detection is identity-only: the top-level project, never the PLC applications inside it (a content concern the
/// sync ops resolve lazily).</summary>
public sealed record ProjectEntry(
    string Vendor,
    string? Version,
    string Project,
    string Status,
    bool Dirty);

/// <summary>The <c>connect</c> request: which project the connector picked, by NAME. May be null (a soft/refresh
/// select); the driver binds what it can. No vendor field — the connector routes to the right bridge/pipe by the
/// row's vendor before sending this. No PLC-app field — connecting is identity-only.</summary>
public sealed class ConnectRequest
{
    public string? Project { get; set; }
}
