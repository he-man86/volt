using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Volt.Cli.Core.Workspace;

namespace Volt.Cli.Ide.Codesys
{
    /// <summary>
    /// Access to the live CODESYS project through the .NET OBJECT MODEL — the same
    /// API a compiled package/plugin uses — reached in-process. This is the sound,
    /// fast path proven by the POC and lifted (via decompilation) from CODESYS's own
    /// <c>ScriptDriverProjects</c>:
    /// <code>
    ///   IObject o = ObjectMgr.GetObjectToRead(handle, guid).Object;
    ///   decl = o.Interface.TextDocument.Text;   impl = o.Implementation.TextDocument.Text;
    /// </code>
    /// The IronPython scripting objects (<c>projects</c>) are used ONLY to enumerate
    /// the tree (their <c>get_children</c>/<c>get_name</c>/<c>guid</c>/<c>handle</c>
    /// are real .NET members); ALL source-text I/O and kind classification go through
    /// the object model. NO IronPython-injected members (e.g. <c>textual_declaration</c>),
    /// NO export/serialization. Reflection-only, so this one binary loads in any 3.5.x.
    /// </summary>
    internal sealed class CodesysObjectModel
    {
        private const BindingFlags BF = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;

        // Placeholder type CODESYS requires at create-time for a function (return_type) / alias (baseType);
        // immaterial because WriteSourceText immediately sets the real declaration (and type) afterward.
        private const string SeedType = "INT";

        private readonly object? _projects;
        private readonly object? _objMgr;   // _3S.CoDeSys.Core.Objects.IObjectManager (SystemInstances.ObjectMgr)

        public CodesysObjectModel(object? projects)
        {
            _projects = projects;
            _objMgr = GetStaticMember("_3S.CoDeSys.Core.SystemInstances", "ObjectMgr");
        }

        public bool HasProjects => _projects != null;
        public bool HasObjectManager => _objMgr != null;
        // Whether a project is actually OPEN — a live lookup (unlike HasProjects, which only checks the
        // persistent projects collection). Must be read on the primary thread; the driver caches the result so
        // health can report it off-thread. This is what makes a project close/reopen reflect correctly.
        public bool HasPrimaryProject => PrimaryProject != null;

        // ── tree navigation (typed-.NET members on the scripting objects) ──────
        public object? PrimaryProject => Unwrap(GetMember(_projects, "primary"));

        public string? ProjectPath
        {
            get { var p = PrimaryProject; return p == null ? null : GetMember(p, "path") as string; }
        }
        public string? ProjectName
        {
            get { var path = ProjectPath; return string.IsNullOrEmpty(path) ? null : System.IO.Path.GetFileNameWithoutExtension(path); }
        }
        public bool ProjectDirty
        {
            get { var p = PrimaryProject; return p != null && GetMember(p, "dirty") is bool b && b; }
        }

        public IReadOnlyList<object> GetChildren(object node)
        {
            var list = new List<object>();
            var r = InvokeMethod(Unwrap(node), "get_children", false)
                    ?? InvokeMethod(Unwrap(node), "get_children");
            if (r is IEnumerable e)
                foreach (var x in e) { var u = Unwrap(x); if (u != null) list.Add(u); }
            return list;
        }

        public string GetName(object node) =>
            InvokeMethod(Unwrap(node), "get_name", false) as string
            ?? InvokeMethod(Unwrap(node), "get_name") as string
            ?? "";

        public bool IsFolder(object node) => GetMember(Unwrap(node), "is_folder") is bool b && b;
        public Guid GuidOf(object node) => GetMember(Unwrap(node), "guid") is Guid g ? g : Guid.Empty;
        public int HandleOf(object node) => GetMember(Unwrap(node), "handle") is int h ? h : 0;

        /// <summary>True when the node is EFFECTIVELY excluded from the build (inheritance-aware: a folder
        /// excluded from build excludes its subtree). Reads the ScriptObject's `effectively_excluded_from_build`,
        /// falling back to `build_properties.exclude_from_build`, else false (fail-open — an item we cannot
        /// classify is treated as built and still checked).</summary>
        public bool IsExcludedFromBuild(object node)
        {
            var n = Unwrap(node);
            if (GetMember(n, "effectively_excluded_from_build") is bool eff) return eff;
            var bp = GetMember(n, "build_properties");
            if (bp != null && GetMember(bp, "exclude_from_build") is bool ex) return ex;
            return false;
        }

        /// <summary>Diagnostic (/debug spike): report which build-exclusion members exist on the ScriptObject
        /// and their raw values, so the reflection path can be confirmed against a live IDE.</summary>
        public string ExcludeProbe(object node)
        {
            var n = Unwrap(node);
            string eff;
            try { eff = GetMember(n, "effectively_excluded_from_build")?.ToString() ?? "<null>"; }
            catch (Exception e) { eff = "<threw: " + e.Message + ">"; }
            string ex;
            try { var bp = GetMember(n, "build_properties"); ex = bp == null ? "<no build_properties>" : (GetMember(bp, "exclude_from_build")?.ToString() ?? "<null>"); }
            catch (Exception e) { ex = "<threw: " + e.Message + ">"; }
            return $"effectively_excluded_from_build={eff}; build_properties.exclude_from_build={ex}";
        }

        // ── object model: resolve a tree node to its IObject ───────────────────
        /// <summary>The object-model <c>IObject</c> for read (cheap, no serialization).</summary>
        public object? ReadObject(object node)
        {
            if (_objMgr == null) return null;
            var meta = InvokeMethod(_objMgr, "GetObjectToRead", HandleOf(node), GuidOf(node));
            // INTENTIONAL, load-bearing: the returned IMetaObject (a READ checkout) is deliberately
            // NOT released. Disposing/releasing it invalidates the .Object IObject for every subsequent
            // read — a dispose attempt was tried and BROKE all following reads, so it was reverted. We
            // keep only .Object and let the checkout lapse with the object; the per-read cost is accepted.
            // (Contrast WriteSourceText, which MUST close its WRITE transaction via SetObject.)
            return GetMember(meta, "Object") ?? meta;   // .Object is an explicit IMetaObject member
        }

        /// <summary>Names of the <c>I*Object</c> interfaces the IObject implements —
        /// the GUID-free classification basis (mirrors CODESYS's own type checks).</summary>
        public HashSet<string> ObjectInterfaceNames(object? iobject)
        {
            var set = new HashSet<string>(StringComparer.Ordinal);
            if (iobject == null) return set;
            foreach (var i in iobject.GetType().GetInterfaces()) set.Add(i.Name);
            return set;
        }

