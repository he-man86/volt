using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Bridge.Core.Ide;
using Volt.Bridge.Core.Wire;
using Volt.Bridge.Core.Workspace;

namespace Volt.Bridge.Tests;

/// <summary>
/// A reusable in-memory <see cref="IIdeDriver"/> for the sync services (RefsService / FetchService / PushService)
/// — no live bridge. Items are configured up front; <see cref="ItemRef.Native"/> is the item's bare name. Most of
/// the surface is no-op/throw; only the project-tree walk + the read transports the services actually exercise are
/// real. A "malformed" graphical item models the failure that once orphaned <c>/refs</c>: BodyLanguage says LD but
/// the PLCopen export has no FBD/LD body, so <c>GraphicalCode.Read</c> throws when it's materialized.
/// </summary>
public sealed class FakeIde : IIdeDriver
{
    public sealed record Item(
        string Name, int KindCode, string Folder, bool IsTopLevel,
        string? Declaration, string? Implementation, string? BodyLang, string? Xml,
        string[]? Children = null, bool ExcludeFromBuild = false)
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

    // ── IProjectTree (only the walk + accessors the services use are real) ──
    public IReadOnlyList<ProjectItem> WalkItems() =>
        _items.Select(i => new ProjectItem(i.Name, new ItemRef(i.Name), i.KindCode, i.IsTopLevel, i.Folder, i.ExcludeFromBuild)).ToList();
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
    public void WriteText(ItemRef item, string? declaration, string implementation) => Recorded.Add($"write:{(string)item.Native}");
    public string? BodyLanguage(ItemRef item) => Find(item).BodyLang;
    public string ReadXml(ItemRef item) => Find(item).Xml ?? throw new InvalidOperationException("no XML for " + Find(item).Name);
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
    public HealthResponse BuildHealthResponse() => new HealthResponse();
    public bool ShouldMarkDegraded(Exception ex) => false;
    public T RunOnStaThread<T>(Func<T> fn) => fn();
    public void FlushPendingWrites() { }
    public bool Build() => true;
    public IReadOnlyList<BridgeDiagnostic> GetBuildDiagnostics() => new List<BridgeDiagnostic>();
    /// <summary>Library element signatures the fetch's verbose fold will render + fold under each owning
    /// library's folder(s). Set per-test; empty by default.</summary>
    public IReadOnlyList<Volt.Bridge.Core.Library.LibSignature> LibSignatures { get; init; } =
        new List<Volt.Bridge.Core.Library.LibSignature>();
    public IReadOnlyList<Volt.Bridge.Core.Library.LibSignature> ExtractLibrarySignatures() => LibSignatures;
    public IReadOnlyList<IReadOnlyDictionary<string, string>> DebugLibrarySignatures(string? nameFilter) =>
        System.Array.Empty<IReadOnlyDictionary<string, string>>();

    /// <summary>The project POUs CODESYS "compiled" (reachable). Null (default) ⇒ can't determine → the fetch omits
    /// nothing. Set per-test to exercise the `omitDeadCode` flag.</summary>
    public ISet<string>? CompiledPous { get; init; }
    public ISet<string>? GetCompiledPouNames() => CompiledPous;
}
