using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using VoltBridge.Core;
using VoltBridge.Core.Fbd;
using VoltBridge.Core.Models;

namespace VoltBridge.Codesys
{
    /// <summary>
    /// Real CODESYS adapter. Enumerates the tree through the scripting objects but
    /// reads/writes ALL source text and classifies kinds through the .NET OBJECT
    /// MODEL (<see cref="CodesysObjectModel"/>) — the API a compiled package uses.
    /// Symmetric with BeckhoffAdapter; only the IDE-access mechanism differs.
    ///
    /// Every model touch is marshaled onto the CODESYS primary thread via
    /// <see cref="RunOnStaThread{T}"/> (the HttpBridgeServer wraps each handler in
    /// it); <see cref="Connect"/> runs on the scripting thread at startup.
    /// </summary>
    public sealed class CodesysAdapter : AdapterBase, IAdapter
    {
        private readonly CodesysObjectModel _om;
        private readonly CodesysDispatcher? _dispatcher;

        private readonly object _cacheLock = new();
        private string? _projectName;
        private bool _projectDirty;
        private bool _probeInFlight;

        public CodesysAdapter(object? projects, object? system, object? online)
        {
            _om = new CodesysObjectModel(projects);
            _dispatcher = CodesysDispatcher.TryCreate();
        }

        // ── Connection ──────────────────────────────────────────────────────
        public bool IsConnected => _dispatcher != null && _om.HasProjects && _om.HasObjectManager;
        public string? IdeName => "CODESYS";
        public string? IdeVersion => "3.5";

        public void Connect()
        {
            // Runs on the scripting (primary) thread at startup — snapshot now.
            lock (_cacheLock) { _projectName = _om.ProjectName; _projectDirty = _om.ProjectDirty; }
        }

        public void Disconnect() => ClearDegraded();

        // ── Threading ───────────────────────────────────────────────────────
        public T RunOnStaThread<T>(Func<T> fn)
        {
            if (_dispatcher == null) return fn(); // no IDE engine — run inline (degraded)
            return _dispatcher.Run(fn);
        }

        // In-process: no transport that can die mid-call, so never auto-degrade
        // (degraded-state plumbing itself is inherited from AdapterBase).
        public override bool ShouldMarkDegraded(Exception ex) => false;

        // ── Health ──────────────────────────────────────────────────────────
        public HealthResponse BuildHealthResponse()
        {
            string? name; bool dirty;
            lock (_cacheLock) { name = _projectName; dirty = _projectDirty; }
            TriggerAsyncProbe();
            return BuildHealth("codesys", IsConnected, ideAlive: _dispatcher != null,
                IdeName, IdeVersion, projectName: name, plcProjectName: name, projectDirty: dirty);
        }

        public void TriggerAsyncProbe()
        {
            lock (_cacheLock) { if (_probeInFlight) return; _probeInFlight = true; }
            Task.Run(() =>
            {
                try
                {
                    var (n, d) = RunOnStaThread(() => (_om.ProjectName, _om.ProjectDirty));
                    lock (_cacheLock) { _projectName = n; _projectDirty = d; }
                }
                catch { }
                finally { lock (_cacheLock) _probeInFlight = false; }
            });
        }

        // ── Tree walking ────────────────────────────────────────────────────
        public List<TreeItemVisit> WalkAllItems(HashSet<string>? onlyNames = null)
        {
            // onlyNames is a hint only — we always walk the whole tree and let the
            // caller (Fetch/Push) filter. An early-stop optimization mis-handles deep
            // CODESYS trees (it returned nothing for folder-nested items), and the
            // full walk is required anyway to compute project/structure versions.
            var items = new List<TreeItemVisit>();
            var root = _om.PrimaryProject;
            if (root == null) return items;
            WalkInner(root, "", items);
            return items;
        }

        private void WalkInner(object node, string folderPath, List<TreeItemVisit> items)
        {
            foreach (var child in _om.GetChildren(node))
            {
                var name = _om.GetName(child);
                var code = GetItemType(child);

                if (code == ItemKind.Folder)
                {
                    var nested = string.IsNullOrEmpty(folderPath) ? name : $"{folderPath}/{name}";
                    WalkInner(child, nested, items);
                    continue;
                }
                if (CodesysTypeMap.IsRecurseOnlyContainer(code))
                {
                    // Device / Plc Logic / Application / Task Configuration: descend
                    // without adding to the path. (Task Configuration's ITaskObject
                    // children surface as individual `task` items, matching TwinCAT.)
                    WalkInner(child, folderPath, items);
                    continue;
                }
                if (CodesysTypeMap.IsSkipped(code)) continue;     // transient/hidden/unknown — phantom-free
                if (ItemKind.IsInlinedInPou(code)) continue;      // collected inside the POU

                var isCrud = ItemKind.IsTopLevelCrud(code);
                items.Add(new TreeItemVisit(name, child, code, isCrud, folderPath));
                // Source items are NOT recursed: a POU's methods/actions are part of
                // its own source (SourceAssembler collects them via GetChildCount/At).
                // Non-source leaves (task, visualization, …) are opaque — recursing
                // would surface a task's POU-call refs etc. as duplicates.

                // The Library Manager additionally yields its individual library
                // references as flat `library` items (they aren't tree objects), so
                // the agent sees each referenced library — matching TwinCAT.
                if (code == ItemKind.LibraryManager)
                    foreach (var lib in _om.GetLibraryRefs(child))
                        items.Add(new TreeItemVisit(lib.Name, lib, ItemKind.Library, false, folderPath));
            }
        }

