using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using VoltBridge.Core;

namespace VoltBridge.Codesys.Adapters;

/// <summary>
/// CODESYS Scripting Engine adapter — wraps the CODESYS .NET API.
/// Installed as a CODESYS package (add-in), runs in-process with the IDE.
/// </summary>
public class CodesysAdapter : IAdapter
{
    private readonly BlockingCollection<Action> _staQueue = new();
    private volatile bool _isDegraded;
    private string? _degradedReason;

    public bool IsConnected { get; private set; }
    public bool IsDegraded => _isDegraded;
    public string? DegradedReason => _degradedReason;
    public string Version { get; } = "1.0.0";

    public string? IdeName => "CODESYS";
    public string? IdeVersion => "3.5";
    public string? ProjectName => "CODESYS Project";
    public string? PlcProjectName => "Device.Application";

    public void Connect() => IsConnected = true;
    public void Disconnect() { IsConnected = false; _isDegraded = false; _degradedReason = null; }

    public void RunStaMessageLoop(CancellationToken token) { }
    public T RunOnStaThread<T>(Func<T> fn) => fn();

    public void MarkDegraded(string reason) { if (!_isDegraded) Console.Error.WriteLine($"[DEGRADED] {reason}"); _isDegraded = true; _degradedReason = reason; }
    public void ClearDegraded() { if (_isDegraded) Console.Error.WriteLine("[DEGRADED] cleared"); _isDegraded = false; _degradedReason = null; }

    // ── Tree Walking ──────────────────────────────────────────────

    public List<TreeItemVisit> WalkAllItems(HashSet<string>? onlyNames = null) => new();

    public dynamic GetPlcProjectRoot() => null!;

    public dynamic? LookupItemByName(string name) => null;

    // ─── Item type mapping ─────────────────────────────────────────

    public string? MapItemType(int typeCode, bool isTopLevelCrud) => null;

    // ─── Health ────────────────────────────────────────────────────

    public void TriggerAsyncProbe() { }

    public object BuildHealthResponse() => new
    {
        status = IsConnected ? "healthy" : "unavailable",
        platform = "codesys",
        platformVariant = (string?)null,
        connected = IsConnected,
        ideAlive = IsConnected,
        degraded = _isDegraded,
        degradedReason = _degradedReason,
        ideName = IdeName,
        ideVersion = IdeVersion,
        version = Version,
        projectName = ProjectName,
        plcProjectName = PlcProjectName,
        projectDirty = false,
    };

    // ── IAdapter implementation ────────────────────────────────────

    public string ReadDeclaration(dynamic item) => "";
    public string ReadImplementation(dynamic item) => "";
    public int GetItemType(dynamic item) => 0;
    public int GetChildCount(dynamic item) => 0;
    public dynamic GetChildAt(dynamic parent, int index) => null!;
    public string? ExportItemBodyAsXml(dynamic item, string itemName) => null;

    public string ComputeItemVersion(dynamic item, string folderPath) => "";

    public string ComputeProjectVersion(Dictionary<string, string> versions)
    {
        if (versions.Count == 0) return "";
        using var sha = SHA1.Create();
        foreach (var (name, version) in versions.OrderBy(kv => kv.Key))
            sha.TransformBlock(Encoding.UTF8.GetBytes($"{name}={version}\0"), 0, Encoding.UTF8.GetByteCount($"{name}={version}\0"), null, 0);
        sha.TransformFinalBlock(Array.Empty<byte>(), 0, 0);
        return Convert.ToHexString(sha.Hash!).ToLowerInvariant()[..16];
    }

    public string ComputeStructureVersion(Dictionary<string, string> versions)
    {
        if (versions.Count == 0) return "";
        using var sha = SHA1.Create();
        foreach (var name in versions.Keys.OrderBy(n => n))
            sha.TransformBlock(Encoding.UTF8.GetBytes($"{name}\0"), 0, Encoding.UTF8.GetByteCount($"{name}\0"), null, 0);
        sha.TransformFinalBlock(Array.Empty<byte>(), 0, 0);
        return Convert.ToHexString(sha.Hash!).ToLowerInvariant()[..16];
    }

    public dynamic CreateChild(dynamic parent, string name, int itemType) => null!;
    public void WriteSourceText(dynamic item, string declaration, string implementation) { }
    public void DeleteChild(dynamic parent, string name) { }
    public void RenameItem(dynamic item, string newName) { }
    public void FlushPendingWrites() { }
    public bool Build() => true;
    public List<object> GetBuildDiagnostics() => new();
}

public record TreeItemVisit(string Name, dynamic Item, int ItemType, bool IsTopLevelCrud, string FolderPath);