        // ── DEBUG: reflect the change-detection surface (read-only investigation) ──
        /// <summary>Dump the type / interfaces / change-related members of a target object-model member, to see
        /// what "changed" signal CODESYS exposes (a modification stamp, a version, a change event). READ-ONLY.</summary>
        public string ReflectMembers(string target)
        {
            object? obj = target switch
            {
                "objmgr" => _objMgr,
                "object" => SampleObject(),
                _ => PrimaryProject,
            };
            if (obj == null) return $"<null target: {target}>";
            var t = obj.GetType();
            var sb = new System.Text.StringBuilder();
            sb.AppendLine($"TARGET {target}");
            sb.AppendLine($"TYPE {t.FullName}");
            foreach (var i in t.GetInterfaces()) sb.AppendLine($"IFACE {i.FullName}");
            foreach (var e in t.GetEvents()) sb.AppendLine($"EVENT {e.Name} : {e.EventHandlerType?.Name}");
            foreach (var p in t.GetProperties()) if (Relevant(p.Name)) sb.AppendLine($"PROP {p.Name} : {p.PropertyType.Name}");
            foreach (var m in Distinct(t.GetMethods())) if (Relevant(m)) sb.AppendLine($"METHOD {m}");
            foreach (var i in t.GetInterfaces())
            {
                foreach (var e in i.GetEvents()) sb.AppendLine($"IFACE-EVENT {i.Name}.{e.Name}");
                foreach (var p in i.GetProperties()) if (Relevant(p.Name)) sb.AppendLine($"IFACE-PROP {i.Name}.{p.Name}");
                foreach (var m in Distinct(i.GetMethods())) if (Relevant(m)) sb.AppendLine($"IFACE-METHOD {i.Name}.{m}");
            }
            return sb.ToString();
        }

        private object? SampleObject()
        {
            var p = PrimaryProject;
            if (p == null) return null;
            var kids = GetChildren(p);
            return kids.Count > 0 ? ReadObject(kids[0]) : null;
        }

        private static System.Collections.Generic.IEnumerable<string> Distinct(System.Reflection.MethodInfo[] ms)
        {
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var m in ms) if (seen.Add(m.Name)) yield return m.Name;
        }

        private static bool Relevant(string n)
        {
            foreach (var k in new[] { "change", "modif", "dirty", "version", "timestamp", "date", "event", "listen", "subscribe", "notify", "stamp", "revision", "save" })
                if (n.IndexOf(k, StringComparison.OrdinalIgnoreCase) >= 0) return true;
            return false;
        }

        // ── library references (LibManObject → ILibManItem[]) ──────────────────
        /// <summary>The top-level library references managed by a Library Manager
        /// object. These are NOT tree <c>IObject</c>s (no handle/guid/source) — they
        /// live in the <c>ILibManObject</c> collection — so each is surfaced as a
        /// synthetic <see cref="LibRefNode"/> the adapter emits as a `library` item,
        /// matching TwinCAT's flat library refs. Read-only (no push target).</summary>
        public List<LibRefNode> GetLibraryRefs(object libManNode)
        {
            var iobj = ReadObject(libManNode);
            if (iobj == null) return new List<LibRefNode>();

            // GetAllLibraries lives on the base ILibManObject; invoke via the
            // interface MethodInfo so explicit implementations dispatch correctly.
            var libManIface = Array.Find(iobj.GetType().GetInterfaces(), i => i.Name == "ILibManObject");
            var getAll = libManIface?.GetMethod("GetAllLibraries");
            if (getAll?.Invoke(iobj, new object[] { false }) is not IEnumerable items) return new List<LibRefNode>();

            // FLAT: each library once (top-level references + their transitive dependencies, deduped by
            // namespace|name). Transitive deps carry namespaces the source references DIRECTLY (e.g. `MEM` from CAA
            // Memory, pulled in as a hidden dependency) — without them those qualified roots resolve nowhere in the
            // LSP. The dependency HIERARCHY is captured WITHOUT duplication: each ref's manifest lists its DIRECT
            // dependencies by name (a `DEPENDENCIES` line in ToLibRef), so the tree is reconstructable while every
            // library — and its signatures — materialize exactly once. Best-effort per node (read-only metadata).
            var byName = new Dictionary<string, LibRefNode>(StringComparer.OrdinalIgnoreCase);
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            void Walk(object item)
            {
                string ns, nm;
                try { ns = GetMember(item, "Namespace") as string ?? ""; nm = GetMember(item, "Name") as string ?? ""; }
                catch { return; }
                if (!seen.Add(ns + "|" + nm)) return; // cycle / re-reference guard (logical key, not instance)
                try { var r = ToLibRef(item); byName[r.Name] = r; } catch { /* skip a malformed ref */ }
                if (InvokeMethod(item, "GetDependencies") is IEnumerable deps)
                    foreach (var d in deps) if (d != null) Walk(d);
            }
            foreach (var item in items) if (item != null) Walk(item);
            return byName.Values.ToList();
        }

        /// <summary>The display name of a library ref — the placeholder name for a placeholder, else its Name. Used
        /// for the ref's own name AND its dependency names, so a `DEPENDENCIES` entry matches the flat ref it names.</summary>
        private static string RefDisplayName(object item)
        {
            var name = GetMember(item, "Name") as string ?? "";
            if (item.GetType().GetInterfaces().Any(i => i.Name == "IPlaceholderLibManItem"))
            {
                var ph = GetMember(item, "PlaceholderName") as string;
                if (!string.IsNullOrEmpty(ph)) return ph!;
            }
            return name;
        }

        private static LibRefNode ToLibRef(object item)
        {
            var ns = GetMember(item, "Namespace") as string ?? "";
            var system = GetMember(item, "SystemLibrary") is bool b && b;
            var isPlaceholder = item.GetType().GetInterfaces().Any(i => i.Name == "IPlaceholderLibManItem");
            var name = RefDisplayName(item);
            var resolution = isPlaceholder
                ? (ManagedLibDisplay(GetMember(item, "EffectiveResolution")) ?? GetMember(item, "DefaultResolution") as string ?? "")
                : name;   // managed refs carry "Name, Version (Company)" in Name

            // DIRECT dependencies, by display name — the dependency tree captured as a REFERENCE (the deps live once
            // in the flat list; following these names rebuilds the hierarchy, with no signature duplication).
            var deps = new List<string>();
            if (InvokeMethod(item, "GetDependencies") is IEnumerable ds)
                foreach (var d in ds)
                    if (d != null) { string dn = ""; try { dn = RefDisplayName(d); } catch { } if (dn.Length > 0) deps.Add(dn); }

            // Deterministic manifest — the fetch body AND the version-hash input. Built by the SHARED Core
            // formatter so CODESYS and TwinCAT emit the same canonical shape.
            var manifest = Volt.Cli.Core.Library.LibraryManifest.Build(name, ns, resolution, isPlaceholder, system, deps);
            return new LibRefNode(name, manifest);
        }

        private static string? ManagedLibDisplay(object? managedLib)
        {
            if (managedLib == null) return null;
            var disp = GetMember(managedLib, "DisplayName") as string;
            if (!string.IsNullOrEmpty(disp)) return disp;
            var title = GetMember(managedLib, "Title") as string ?? "";
            var ver = GetMember(managedLib, "Version")?.ToString() ?? "";
            var s = (title + " " + ver).Trim();
            return string.IsNullOrEmpty(s) ? null : s;
        }

        // ── source text (object model: aspect → ITextDocument.Text) ────────────
        public string ReadDeclaration(object node) => ReadAspectText(ReadObject(node), "Interface");
        public string ReadImplementation(object node) => ReadAspectText(ReadObject(node), "Implementation");

        public static string ReadAspectText(object? iobject, string aspectName)
        {
            var aspect = GetMember(iobject, aspectName);          // ITextVarDeclObject / ISTImplementationObject
            if (aspect == null) return "";
            var doc = GetMember(aspect, "TextDocument");          // ITextDocument
            if (doc == null) return "";
            return GetMember(doc, "Text") as string ?? "";
        }