        public int GetItemType(dynamic item)
        {
            var node = (object)item;
            if (node is LibRefNode) return ItemKind.Library;
            if (_om.IsFolder(node)) return ItemKind.Folder;
            var iobj = _om.ReadObject(node);
            var ifaces = _om.ObjectInterfaceNames(iobj);
            string? decl = ifaces.Contains("IPOUObject") || ifaces.Contains("IDUTObject")
                ? CodesysObjectModel.ReadAspectText(iobj, "Interface") : null;
            return CodesysTypeMap.CodeForObject(ifaces, false, _om.GetName(node), decl);
        }

        public override string ReadDeclaration(dynamic item) =>
            (object)item is LibRefNode lib ? lib.Manifest : _om.ReadDeclaration((object)item);
        public override string ReadImplementation(dynamic item) =>
            (object)item is LibRefNode ? "" : _om.ReadImplementation((object)item);

        // ── POU children (read): methods / actions / properties for SourceAssembler ─
        public int GetChildCount(dynamic item) => _om.GetChildren((object)item).Count;
        // 1-based to match the shared SourceAssembler/PushHandler convention.
        public dynamic GetChildAt(dynamic parent, int index) => _om.GetChildren((object)parent)[index - 1];

        // Version hashing + MapItemType are inherited from AdapterBase (shared parity).

        // ── Non-source / graphical (read) ───────────────────────────────────
        /// <summary>FBD/LD/SFC/CFC child → read-only ST via CODESYS's own renderer
        /// (Implementation.GetImplementationSnippet), export-free. Null for textual.</summary>
        public override GraphicalBody? ReadGraphicalBody(dynamic item)
        {
            object? iobj = (object?)_om.ReadObject((object)item);
            if (iobj is null) return null;
            dynamic? impl;
            try { impl = ((dynamic)iobj).Implementation; } catch { return null; }
            if (impl is null) return null;
            string view;
            try { view = (string)(impl.DefaultViewMode ?? ""); } catch { return null; }
            var lang = view.ToUpperInvariant();
            // CFC/SFC use different body models we don't transpile yet — emit the marker
            // only (read-only + push-safe), parity with the TwinCAT reader.
            if (lang is "CFC" or "SFC") return new GraphicalBody(lang, "");
            if (lang is not ("FBD" or "LD")) return null;                     // ST / IL → textual
            string snippet;
            try { snippet = (string)(impl.GetImplementationSnippet() ?? ""); } catch { snippet = ""; }
            return new GraphicalBody(lang, FbdSnippet.CleanImplementation(snippet));
        }

        public string ReadManifestText(dynamic item, string kind) =>
            (object)item is LibRefNode lib ? lib.Manifest : $"{kind}\n";   // library refs carry a real manifest; others staged

        // ── Write path (object model) ───────────────────────────────────────
        public dynamic GetPlcProjectRoot() =>
            _om.FindApplication() ?? throw new InvalidOperationException("CODESYS: no Application found in project");

        public dynamic? LookupItemByName(string name) => _om.FindByName(name);

        public void WriteSourceText(dynamic item, string declaration, string implementation) =>
            _om.WriteSourceText((object)item, declaration, implementation);

        public dynamic CreateChild(dynamic parent, string name, int itemType) =>
            _om.CreateChild((object)parent, name, itemType);

        public void DeleteChild(dynamic parent, string name) => _om.DeleteChild((object)parent, name);
        public void RenameItem(dynamic item, string newName) => _om.Rename((object)item, newName);
        public dynamic GetParent(dynamic item) => _om.ParentOf((object)item)!;
        public string GetItemName(dynamic item) =>
            (object)item is LibRefNode lib ? lib.Name : _om.GetName((object)item);
        public void FlushPendingWrites() { /* writes commit immediately via SetObject */ }

        // ── build ───────────────────────────────────────────────────────────
        public bool Build() =>
            _om.Build(_om.FindApplication() ?? throw new InvalidOperationException("CODESYS: no Application to build"));
        public List<object> GetBuildDiagnostics() => _om.GetBuildDiagnostics();
    }
}
