using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using Volt.Bridge.Core.Diagnostics;
using Volt.Bridge.Core.Ide;
using Volt.Bridge.Core.Library;
using Volt.Bridge.Core.Wire;
using Volt.Bridge.Core.Workspace;

namespace Volt.Cli.Tests;

/// <summary>
/// A reusable in-memory <see cref="IIdeDriver"/> for the pipe host + sync tests — volt-cli's own copy of the
/// bridge's FakeIde (the test double moves in-house with the port), plus a health knob (Connected/Platform/
/// ProjectName) so command tests can present a "connected" bridge that passes binding checks.
/// </summary>
public sealed class FakeIde : IIdeDriver
{
    public sealed record Item(
        string Name, int KindCode, string Folder, bool IsTopLevel,
        string? Declaration, string? Implementation, string? BodyLang, string? Xml,
        string[]? Children = null)
    {
        public static Item TextualPou(string name, string decl, string impl, string folder = "") =>
            new Item(name, ItemKind.PlcPouProg, folder, true, decl, impl, null, null);
    }

    private readonly List<Item> _items;
    public FakeIde(params Item[] items) => _items = items.ToList();
    private Item Find(ItemRef r) => _items.First(i => i.Name == (string)r.Native);
    private Item? FindOrNull(ItemRef r) => _items.FirstOrDefault(i => i.Name == (string)r.Native);

    public List<string> Recorded { get; } = new();

    // ── health knob (drives BuildHealthResponse for binding/pull tests) ──
    public bool HealthConnected { get; init; }
    public string HealthPlatform { get; init; } = "";
    public string? HealthProjectName { get; init; }

    // ── IProjectTree ──
    public IReadOnlyList<ProjectItem> WalkItems() =>
        _items.Select(i => new ProjectItem(i.Name, new ItemRef(i.Name), i.KindCode, i.IsTopLevel, i.Folder)).ToList();
    public int KindCode(ItemRef item) => Find(item).KindCode;
    public int ChildCount(ItemRef item) => FindOrNull(item)?.Children?.Length ?? 0;
    public string Name(ItemRef item) => Find(item).Name;
    public ItemRef? Lookup(string name) => _items.Any(i => i.Name == name) ? new ItemRef(name) : (ItemRef?)null;
    public string PlcRootName { get; init; } = "<root>";
    public string TreeRootName { get; init; } = "<root>";
    public ItemRef GetPlcProjectRoot() => new ItemRef(PlcRootName);
    public ItemRef GetTreeRoot() => new ItemRef(TreeRootName);
    public ItemRef ChildAt(ItemRef parent, int index1Based) => new ItemRef(Find(parent).Children![index1Based - 1]);
    public (bool getter, bool setter) InterfacePropertyAccessors(ItemRef property)
    {
        var kids = FindOrNull(property)?.Children ?? Array.Empty<string>();
        return (kids.Any(k => k.Equals("Get", StringComparison.OrdinalIgnoreCase)),
                kids.Any(k => k.Equals("Set", StringComparison.OrdinalIgnoreCase)));
    }
    public ItemRef Parent(ItemRef item) => new ItemRef("<root>");
    public ItemRef CreateChild(ItemRef parent, string name, int kindCode, string? language = null) { Recorded.Add($"create:{name}"); return new ItemRef(name); }
    public void Delete(ItemRef parent, string name) => Recorded.Add($"delete:{name}");
    public void Rename(ItemRef item, string newName)
    {
        var old = (string)item.Native;
        Recorded.Add($"rename:{old}->{newName}");
        var idx = _items.FindIndex(i => i.Name == old);
        if (idx >= 0) _items[idx] = _items[idx] with { Name = newName };
    }

    // ── ICodeStore ──
    public string ReadDeclaration(ItemRef item) => Find(item).Declaration ?? "";
    public string ReadImplementation(ItemRef item) => Find(item).Implementation ?? "";
    public void WriteText(ItemRef item, string? declaration, string? implementation) => Recorded.Add($"write:{(string)item.Native}");
    public string? BodyLanguage(ItemRef item) => Find(item).BodyLang;
    public string ReadXml(ItemRef item)
    {
        var it = Find(item);
        if (it.Xml != null) return it.Xml;
        const string ns = "http://www.plcopen.org/xml/tc6_0200";
        var pouType = it.KindCode switch
        {
            ItemKind.PlcPouProg => "program",
            ItemKind.PlcPouFb => "functionBlock",
            ItemKind.PlcPouFunc => "function",
            ItemKind.PlcItf => "interface",
            _ => "functionBlock",
        };
        var xml = $"<pou name=\"{it.Name}\" pouType=\"{pouType}\" xmlns=\"{ns}\">";
        if (!string.IsNullOrEmpty(it.Declaration))
            xml += $"<addData><data><InterfaceAsPlainText><xhtml>{Escape(it.Declaration)}</xhtml></InterfaceAsPlainText></data></addData>";
        xml += "<body>";
        if (!string.IsNullOrEmpty(it.Implementation))
        {
            var lang = it.BodyLang ?? "ST";
            xml += $"<{lang}>{Escape(it.Implementation)}</{lang}>";
        }
        else if (!string.IsNullOrEmpty(it.BodyLang)) xml += $"<{it.BodyLang}/>";
        xml += "</body></pou>";
        return xml;
    }

    private static string Escape(string s) => System.Net.WebUtility.HtmlEncode(s);
    public void WriteXml(ItemRef item, string xml) { }
    public string ReadManifest(ItemRef item, string kind) => Find(item).Declaration ?? "";

    // ── IIdeSession ──
    public bool IsConnected => true;
    public string? IdeName => "Fake";
    public string? IdeVersion => "0";
    public string Version => "test";
    public void Connect() { }
    public void Disconnect() { }
    public bool IsDegraded => false;
    public string? DegradedReason => null;
    public void MarkDegraded(string reason) { }
    public void ClearDegraded() { }
    public void TriggerAsyncProbe() { }
    public HealthResponse BuildHealthResponse() => new HealthResponse
    {
        Connected = HealthConnected,
        Platform = HealthPlatform,
        ProjectName = HealthProjectName,
        Status = HealthConnected ? "healthy" : "unavailable",
    };
    public bool ShouldMarkDegraded(Exception ex) => false;
    public T RunOnStaThread<T>(Func<T> fn) => fn();
    public void FlushPendingWrites() { }
    public bool Build() => true;
    public IReadOnlyList<BridgeDiagnostic> GetBuildDiagnostics() => new List<BridgeDiagnostic>();

    public IReadOnlyList<LibSignature> LibSignatures { get; init; } = new List<LibSignature>();
    public ManualResetEventSlim? ExtractEntered { get; init; }
    public ManualResetEventSlim? ExtractBlock { get; init; }
    public IReadOnlyList<LibSignature> ExtractLibrarySignatures()
    {
        ExtractEntered?.Set();
        ExtractBlock?.Wait();
        return LibSignatures;
    }
    public IReadOnlyList<IReadOnlyDictionary<string, string>> DebugLibrarySignatures(string? nameFilter) =>
        Array.Empty<IReadOnlyDictionary<string, string>>();
    public string DebugItemXml(string name) => "";
    public string DebugReflect(string target) => "";
}