        // ── source text (write) — the inverse, one GetObjectToModify/SetObject
        //    transaction per object (same as ScriptDriverProjects internally) ────
        public void WriteSourceText(object node, string? declaration, string? implementation)
        {
            if (_objMgr == null) throw new InvalidOperationException("CODESYS ObjectManager unavailable");
            var meta = InvokeMethod(_objMgr, "GetObjectToModify", HandleOf(node), GuidOf(node))
                       ?? throw new InvalidOperationException("GetObjectToModify returned null");
            var iobj = GetMember(meta, "Object");
            try
            {
                if (declaration != null) SetAspectText(iobj, "Interface", declaration);
                if (implementation != null) SetAspectText(iobj, "Implementation", implementation);
                InvokeMethod(_objMgr, "SetObject", meta, true, null);   // commit
            }
            catch
            {
                // Roll back the checkout (SetObject with success=false). Swallow ITS error on purpose:
                // we rethrow the ORIGINAL write failure below — that's the diagnostic the caller needs,
                // not a secondary rollback error that would mask it.
                try { InvokeMethod(_objMgr, "SetObject", meta, false, null); } catch { }
                throw;
            }
        }

        private static void SetAspectText(object? iobject, string aspectName, string text)
        {
            var aspect = GetMember(iobject, aspectName);
            if (aspect == null) return;                            // object has no such aspect (e.g. GVL has no impl)
            var doc = GetMember(aspect, "TextDocument");
            if (doc == null) return;
            SetMember(doc, "Text", text);
        }

        // ── structural ─────────────────────────────────────────────────────────
        /// <summary>The Application node — default parent for new POUs.</summary>
        public object? FindApplication() => FindByObjectInterface(PrimaryProject, "IApplicationObject", 0);

        public object? FindByName(string name) => FindByName(PrimaryProject, name, 0);

        private object? FindByName(object? node, string name, int depth)
        {
            if (node == null || depth > 14) return null;
            foreach (var child in GetChildren(node))
            {
                // Prefer a real (non-transient) object with this name.
                if (string.Equals(GetName(child), name, StringComparison.Ordinal) && !IsTransient(child))
                    return child;
                var hit = FindByName(child, name, depth + 1);
                if (hit != null) return hit;
            }
            return null;
        }

        private object? FindByObjectInterface(object? node, string ifaceName, int depth)
        {
            if (node == null || depth > 14) return null;
            foreach (var child in GetChildren(node))
            {
                if (!IsFolder(child) && ObjectInterfaceNames(ReadObject(child)).Contains(ifaceName)) return child;
                var hit = FindByObjectInterface(child, ifaceName, depth + 1);
                if (hit != null) return hit;
            }
            return null;
        }

        private bool IsTransient(object node)
        {
            if (IsFolder(node)) return false;
            var ifaces = ObjectInterfaceNames(ReadObject(node));
            return ifaces.Contains("ITransientObject") || ifaces.Contains("IHiddenObject");
        }

        public object? ParentOf(object node) => GetMember(Unwrap(node), "parent");

        // ── device descriptor ───────────────────────────────────────────────
        /// <summary>The vendor-neutral device descriptor for a device-tree instance — the same fields CODESYS
        /// shows on a device's Information tab (Name/Vendor/Type/ID/Version/Order number/Description), read from
        /// the device-repository <c>DeviceInfo</c> + <c>get_device_identification</c>. No build needed. This is
        /// the read-only <c>.device</c> file body (the extension identifies the kind — no marker needed); the LSP
        /// registers the instance NAME (the filename) as a known global so source references resolve, without
        /// pretending to know the device's internal members.</summary>
        public string DeviceDescriptor(object node)
        {
            var dev = Facet(node, "ScriptDeviceObject");
            var info = GetMember(InvokeMethod(dev, "GetReadable"), "DeviceInfo");
            var devId = InvokeMethod(dev, "get_device_identification");
            string Field(object? o, params string[] names)
            {
                foreach (var n in names) { var v = GetMember(o, n); var s = v == null ? null : System.Convert.ToString(v); if (!string.IsNullOrEmpty(s)) return s!.Replace("\r", "").Replace("\n", " ").Trim(); }
                return "";
            }
            var sb = new System.Text.StringBuilder();
            void Line(string key, string val) { if (!string.IsNullOrEmpty(val)) sb.Append(key.PadRight(14)).Append(val).Append('\n'); }
            Line("Name:", Field(info, "Name"));
            Line("Vendor:", Field(info, "Vendor"));
            Line("Type:", Field(devId, "Type", "TypeId", "type"));
            Line("ID:", Field(devId, "Id", "Identification", "id"));
            Line("Version:", Field(devId, "Version", "version"));
            Line("Order number:", Field(info, "OrderNumber"));
            Line("Description:", Field(info, "Description"));
            return sb.ToString();
        }

        /// <summary>The read-only descriptor for the project's "Project Information" node — the standard
        /// <c>IProjectInfoObject</c> metadata (Title/Version/Company/Author/Namespace/Description) CODESYS shows
        /// in Project → Project Information, read from its <c>ScriptProjectInfo</c> facet. The <c>.projectinfo</c>
        /// file body; not referenced by source, so the LSP just carries it as project context.</summary>
        public string ProjectInfoDescriptor(object node) => FacetDescriptor(node, "ScriptProjectInfo",
            ("Title", "title"), ("Version", "version"), ("Company", "company"), ("Author", "author"),
            ("Default namespace", "default_namespace"), ("Released", "released"), ("Description", "description"));

        /// <summary>A trace/recording configuration (`.trace`): which task/trigger/resolution records what.
        /// Read from the `ScriptTraceObject` facet. The per-diagram traced-variable expressions are not exposed
        /// as scripting properties, so this captures the recording config (the reproducible part).</summary>
        public string TraceDescriptor(object node) => FacetDescriptor(node, "ScriptTraceObject",
            ("Task", "task_name"), ("Record", "record_name"), ("Resolution", "resolution"),
            ("Post-trigger samples", "post_trigger_samples"), ("Every N cycles", "every_n_cycles"),
            ("Auto start", "auto_start"), ("Trigger enabled", "trigger_enabled"),
            ("Trigger variable", "trigger_variable"), ("Comment", "comment"));

