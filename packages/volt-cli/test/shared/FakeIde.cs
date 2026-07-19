using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using Volt.Engine.Diagnostics;
using Volt.Engine.Ide;
using Volt.Engine.Library;
using Volt.Engine.Wire;
using Volt.Engine.Workspace;

namespace Volt.Cli.Tests;

/// <summary>
/// The single in-memory <see cref="IIdeDriver"/> test double for the whole toolchain — the service tests
/// (RefsService / FetchService / PushService, in Volt.Engine.Tests), the pipe host + command tests (in
/// Volt.Cli.Tests), and the black-box CLI all drive this one fake. It is compiled into each test assembly via a
/// linked <c>&lt;Compile&gt;</c> to <c>test/shared/FakeIde.cs</c>, so there is exactly one definition to keep true.
///
/// Items are configured up front; <see cref="ItemRef.Native"/> is the item's bare name. Most of the surface is
/// no-op/throw; only the project-tree walk + the read transports the services actually exercise are real. Writes
/// are RECORDED, not applied — apply-dispatch tests assert on <see cref="Recorded"/>. To model an engineer editing
/// the IDE out from under the workspace (the push-conflict scenario), use <see cref="MutateImplementation"/> /
/// <see cref="AddItem"/> / <see cref="RemoveItem"/>, which change the walked state so the recomputed versions
/// (and thus the projectVersion lease) diverge from the workspace's baseline.
/// </summary>
public sealed class FakeIde : IIdeDriver
{
    public sealed record Item(
        string Name, int KindCode, string Folder, bool IsTopLevel,
        string? Declaration, string? Implementation, string? BodyLang, string? Xml,
        string[]? Children = null)
    {
        /// <summary>A plain textual (ST) POU — materializes via the declaration/implementation transports.</summary>
        public static Item TextualPou(string name, string decl, string impl, string folder = "") =>
            new Item(name, ItemKind.PlcPouProg, folder, true, decl, impl, null, null);

        /// <summary>A graphical POU whose export has NO FBD/LD body — <c>GraphicalCode.Read</c> throws on it, the
        /// same way the orphaned LD POU bricked <c>/refs</c>.</summary>
        public static Item MalformedGraphical(string name, string folder = "") =>
            new Item(name, ItemKind.PlcPouProg, folder, true, null, null, "LD",
                "<project xmlns=\"http://www.plcopen.org/xml/tc6_0200\"><types><pous /></types></project>");

        /// <summary>A referenced-library ref (`.library`). Its body IS its manifest (LIBRARY/NAMESPACE/RESOLUTION/…),
        /// carried here in <c>Declaration</c> and returned by <c>ReadManifest</c>; the default folder is the shared
        /// Library Manager, where CODESYS reports library refs.</summary>
        public static Item Library(string name, string manifest, string folder = "Library Manager") =>
            new Item(name, ItemKind.PlcLibRef, folder, true, manifest, null, null, null);
    }

    private readonly List<Item> _items;
    public FakeIde(params Item[] items) => _items = items.ToList();
    private Item Find(ItemRef r) => _items.First(i => i.Name == (string)r.Native);
    // Tolerant lookup: refs that never entered _items (a freshly CreateChild'd POU, a folder, "<root>") have
    // no children — return 0 rather than throw, matching the pre-children hard-coded ChildCount => 0.
    private Item? FindOrNull(ItemRef r) => _items.FirstOrDefault(i => i.Name == (string)r.Native);

    /// <summary>Mutations recorded for apply-dispatch tests: create:/delete:/rename:/write: entries.</summary>
    public List<string> Recorded { get; } = new();

    // ── test hooks: mutate the IDE OUT FROM UNDER a seeded workspace ─────────────────────────────────
    // These change the walked state (not Recorded) so a subsequent /refs or push-lease check sees a different
    // projectVersion — the "the IDE changed since your last sync" divergence the workspace never applied.

    /// <summary>Replace an item's implementation in place — models an engineer editing its body in the IDE.</summary>
    public void MutateImplementation(string name, string implementation)
    {
        var idx = _items.FindIndex(i => i.Name == name);
        if (idx < 0) throw new InvalidOperationException($"no item named '{name}' to mutate");
        _items[idx] = _items[idx] with { Implementation = implementation };
    }

    /// <summary>Add a brand-new item — models the engineer creating an object in the IDE.</summary>
    public void AddItem(Item item) => _items.Add(item);

    /// <summary>Remove an item — models the engineer deleting an object in the IDE.</summary>
    public void RemoveItem(string name) => _items.RemoveAll(i => i.Name == name);

