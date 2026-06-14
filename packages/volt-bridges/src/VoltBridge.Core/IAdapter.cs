using System;
using System.Collections.Generic;
using VoltBridge.Core.Models;

namespace VoltBridge.Core;

public record TreeItemVisit(string Name, dynamic Item, int ItemType, bool IsTopLevelCrud, string FolderPath);

/// <summary>A graphical (FBD/LD/SFC/CFC) body rendered to read-only ST.
/// <paramref name="Language"/> is FBD/LD/SFC/CFC; <paramref name="St"/> is the
/// transpiled body (CODESYS: its own GetImplementationSnippet; TwinCAT: the shared
/// FbdTranspiler over the parsed NWL XmlArchive).</summary>
public sealed record GraphicalBody(string Language, string St);

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

    // ── Version computation ─────────────────────────────────────────
    string ComputeItemVersion(dynamic item, string folderPath);
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

    // ── Config Manifest ───────────────────────────────────────────────
    string ReadManifestText(dynamic item, string kind);

    // ── Build ───────────────────────────────────────────────────────
    void FlushPendingWrites();
    bool Build();
    List<object> GetBuildDiagnostics();
}