        /// <summary>The read-only descriptor for a task (`.task`): its scheduling — task type, cycle interval,
        /// priority, watchdog, and the POUs it calls each cycle. Read from the `ScriptTaskObject` facet (whose
        /// `watchdog` is a nested object and `pous` yields the called-POU names). The `.task` file body; not
        /// referenced by source, so the LSP carries it as project context ("PLC_PRG runs on MainTask @ t#20ms").</summary>
        public string TaskDescriptor(object node)
        {
            var f = Facet(node, "ScriptTaskObject");
            var sb = new System.Text.StringBuilder();
            void Line(string label, string? value)
            {
                if (!string.IsNullOrWhiteSpace(value)) sb.Append((label + ":").PadRight(11)).Append(value!.Trim()).Append('\n');
            }

            Line("Type", System.Convert.ToString(GetMember(f, "kind_of_task")));
            Line("Interval", Unitize(GetMember(f, "interval"), GetMember(f, "interval_unit")));
            Line("Priority", System.Convert.ToString(GetMember(f, "priority")));
            // Event-triggered tasks carry the triggering (external) event variable; empty for cyclic/freewheeling.
            var ev = System.Convert.ToString(GetMember(f, "event"));
            if (string.IsNullOrWhiteSpace(ev)) ev = System.Convert.ToString(GetMember(f, "external_event"));
            Line("Event", ev);

            var wd = GetMember(f, "watchdog");
            if (wd != null && GetMember(wd, "enabled") is bool on && on)
                Line("Watchdog", $"{Unitize(GetMember(wd, "time"), GetMember(wd, "time_unit"))} (sensitivity {System.Convert.ToString(GetMember(wd, "sensitivity"))?.Trim()})");
            else
                Line("Watchdog", "off");

            // The POUs this task calls each cycle (ScriptPouObjectList yields the POU names, in call order).
            // (helper below appends the unit only when the value is a bare number — an interval already
            //  rendered as a TIME literal like `t#20ms` carries its own unit and is left untouched.)
            if (GetMember(f, "pous") is IEnumerable pous)
            {
                var names = new List<string>();
                foreach (var p in pous) { var n = System.Convert.ToString(p)?.Trim(); if (!string.IsNullOrEmpty(n)) names.Add(n!); }
                if (names.Count > 0) Line("Calls", string.Join(", ", names));
            }
            return sb.ToString();
        }

        /// <summary>Append a unit to a value ONLY when the value is a bare number (digits/sign/dot). A value
        /// already rendered as a TIME literal (`t#20ms`) or otherwise carrying letters is returned unchanged,
        /// so `interval`/`watchdog.time` read unambiguously whether the facet returns `t#20ms` or `3` + `ms`.</summary>
        private static string Unitize(object? value, object? unit)
        {
            var v = (System.Convert.ToString(value) ?? "").Trim();
            var u = (System.Convert.ToString(unit) ?? "").Trim();
            if (v.Length == 0) return "";
            var bare = v.All(c => char.IsDigit(c) || c == '.' || c == '-' || c == '+');
            return bare && u.Length > 0 ? $"{v} {u}" : v;
        }

        /// <summary>The symbol-configuration flags (`.symbols`): which access features a project exposes
        /// (OPC UA, direct I/O, attribute filter). The resolved exposed-symbol LIST is compiled-model state,
        /// not in the scripting facet — this captures the configuration.</summary>
        public string SymbolConfigDescriptor(object node) => FacetDescriptor(node, "ScriptSymbolConfigObject",
            ("Features", "content_feature_flags"), ("Direct I/O access", "enable_direct_io_access"),
            ("Attribute filter", "symbol_attribute_filter_type"));

        /// <summary>A recipe definition (`.recipe`): the list of PLC variables the recipe reads/writes, each as
        /// `variable : type (recipe column name)`. Read from the `ScriptRecipeDefinitionObject` facet.</summary>
        public string RecipeDescriptor(object node)
        {
            var f = Facet(node, "ScriptRecipeDefinitionObject");
            var sb = new System.Text.StringBuilder();
            if (GetMember(f, "variables") is IEnumerable vars)
                foreach (var v in vars)
                {
                    if (v == null) continue;
                    var name = System.Convert.ToString(GetMember(v, "variablename"))?.Trim() ?? "";
                    if (name.Length == 0) continue;
                    var type = System.Convert.ToString(GetMember(v, "type"))?.Trim() ?? "";
                    var col = System.Convert.ToString(GetMember(v, "name"))?.Trim() ?? "";
                    sb.Append(name);
                    if (type.Length > 0) sb.Append(" : ").Append(type);
                    if (col.Length > 0) sb.Append("  (").Append(col).Append(')');
                    sb.Append('\n');
                }
            return sb.ToString();
        }

        /// <summary>Render a node's read-only descriptor from ONE scripting facet's scalar properties as
        /// aligned `Label: value` lines (empty values omitted). Shared by the project-info / trace / symbol
        /// descriptors — the device descriptor stays bespoke (it reads two facets).</summary>
        private string FacetDescriptor(object node, string facetName, params (string Label, string Prop)[] fields)
        {
            var f = Facet(node, facetName);
            var pad = 0;
            foreach (var fld in fields) pad = System.Math.Max(pad, fld.Label.Length);
            var sb = new System.Text.StringBuilder();
            foreach (var fld in fields)
            {
                var v = GetMember(f, fld.Prop);
                var s = v == null ? "" : (System.Convert.ToString(v)?.Replace("\r", "").Replace("\n", " ").Trim() ?? "");
                if (s.Length > 0) sb.Append((fld.Label + ":").PadRight(pad + 2)).Append(s).Append('\n');
            }
            return sb.ToString();
        }

        /// <summary>A named scripting facet of a node — device / project-info APIs live on the Extender's DLR
        /// extension list, not the base ScriptObject. Throws if the facet is absent (fail loud, no fallback).</summary>
        private object Facet(object node, string facetTypeName)
        {
            var ext = GetMember(Unwrap(node), "Extender");
            if (GetMember(ext, "Extensions") is IEnumerable facets)
                foreach (var f in facets)
                    if (f != null && f.GetType().Name == facetTypeName) return f;
            throw new InvalidOperationException($"node has no {facetTypeName} facet");
        }

        // ── build / diagnostics ─────────────────────────────────────────────
        private static readonly Guid BuildActiveApplication = new Guid("A0DA4287-64ED-459e-81F0-98AB3667A58F");

        /// <summary>Compile the application by executing the IDE's "build active
        /// application" command (same as the scripting <c>app.build()</c>), then
        /// report success from the diagnostics (no error-severity messages).</summary>
        public bool Build(object applicationNode)
        {
            var cmdMgr = GetStaticMember("_3S.CoDeSys.ScriptDriverProjects.Common", "CommandManager")
                         ?? throw new InvalidOperationException("CODESYS CommandManager unavailable");
            var appGuid = GuidOf(applicationNode);
            InvokeMethod(cmdMgr, "ExecuteCommand", BuildActiveApplication,
                new[] { "--applicationGuid=" + appGuid.ToString() });
            foreach (var d in GetBuildDiagnostics())
                if (d is Dictionary<string, object?> dict && (dict["severity"] as string) == "error") return false;
            return true;
        }

        public List<object> GetBuildDiagnostics()
        {
            var outv = new List<object>();
            var store = GetStaticMember("_3S.CoDeSys.ScriptDriverSystem.APEnvironment", "MessageStorage");
            if (store == null) return outv;
            // GetMessages takes an IMessageCategory; enumerate all categories.
            if (GetMember(store, "Categories") is not IEnumerable categories) return outv;
            foreach (var cat in categories)
            {
                if (InvokeMethod(store, "GetMessages", cat) is not IEnumerable msgs) continue;
                foreach (var m in msgs)
                {
                    var text = GetMember(m, "Text") as string ?? "";
                    outv.Add(new Dictionary<string, object?>
                    {
                        ["severity"] = SeverityToString(GetMember(m, "Severity")),
                        ["message"] = text,
                        ["line"] = ParseLine(text),
                        ["column"] = ParseColumn(text),
                    });
                }
            }
            return outv;
        }


        // ── library signature extraction (referenced-library declarations from the resolved language model) ──

