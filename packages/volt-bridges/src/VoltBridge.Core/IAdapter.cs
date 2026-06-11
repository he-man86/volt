using System;
using System.Collections.Generic;

namespace VoltBridge.Core;

public record TreeItemVisit(string Name, dynamic Item, int ItemType, bool IsTopLevelCrud, string FolderPath);

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
    object BuildHealthResponse();

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
    string? ExportItemBodyAsXml(dynamic item, string itemName);

    // ── Config Manifest ───────────────────────────────────────────────
    string ReadManifestText(dynamic item, string kind);

    // ── Build ───────────────────────────────────────────────────────
    void FlushPendingWrites();
    bool Build();
    List<object> GetBuildDiagnostics();
}