    // ── health knob (drives BuildHealthResponse for binding/pull tests) ──
    public bool HealthConnected { get; init; }
    public string HealthPlatform { get; init; } = "";
    public string? HealthProjectName { get; init; }

    // ── IProjectTree (only the walk + accessors the services use are real) ──
    public IReadOnlyList<ProjectItem> WalkItems() =>
        _items.Select(i => new ProjectItem(i.Name, new ItemRef(i.Name), i.KindCode, i.IsTopLevel, i.Folder)).ToList();
    public int KindCode(ItemRef item) => Find(item).KindCode;
    public int ChildCount(ItemRef item) => FindOrNull(item)?.Children?.Length ?? 0;
    public string Name(ItemRef item) => Find(item).Name;
    public ItemRef? Lookup(string name) => _items.Any(i => i.Name == name) ? new ItemRef(name) : (ItemRef?)null;
    // Both default to the same synthetic root, so the whole tree is flat. A test that models a spine (the tree
    // root ABOVE the PLC-project root, e.g. CODESYS Device/Plc Logic/Application) sets these apart to prove push
    // descends the full path from the tree root instead of re-creating the spine under the PLC-project root.
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
        if (idx >= 0) _items[idx] = _items[idx] with { Name = newName }; // so a follow-up Lookup(newName) resolves
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
        // Auto-generate valid PLCopen XML for POU items — like the real IDE does.
        // Non-POU items should never reach here (Materializer only calls ReadXml for POUs).
        var ns = "http://www.plcopen.org/xml/tc6_0200";
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
        else if (!string.IsNullOrEmpty(it.BodyLang))
        {
            xml += $"<{it.BodyLang}/>";
        }
        xml += "</body>";
        if (it.Children is { Length: > 0 })
        {
            foreach (var childName in it.Children)
            {
                var child = _items.FirstOrDefault(i => i.Name == childName);
                if (child == null) continue;
                xml += BuildChildXml(child, ns);
            }
        }
        xml += "</pou>";
        return xml;
    }

    private static string BuildChildXml(Item child, string ns)
    {
        var type = child.KindCode switch
        {
            ItemKind.PlcMethod or ItemKind.PlcItfMeth => "method",
            ItemKind.PlcAction or ItemKind.PlcTrans => "action",
            _ => "method",
        };
        var xml = $"<pou name=\"{child.Name}\" pouType=\"{type}\">";
        if (!string.IsNullOrEmpty(child.Declaration))
            xml += $"<addData><data><InterfaceAsPlainText><xhtml>{Escape(child.Declaration)}</xhtml></InterfaceAsPlainText></data></addData>";
        xml += "<body>";
        if (!string.IsNullOrEmpty(child.Implementation))
        {
            var lang = child.BodyLang ?? "ST";
            xml += $"<{lang}>{Escape(child.Implementation)}</{lang}>";
        }
        else if (!string.IsNullOrEmpty(child.BodyLang))
        {
            // Graphical body with empty text — CFC/SFC marker
            xml += $"<{child.BodyLang}/>";
        }
        xml += "</body></pou>";
        return xml;
    }

    private static string Escape(string s) => System.Net.WebUtility.HtmlEncode(s);
    public void WriteXml(ItemRef item, string xml) { }
    public string ReadManifest(ItemRef item, string kind) => Find(item).Declaration ?? "";

    // ── IIdeSession (session boilerplate; no-op/sensible defaults) ──
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

    // ── instances / select knobs (the connector's discovery + selection ops) ──
    public InstancesResult Instances { get; set; } = new(new List<IdeInstance>());
    public SelectRequest? Selected { get; private set; }
    public InstancesResult EnumerateInstances() => Instances;
    public void SelectProject(SelectRequest sel) => Selected = sel;

    public void FlushPendingWrites() { }

    // ── build knob: default to a clean build; a test sets BuildSucceeds=false + BuildDiagnostics to model errors ──
    public bool BuildSucceeds { get; init; } = true;
    public IReadOnlyList<BridgeDiagnostic> BuildDiagnostics { get; init; } = new List<BridgeDiagnostic>();
    public bool Build() => BuildSucceeds;
    public IReadOnlyList<BridgeDiagnostic> GetBuildDiagnostics() => BuildDiagnostics;

    /// <summary>Library element signatures the fetch's verbose fold will render + fold under each owning
    /// library's folder(s). Set per-test; empty by default.</summary>
    public IReadOnlyList<LibSignature> LibSignatures { get; init; } = new List<LibSignature>();
    // Optional test hooks to hold a mutation IN FLIGHT: extraction signals it has been entered, then blocks until
    // released — lets a test observe /health while the op runs (extraction is the FIRST thing a verbose /init does).
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