        /// <summary>Extract the SIGNATURE (declaration, no body) of every referenced-library element. Precompiles the
        /// libraries (best-effort build), then reads their precompiled <c>ISignature</c>s from
        /// <c>SystemInstances.LanguageModelMgr.AllPrecompiledSignatures</c> — the same DLL the IDE's Library Manager
        /// renders from, and the same reflection the rest of the bridge uses. Vendor libraries only; system libraries
        /// are dropped by the caller. Filters compiler-mangled entries (<c>__</c>-prefixed) and non-library objects.</summary>
        public List<Volt.Cli.Core.Library.LibSignature> ExtractLibrarySignatures()
        {
            // Ensure the libraries are PRECOMPILED: a freshly-opened project has an EMPTY precompiled set until a
            // build runs, so AllPrecompiledSignatures returns nearly nothing (verified: 2 sigs before a build, 5220
            // after). Build best-effort — even a FAILING app build (headless device/library mismatch) still
            // precompiles the referenced libraries, which is all we need. Libraries precompile independently of the
            // app, so this works whether or not the app build itself succeeds.
            var app = FindApplication();
            if (app != null) { try { Build(app); } catch { /* a failed build still precompiles the libraries */ } }

            var lmm = GetStaticMember("_3S.CoDeSys.Core.SystemInstances", "LanguageModelMgr")
                      ?? throw new InvalidOperationException("CODESYS: LanguageModelMgr unavailable");
            // `AllPrecompiledSignatures(true,true)` returns every resolved LIBRARY signature — libraries precompile
            // independently of the application, so this yields their declarations even when the app build fails (a
            // headless env with an unresolvable placeholder library still precompiles the resolvable libs). Verified
            // live: 5220–5406 fully-typed sigs across the real corpora.
            if (InvokeMethod(lmm, "AllPrecompiledSignatures", true, true) is not IEnumerable sigs)
                throw new InvalidOperationException("CODESYS: AllPrecompiledSignatures returned nothing");

            List<Volt.Cli.Core.Library.LibVar> Vars(object? sig, string prop)
            {
                var outv = new List<Volt.Cli.Core.Library.LibVar>();
                if (GetMember(sig, prop) is not IEnumerable coll) return outv;
                foreach (var v in coll)
                {
                    if (GetMember(v, "Name") is not string n || n.Length == 0) continue;
                    var init = GetMember(v, "Initial")?.ToString();
                    outv.Add(new Volt.Cli.Core.Library.LibVar(n, GetMember(v, "Type")?.ToString() ?? "BOOL",
                        string.IsNullOrEmpty(init) ? null : init));
                }
                return outv;
            }

            var result = new List<Volt.Cli.Core.Library.LibSignature>();
            foreach (var s in sigs)
            {
                if (GetMember(s, "IsLibraryObject") as bool? != true) continue;
                var name = GetMember(s, "Name") as string;
                if (string.IsNullOrEmpty(name) || name!.Contains("__")) continue;
                var libPath = GetMember(s, "LibraryPath") as string ?? "";
                var baseName = GetMember(GetMember(s, "BaseSignature"), "Name") as string;
                // The DUT sub-kind flag ("Alias"/"Union"/…). An alias is one unnamed variable whose Type is the
                // base; capture it directly (Vars drops empty-name vars). Its Type may be a `__`-system type.
                var flags = GetMember(s, "Flags")?.ToString() ?? "";
                string? aliasBase = null;
                if (flags.Contains("Alias") && GetMember(s, "AllVariables") is IEnumerable av)
                    foreach (var v in av) { aliasBase = GetMember(v, "Type")?.ToString(); break; }
                result.Add(new Volt.Cli.Core.Library.LibSignature(
                    name, libPath, GetMember(s, "POUType")?.ToString() ?? "",
                    Vars(s, "Inputs"), Vars(s, "Outputs"), Vars(s, "InOuts"), Vars(s, "AllVariables"),
                    baseName, GetMember(s, "ReturnType")?.ToString(), aliasBase, flags));
            }
            return result;
        }

        /// <summary>DEBUG (read-only): dump every library signature's implemented COM interfaces + all property
        /// values, optionally filtered by element name. Lets us see how the live language model represents a DUT
        /// (alias vs struct vs enum vs union) and where an alias's base type lives — the ground truth for fixing
        /// the signature renderer. Not part of pull/push.</summary>
        public List<Dictionary<string, string>> DebugLibrarySignatures(string? nameFilter)
        {
            var app = FindApplication();
            if (app != null) { try { Build(app); } catch { /* a failed build still precompiles the libraries */ } }
            var lmm = GetStaticMember("_3S.CoDeSys.Core.SystemInstances", "LanguageModelMgr");
            var outList = new List<Dictionary<string, string>>();
            if (InvokeMethod(lmm, "AllPrecompiledSignatures", true, true) is not IEnumerable sigs) return outList;
            // `?libsig=summary` → count of precompiled signatures per owning LibraryPath (which libs have NO sigs).
            var summary = string.Equals(nameFilter, "summary", StringComparison.OrdinalIgnoreCase);
            var counts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            foreach (var s in sigs)
            {
                if (s == null) continue;
                if (GetMember(s, "Name") is not string name || name.Length == 0) continue;
                if (summary)
                {
                    var lp = GetMember(s, "LibraryPath") as string ?? "(none)";
                    counts[lp] = counts.TryGetValue(lp, out var c) ? c + 1 : 1;
                    continue;
                }
                if (!string.IsNullOrEmpty(nameFilter) && !name.Equals(nameFilter, StringComparison.OrdinalIgnoreCase)) continue;
                var d = new Dictionary<string, string>
                {
                    ["Name"] = name,
                    ["<interfaces>"] = string.Join(", ", s.GetType().GetInterfaces().Select(i => i.Name)),
                };
                var seen = new HashSet<string>();
                foreach (var t in new[] { s.GetType() }.Concat(s.GetType().GetInterfaces()))
                    foreach (var p in t.GetProperties())
                    {
                        if (p.GetIndexParameters().Length > 0 || !seen.Add(p.Name)) continue;
                        try { d[p.Name] = p.GetValue(s)?.ToString() ?? "null"; }
                        catch (Exception e) { d[p.Name] = "<err:" + e.GetType().Name + ">"; }
                    }
                // Expand the variable collections as name:type — the alias base / struct fields / enum members
                // live here, so we can see what `OkName` drops and where a base type is carried.
                foreach (var coll in new[] { "AllVariables", "Inputs", "Outputs", "InOuts", "Locals" })
                {
                    if (GetMember(s, coll) is not IEnumerable vs) continue;
                    var parts = new List<string>();
                    foreach (var v in vs)
                        parts.Add($"{GetMember(v, "Name")}:{GetMember(v, "Type")}");
                    d[coll + "[]"] = string.Join(", ", parts);
                }
                // Dump the FIRST member's full property map — the enum-member VALUE (init) lives here somewhere.
                if (GetMember(s, "AllVariables") is IEnumerable avs)
                    foreach (var v in avs)
                    {
                        if (v == null) continue;
                        var mp = new List<string>();
                        var mseen = new HashSet<string>();
                        foreach (var t in new[] { v.GetType() }.Concat(v.GetType().GetInterfaces()))
                            foreach (var p in t.GetProperties())
                                if (p.GetIndexParameters().Length == 0 && mseen.Add(p.Name))
                                { try { mp.Add($"{p.Name}={p.GetValue(v)}"); } catch { } }
                        d["member0.props"] = string.Join(" | ", mp);
                        break;
                    }
                outList.Add(d);
            }
            if (summary)
                return counts.OrderByDescending(kv => kv.Value)
                    .Select(kv => new Dictionary<string, string> { ["lib"] = kv.Key, ["count"] = kv.Value.ToString() }).ToList();
            return outList;
        }

