using System;
using System.Collections.Generic;
using VoltBridge.Core.Models;

namespace VoltBridge.Core;

public record TreeItemVisit(string Name, dynamic Item, int ItemType, bool IsTopLevelCrud, string FolderPath);

/// <summary>A graphical (FBD/LD/SFC/CFC) body rendered to text. <paramref name="Language"/> is
/// FBD/LD/SFC/CFC. <paramref name="Format"/> is <c>"vg"</c> when <paramref name="Body"/> is the
/// editable VG language (round-trippable to the IDE — CODESYS FBD/LD), or <c>"st"</c> when it is
/// read-only transpiled ST (SFC/CFC, and all TwinCAT graphical bodies today). <paramref name="Declaration"/>,
/// when non-null, is the POU's declaration recovered from the SAME PLCopen export as the body — so a
/// graphical POU's declaration is read WITHOUT a separate object-model aspect access (that access on a
/// just-reimported POU damages its in-session graphical export).</summary>
public sealed record GraphicalBody(string Language, string Body, string Format = "st", string? Declaration = null);

public interface IAdapter
{
    // ── Connection ─────────────────────────────────────────────────
    bool IsConnected { get; }
    string? IdeName { get; }
    string? IdeVersion { get; }
    string Version { get; }
    void Connect();
    void Disconnect();

    // ── Health / degraded ───────────────────────────────────────────
    bool IsDegraded { get; }
    string? DegradedReason { get; }
    void MarkDegraded(string reason);
    void ClearDegraded();
    void TriggerAsyncProbe();
    HealthResponse BuildHealthResponse();
    /// <summary>Vendor hook: should this transport/RPC exception flip the adapter
    /// to degraded? (Beckhoff: dead-COM HRESULTs; CODESYS in-proc: never.)</summary>
    bool ShouldMarkDegraded(Exception ex);

    // ── Threading ───────────────────────────────────────────────────
    T RunOnStaThread<T>(Func<T> fn);

    // ── Tree walking ────────────────────────────────────────────────
    List<TreeItemVisit> WalkAllItems(HashSet<string>? onlyNames = null);
    dynamic GetPlcProjectRoot();
    dynamic? LookupItemByName(string name);
    string? MapItemType(int typeCode, bool isTopLevelCrud);

    // ── Version aggregation ─────────────────────────────────────────
    // Per-item versions are content hashes of the materialized text (Hasher.ComputeItemVersion over
    // SourceAssembler.Materialize), computed in the handlers — NOT here, since the adapter has no
    // item name/kind. These two aggregate the resulting {name → version} map.
    string ComputeProjectVersion(Dictionary<string, string> versions);
    string ComputeStructureVersion(Dictionary<string, string> versions);

    // ── CRUD ────────────────────────────────────────────────────────
    dynamic CreateChild(dynamic parent, string name, int itemType);
    void WriteSourceText(dynamic item, string declaration, string implementation);
    void DeleteChild(dynamic parent, string name);
    void RenameItem(dynamic item, string newName);
    string ReadDeclaration(dynamic item);
    string ReadImplementation(dynamic item);
    int GetItemType(dynamic item);
    int GetChildCount(dynamic item);
    dynamic GetChildAt(dynamic parent, int index);
    dynamic GetParent(dynamic item);
    string GetItemName(dynamic item);
    /// <summary>Read a child's graphical (FBD/LD/SFC/CFC) body as read-only ST, or null
    /// if the item is textual (ST/IL). Used by SourceAssembler to materialize graphical
    /// children with a (* @volt-graphical: LANG *) marker instead of dropping them.</summary>
    GraphicalBody? ReadGraphicalBody(dynamic item);

    /// <summary>Raw PLCopenXML export of an item's whole POU — the exact bytes the IDE emits, for
    /// corpus capture / coverage diagnostics (the <c>/raw</c> route), NOT the normal pull path.
    /// Null if the adapter can't export it. Default: null.</summary>
    string? ExportRawPou(dynamic item);

    /// <summary>Write an editable VG ("@volt-graphical: LANG vg") body back to a graphical item:
    /// parse VG → graph → PLCopenXML → import into the IDE. <paramref name="declaration"/> is the
    /// POU's declaration, used to resolve FB instance types (VG doesn't carry them). Throws on
    /// non-convertible VG (the push is then rejected). Adapters that can't write graphical bodies
    /// throw NotSupportedException (default).</summary>
    void WriteGraphicalBody(dynamic item, string vgText, string declaration);

    // ── Config Manifest ───────────────────────────────────────────────
    string ReadManifestText(dynamic item, string kind);

    // ── Build ───────────────────────────────────────────────────────
    void FlushPendingWrites();
    bool Build();
    List<object> GetBuildDiagnostics();
}