        private static string SeverityToString(object? sev)
        {
            var s = sev?.ToString() ?? "";
            if (s.IndexOf("Error", StringComparison.OrdinalIgnoreCase) >= 0
                || s.IndexOf("Fatal", StringComparison.OrdinalIgnoreCase) >= 0
                || s.IndexOf("Exception", StringComparison.OrdinalIgnoreCase) >= 0) return "error";
            if (s.IndexOf("Warning", StringComparison.OrdinalIgnoreCase) >= 0) return "warning";
            return "info";
        }

        private static int ParseLine(string text)
        {
            var i = text.IndexOf("Line ", StringComparison.OrdinalIgnoreCase);
            if (i < 0) return 0;
            i += 5; int n = 0; bool any = false;
            while (i < text.Length && char.IsDigit(text[i])) { n = n * 10 + (text[i] - '0'); i++; any = true; }
            return any ? n : 0;
        }

        private static int ParseColumn(string text)
        {
            foreach (var prefix in new[] { "Column ", "Col ", "Pos ", "Position " })
            {
                var i = text.IndexOf(prefix, StringComparison.OrdinalIgnoreCase);
                if (i < 0) continue;
                i += prefix.Length; int n = 0; bool any = false;
                while (i < text.Length && char.IsDigit(text[i])) { n = n * 10 + (text[i] - '0'); i++; any = true; }
                if (any) return n;
            }
            return 0;
        }

        /// <summary>Create a child object under <paramref name="parent"/> via the IEC
        /// container's typed scripting factory (create_pou/create_dut/…). Returns the
        /// new node; the caller writes its text via <see cref="WriteSourceText"/>.</summary>
        public object CreateChild(object parent, string name, int itemType, string? language = null)
        {
            // Folders are created on the tree object itself. The object create_folder
            // returns is NOT a usable container parent (creating a POU under it throws
            // a NullReferenceException) — re-fetch the freshly-created folder as a real
            // tree node so the caller can create children inside it.
            if (itemType == ItemKind.PlcFolder)
            {
                InvokeMethod(Unwrap(parent), "create_folder", name);
                foreach (var child in GetChildren(parent))
                    if (string.Equals(GetName(child), name, StringComparison.Ordinal) && IsFolder(child))
                        return child;
                throw new InvalidOperationException($"CODESYS: folder '{name}' not found after create_folder");
            }

            // Everything else goes through the IEC language container — the same
            // .NET class CODESYS uses (factory + ObjectMgr.AddObject); we construct
            // it from the parent's ScriptObject and call its typed create_*.
            var c = IecContainer(parent);
            switch (itemType)
            {
                case ItemKind.PlcPouProg: return Create(c, "create_pou", name, EnumValue("PouType", "Program"));
                // A function REQUIRES a non-null return_type at create; CODESYS errors without one. The
                // VALUE is immaterial — WriteSourceText then sets the real declaration and the return type
                // with it (same as methods, which create with no return_type and get theirs from the
                // written declaration). So seed "INT", bound by name (it sits behind optional `language`).
                case ItemKind.PlcPouFunc: return CreateNamed(c, "create_pou",
                    ("name", name), ("type", EnumValue("PouType", "Function")), ("return_type", SeedType));
                case ItemKind.PlcPouFb: return Create(c, "create_pou", name, EnumValue("PouType", "FunctionBlock"));
                // A DUT is one kind: create a neutral Structure skeleton, then WriteSourceText writes the real
                // TYPE…END_TYPE declaration and CODESYS re-derives the actual subtype (struct/enum/union/alias)
                // from it — the same "seed then overwrite" pattern as a function's return_type. No subkind is
                // chosen by Volt.
                case ItemKind.PlcDut: return Create(c, "create_dut", name, EnumValue("DutType", "Structure"));
                case ItemKind.PlcGvl: return Create(c, "create_gvl", name);
                case ItemKind.PlcItf: return Create(c, "create_interface", name);
                // Inline POU children (method/action/property) live on a DIFFERENT
                // container — ScriptIecLanguageMemberContainer — whose create_* methods
                // pick the right object factory (and interface-vs-POU variant) and set a
                // default declaration; we overwrite it via WriteSourceText. create_property
                // also auto-creates the Get/Set accessors. (Decompiled from
                // ScriptDriverProjects.ScriptIecLanguageMemberContainer.)
                case ItemKind.PlcMethod: return Create(MemberContainer(parent), "create_method", name);
                case ItemKind.PlcItfMeth: return Create(MemberContainer(parent), "create_method", name);
                case ItemKind.PlcAction: return Create(MemberContainer(parent), "create_action", name);
                case ItemKind.PlcProp: return Create(MemberContainer(parent), "create_property", name);
                case ItemKind.PlcItfProp: return Create(MemberContainer(parent), "create_property", name);
                default: return Create(c, "create_pou", name, EnumValue("PouType", "FunctionBlock"));
            }
        }

        public void DeleteChild(object parent, string name)
        {
            foreach (var child in GetChildren(parent))
                if (string.Equals(GetName(child), name, StringComparison.Ordinal))
                { InvokeMethod(child, "remove"); return; }
        }

        public void Rename(object node, string newName) => InvokeMethod(Unwrap(node), "rename", newName);

        // ── PLCopenXML import / export (the graphical write/read transport) ──────
        private object? _scriptEngine;   // cached APEnvironment.ScriptEngine

        /// <summary>Serialize an object to a PLCopenXML <b>string</b>, fully IN-MEMORY — NO temp file.
        /// From the decompiled <c>ScriptProject.export_xml(IEnumerable&lt;IExtendedObject&lt;IScriptObject&gt;&gt;,
        /// filePath, …)</c>: passing an EMPTY file path makes it serialize to a MemoryStream and return
        /// the XML string. Our tree stores fully-unwrapped <c>IScriptObject</c> nodes, so re-wrap the
        /// node into the required <c>IExtendedObject&lt;IScriptObject&gt;</c> via the script engine's
        /// <c>CreateExtendedObject</c> factory (the same call the scripting tree itself uses).</summary>
        public string ExportXmlString(object node)
        {
            var proj = PrimaryProject ?? throw new InvalidOperationException("CODESYS: no primary project to export");
            return ExportNodes(proj, new[] { Unwrap(node)! });
        }

        /// <summary>Export the parent POU + its children in ONE call so the returned PLCopen XML contains
        /// child <c>&lt;pou&gt;</c> elements. The Materializer parses everything from this single document,
        /// replacing the per-child COM reads. CODESYS <c>export_xml</c> only works for <c>IPOUObject</c>,
        /// not <c>IInterfaceObject</c> — callers must use <see cref="ExportInterfaceXml"/> for interfaces.</summary>
        public string ExportXmlWithChildren(object parentNode)
        {
            var proj = PrimaryProject ?? throw new InvalidOperationException("CODESYS: no primary project to export");
            var nodes = new List<object> { Unwrap(parentNode)! };
            CollectPouChildren(parentNode, nodes);
            return ExportNodes(proj, nodes);
        }

        /// <summary>Build PLCopen XML for an interface from COM data. CODESYS <c>export_xml</c> rejects
        /// <c>IInterfaceObject</c> — it only accepts <c>IPOUObject</c> — so the XML document the
        /// <see cref="Volt.Cli.Core.Graphical.PlcOpenPouParser"/> expects is constructed here from the
        /// declaration and child elements read through the object model.</summary>
        public string ExportInterfaceXml(object node)
        {
            var unwrapped = Unwrap(node)!;
            var name = GetName(node);
            var declaration = ReadDeclaration(node);
            var ns = "http://www.plcopen.org/xml/tc6_0200";
            var sb = new System.Text.StringBuilder();
            sb.Append("<pou name=\"")
              .Append(System.Net.WebUtility.HtmlEncode(name))
              .Append("\" pouType=\"interface\" xmlns=\"")
              .Append(ns).Append("\">");
            sb.Append("<InterfaceAsPlainText><xhtml>")
              .Append(System.Net.WebUtility.HtmlEncode(declaration))
              .Append("</xhtml></InterfaceAsPlainText>");
            sb.Append("<body/>");
            foreach (var child in GetChildren(unwrapped))
            {
                if (IsFolder(child)) continue;
                var childName = GetName(child);
                var iobj = ReadObject(child);
                var ifaces = ObjectInterfaceNames(iobj);
                if (ifaces.Contains("IInterfaceMethodObject"))
                {
                    sb.Append("<Method name=\"").Append(System.Net.WebUtility.HtmlEncode(childName)).Append("\">");
                    sb.Append("<InterfaceAsPlainText><xhtml>")
                      .Append(System.Net.WebUtility.HtmlEncode(ReadDeclaration(child)))
                      .Append("</xhtml></InterfaceAsPlainText>");
                    var impl = ReadImplementation(child);
                    sb.Append("<body><ST>").Append(System.Net.WebUtility.HtmlEncode(impl)).Append("</ST></body>");
                    sb.Append("</Method>");
                }
                else if (ifaces.Contains("IInterfacePropertyObject"))
                {
                    sb.Append("<Property name=\"").Append(System.Net.WebUtility.HtmlEncode(childName)).Append("\">");
                    sb.Append("<InterfaceAsPlainText><xhtml>")
                      .Append(System.Net.WebUtility.HtmlEncode(ReadDeclaration(child)))
                      .Append("</xhtml></InterfaceAsPlainText>");
                    sb.Append("</Property>");
                }
            }
            sb.Append("</pou>");
            return sb.ToString();
        }

        private void CollectPouChildren(object parentNode, List<object> nodes)
        {
            foreach (var child in GetChildren(parentNode))
            {
                if (IsFolder(child))
                {
                    CollectPouChildren(child, nodes);
                    continue;
                }
                nodes.Add(child);
            }
        }

        private string ExportNodes(object proj, ICollection<object> nodes)
        {
            var export = proj.GetType().GetMethods(BF).FirstOrDefault(x => x.Name == "export_xml" && x.GetParameters().Length == 5
                && typeof(IEnumerable).IsAssignableFrom(x.GetParameters()[0].ParameterType)
                && x.GetParameters()[1].ParameterType == typeof(string))
                ?? throw new InvalidOperationException("CODESYS export_xml(IEnumerable, string, …) overload not found — object-model version mismatch");
            var elemType = export.GetParameters()[0].ParameterType.GetGenericArguments()[0];   // IExtendedObject<IScriptObject>
            var baseType = elemType.GetGenericArguments()[0];                                    // IScriptObject

            var apEnv = Reflection.FindType("_3S.CoDeSys.ScriptDriverProjects.APEnvironment")
                ?? throw new InvalidOperationException("CODESYS APEnvironment type not found — object-model version mismatch");
            var se = _scriptEngine ??= apEnv.GetProperty("ScriptEngine", BF | BindingFlags.Static)?.GetValue(null)
                ?? throw new InvalidOperationException("CODESYS APEnvironment.ScriptEngine not available");
            var createExt = se.GetType().GetMethods(BF).FirstOrDefault(x => x.Name == "CreateExtendedObject"
                && x.IsGenericMethodDefinition && x.GetParameters().Length == 1)
                ?? throw new InvalidOperationException("CODESYS ScriptEngine.CreateExtendedObject not found — object-model version mismatch");

            var objects = Array.CreateInstance(elemType, nodes.Count);
            int i = 0;
            foreach (var n in nodes)
                objects.SetValue(createExt.MakeGenericMethod(baseType).Invoke(se, new[] { n }), i++);

            var xml = (string)export.Invoke(proj, new object?[] { objects, "", false, false, true })!;
            return xml.TrimStart('\uFEFF');
        }

        /// <summary>Import a PLCopenXML <b>string</b> <paramref name="data"/> (NOT a file path) IN-MEMORY,
        /// replacing an existing object of the same name when the IDE offers a conflict resolution.
        /// Imports INTO <paramref name="into"/> when supplied (else at the project root) — PLCopenXML
        /// carries no folder membership, so a project-level import of a single POU would land it at the
        /// root and relocate it out of its folder. import_xml is available on object/folder nodes too.</summary>
        public void ImportXmlString(string data, object? into = null)
        {
            var target = into != null ? Unwrap(into)!
                : (PrimaryProject ?? throw new InvalidOperationException("CODESYS: no project"));
            var t = target.GetType();
            // Prefer the 3-arg import with an explicit conflict-resolution enum, selecting the
            // Replace/Overwrite member by name. NOTE: the only caller (CodesysDriver.WriteXml) DELETES
            // the existing object before importing, so there is no name conflict and the conflict mode
            // is effectively moot — hence the fall-through to the 2-arg overload (default conflict mode)
            // is safe even if a future version renames the enum member so the substring match misses.
            var m3 = t.GetMethods(BF).FirstOrDefault(x => x.Name == "import_xml" && x.GetParameters().Length == 3
                && x.GetParameters()[0].ParameterType.IsEnum && x.GetParameters()[1].ParameterType == typeof(string));
            if (m3 != null)
            {
                var et = m3.GetParameters()[0].ParameterType;
                var pick = Enum.GetNames(et).FirstOrDefault(n => n.IndexOf("Replace", StringComparison.OrdinalIgnoreCase) >= 0)
                        ?? Enum.GetNames(et).FirstOrDefault(n => n.IndexOf("Overwrite", StringComparison.OrdinalIgnoreCase) >= 0);
                if (pick != null) { InvokeWith(target, m3, Enum.Parse(et, pick), data, false); return; }
            }
            var m2 = t.GetMethods(BF).FirstOrDefault(x => x.Name == "import_xml"
                && x.GetParameters().Length == 2 && x.GetParameters()[0].ParameterType == typeof(string))
                ?? throw new InvalidOperationException("CODESYS import_xml(string, …) overload not found — object-model version mismatch");
            InvokeWith(target, m2, data, false);
        }

        private static object? InvokeWith(object target, System.Reflection.MethodInfo m, params object?[] args)
        {
            try { return m.Invoke(target, args); }
            catch (TargetInvocationException tie) { throw tie.InnerException ?? tie; }
        }


        private static object Create(object container, string method, params object?[] leadingArgs) =>
            Unwrap(InvokeWithOptionals(container, method, leadingArgs))!;

        /// <summary>Invoke a scripting factory binding the given arguments to parameters BY NAME
        /// (case-insensitive); every other (optional) parameter is left at its default. Use this when a
        /// param that matters sits behind optional ones — e.g. <c>create_pou</c>'s <c>return_type</c> is
        /// 4th, behind an optional <c>language</c>. By-name is robust to a CODESYS version reordering the
        /// optionals and is self-documenting, unlike positional <see cref="Type.Missing"/> padding.</summary>
        private static object CreateNamed(object container, string method, params (string Name, object? Value)[] args)
        {
            foreach (var m in container.GetType().GetMethods(BF))
            {
                if (m.Name != method) continue;
                var ps = m.GetParameters();
                if (!Array.TrueForAll(args, a => Array.Exists(ps, p => string.Equals(p.Name, a.Name, StringComparison.OrdinalIgnoreCase))))
                    continue;   // this overload doesn't expose every named arg → try the next
                var values = new object?[ps.Length];
                for (int i = 0; i < ps.Length; i++)
                {
                    var hit = Array.FindIndex(args, a => string.Equals(a.Name, ps[i].Name, StringComparison.OrdinalIgnoreCase));
                    values[i] = hit >= 0 ? args[hit].Value : Type.Missing;
                }
                try { return Unwrap(m.Invoke(container, BindingFlags.OptionalParamBinding, null, values, null))!; }
                catch (TargetInvocationException tie) { throw tie.InnerException ?? tie; }
            }
            throw new MissingMethodException($"No '{method}' overload exposing [{string.Join(", ", Array.ConvertAll(args, a => a.Name))}] on {container.GetType().FullName}");
        }

        /// <summary>Container for top-level objects (POU/DUT/GVL/interface) under the
        /// parent.</summary>
        private object IecContainer(object parent) => Container(parent, "ScriptIecLanguageObjectContainerObject");

        /// <summary>Container for inline POU members (method/action/property/transition)
        /// under the parent POU — distinct from <see cref="IecContainer"/>; this is the
        /// type that actually exposes create_method/create_action/create_property.</summary>
        private object MemberContainer(object parent) => Container(parent, "ScriptIecLanguageMemberContainer");

        /// <summary>Construct one of CODESYS's own IEC language containers over the
        /// parent's ScriptObject. Their <c>create_*</c> methods are real .NET members
        /// (unlike the IronPython-only extension surface), so they're callable from C#.</summary>
        private object Container(object parent, string simpleTypeName)
        {
            var baseObj = Unwrap(parent)!;
            var t = Reflection.FindType("_3S.CoDeSys.ScriptDriverProjects." + simpleTypeName)
                    ?? throw new InvalidOperationException(simpleTypeName + " type not found");
            return Activator.CreateInstance(t,
                BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public,
                null, new object[] { baseObj }, null)!;
        }

        /// <summary>Invoke a scripting factory method supplying only the leading
        /// arguments; trailing optional parameters get <see cref="Type.Missing"/>.</summary>
        private static object InvokeWithOptionals(object target, string method, object?[] leadingArgs)
        {
            foreach (var m in target.GetType().GetMethods(BF))
            {
                if (m.Name != method) continue;
                var ps = m.GetParameters();
                if (ps.Length < leadingArgs.Length) continue;
                if (ps.Length > leadingArgs.Length && !ps[leadingArgs.Length].IsOptional) continue;
                var args = new object?[ps.Length];
                for (int i = 0; i < ps.Length; i++) args[i] = i < leadingArgs.Length ? leadingArgs[i] : Type.Missing;
                try
                {
                    return Unwrap(m.Invoke(target, BindingFlags.OptionalParamBinding, null, args, null))!;
                }
                catch (TargetInvocationException tie) { throw tie.InnerException ?? tie; }
            }
            throw new MissingMethodException($"No '{method}' overload taking {leadingArgs.Length}+ args on {target.GetType().FullName}");
        }

        private static object EnumValue(string enumSimpleName, string member)
        {
            foreach (var a in AppDomain.CurrentDomain.GetAssemblies())
            {
                Type[] types;
                try { types = a.GetTypes(); } catch { continue; }
                foreach (var t in types)
                    if (t.IsEnum && t.Name == enumSimpleName)
                        return Enum.Parse(t, member);
            }
            throw new InvalidOperationException($"enum {enumSimpleName} not found");
        }

        // ── reflection helpers ─────────────────────────────────────────────────
        /// <summary>Reads a member, RESOLVING explicit interface implementations
        /// (which both concrete-type reflection and C# <c>dynamic</c> miss — e.g.
        /// <c>IMetaObject.Object</c>).</summary>
        private static object? GetMember(object? o, string name)
        {
            if (o == null) return null;
            var t = o.GetType();
            var p = t.GetProperty(name, BF);
            if (p != null) return p.GetValue(o);
            foreach (var i in t.GetInterfaces())
            {
                var ip = i.GetProperty(name);
                if (ip != null) return ip.GetValue(o);
            }
            var m = t.GetMethod("get_" + name, BF, null, Type.EmptyTypes, null);
            return m?.Invoke(o, null);
        }

        private static void SetMember(object o, string name, object? value)
        {
            var t = o.GetType();
            var p = t.GetProperty(name, BF);
            if (p != null && p.CanWrite) { p.SetValue(o, value); return; }
            foreach (var i in t.GetInterfaces())
            {
                var ip = i.GetProperty(name);
                if (ip != null && ip.CanWrite) { ip.SetValue(o, value); return; }
            }
            throw new InvalidOperationException($"no writable '{name}' on {t.FullName}");
        }

        private static object? InvokeMethod(object? o, string name, params object?[] args)
        {
            if (o == null) return null;
            // Matches by name + ARG COUNT only (the first such overload). This is safe for every CODESYS
            // surface we call — none has two same-arity overloads of the same name — but it is the reason
            // not to point this at an arbitrary overloaded API without checking.
            foreach (var m in o.GetType().GetMethods(BF))
                if (m.Name == name && m.GetParameters().Length == args.Length)
                {
                    try { return m.Invoke(o, args); }
                    catch (TargetInvocationException tie) { throw tie.InnerException ?? tie; }
                }
            return null;
        }

        private static object? Unwrap(object? o)
        {
            while (o != null)
            {
                var bp = o.GetType().GetProperty("BaseObject", BF);
                if (bp == null) break;
                var inner = bp.GetValue(o);
                if (inner == null || ReferenceEquals(inner, o)) break;
                o = inner;
            }
            return o;
        }

        private static object? GetStaticMember(string typeName, string member)
        {
            foreach (var a in AppDomain.CurrentDomain.GetAssemblies())
            {
                Type? t = null;
                try { t = a.GetType(typeName, false); } catch { }
                if (t == null) continue;
                var p = t.GetProperty(member, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static);
                if (p != null) return p.GetValue(null);
                var f = t.GetField(member, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static);
                if (f != null) return f.GetValue(null);
            }
            return null;
        }
    }

    /// <summary>Synthetic tree node for a library reference (not a CODESYS
    /// <c>IObject</c>). Carries the display name and the deterministic manifest the
    /// adapter returns as both the `library` item's declaration and its fetch body.</summary>
    internal sealed class LibRefNode
    {
        public string Name { get; }
        public string Manifest { get; }
        public LibRefNode(string name, string manifest) { Name = name; Manifest = manifest; }
    }
}
