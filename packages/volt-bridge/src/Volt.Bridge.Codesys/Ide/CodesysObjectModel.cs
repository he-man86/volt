using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Volt.Bridge.Core.Workspace;

namespace Volt.Bridge.Codesys
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

        // ── library references (LibManObject → ILibManItem[]) ──────────────────
        /// <summary>The top-level library references managed by a Library Manager
        /// object. These are NOT tree <c>IObject</c>s (no handle/guid/source) — they
        /// live in the <c>ILibManObject</c> collection — so each is surfaced as a
        /// synthetic <see cref="LibRefNode"/> the adapter emits as a `library` item,
        /// matching TwinCAT's flat library refs. Read-only (no push target).</summary>
        public List<LibRefNode> GetLibraryRefs(object libManNode)
        {
            var refs = new List<LibRefNode>();
            var iobj = ReadObject(libManNode);
            if (iobj == null) return refs;

            // GetAllLibraries lives on the base ILibManObject; invoke via the
            // interface MethodInfo so explicit implementations dispatch correctly.
            var libManIface = Array.Find(iobj.GetType().GetInterfaces(), i => i.Name == "ILibManObject");
            var getAll = libManIface?.GetMethod("GetAllLibraries");
            if (getAll?.Invoke(iobj, new object[] { false }) is not IEnumerable items) return refs;

            foreach (var item in items)
            {
                if (item == null) continue;
                // Best-effort by design: a library reference is READ-ONLY metadata (never a push target),
                // so one malformed entry must not abort the whole /refs tree walk. This is NOT a
                // source/version path, so the zero-fallback policy that governs those doesn't apply here.
                try { refs.Add(ToLibRef(item)); } catch { /* skip a malformed ref */ }
            }
            return refs;
        }

        private static LibRefNode ToLibRef(object item)
        {
            var name = GetMember(item, "Name") as string ?? "";
            var ns = GetMember(item, "Namespace") as string ?? "";
            var system = GetMember(item, "SystemLibrary") is bool b && b;

            bool isPlaceholder = false;
            foreach (var i in item.GetType().GetInterfaces())
                if (i.Name == "IPlaceholderLibManItem") { isPlaceholder = true; break; }

            string resolution;
            if (isPlaceholder)
            {
                var ph = GetMember(item, "PlaceholderName") as string;
                if (!string.IsNullOrEmpty(ph)) name = ph!;          // drop the leading '#'
                resolution = ManagedLibDisplay(GetMember(item, "EffectiveResolution"))
                             ?? GetMember(item, "DefaultResolution") as string ?? "";
            }
            else
            {
                resolution = name;   // managed refs carry "Name, Version (Company)" in Name
            }

            // Deterministic manifest — the fetch body AND the version-hash input.
            var manifest =
                $"LIBRARY {name}\n" +
                $"NAMESPACE {ns}\n" +
                $"RESOLUTION {resolution}\n" +
                $"PLACEHOLDER {(isPlaceholder ? "true" : "false")}\n" +
                $"SYSTEM {(system ? "true" : "false")}\n";

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
                    DumpMessageOnce(m);   // TEMP probe
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

        private static int _probed;   // TEMP
        private static void DumpMessageOnce(object m)   // TEMP probe — dump a build message's full shape
        {
            if (_probed++ >= 8) return;
            try
            {
                var t = m.GetType();
                var parts = new List<string>();
                foreach (var p in t.GetProperties(BindingFlags.Public | BindingFlags.Instance))
                {
                    object? v; try { v = p.GetValue(m); } catch { v = "<err>"; }
                    var s = v?.ToString() ?? "null";
                    if (s.Length > 70) s = s.Substring(0, 70);
                    parts.Add($"{p.Name}={s}");
                }
                Console.Error.WriteLine($"[diag-probe] {t.FullName} | {string.Join(" | ", parts)}");
            }
            catch (Exception ex) { Console.Error.WriteLine("[diag-probe] fail: " + ex.Message); }
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
            if (itemType == ItemKind.Folder)
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
                case ItemKind.Program: return Create(c, "create_pou", name, EnumValue("PouType", "Program"));
                // A function REQUIRES a non-null return_type at create; CODESYS errors without one. The
                // VALUE is immaterial — WriteSourceText then sets the real declaration and the return type
                // with it (same as methods, which create with no return_type and get theirs from the
                // written declaration). So seed "INT", bound by name (it sits behind optional `language`).
                case ItemKind.Function: return CreateNamed(c, "create_pou",
                    ("name", name), ("type", EnumValue("PouType", "Function")), ("return_type", SeedType));
                case ItemKind.FunctionBlock: return Create(c, "create_pou", name, EnumValue("PouType", "FunctionBlock"));
                case ItemKind.Enumeration: return Create(c, "create_dut", name, EnumValue("DutType", "Enumeration"));
                case ItemKind.Structure: return Create(c, "create_dut", name, EnumValue("DutType", "Structure"));
                case ItemKind.Union: return Create(c, "create_dut", name, EnumValue("DutType", "Union"));
                // An alias REQUIRES a non-null baseType at create; same story — WriteSourceText overwrites
                // it with the real base type from the declaration. Seed "INT", bound by name.
                case ItemKind.Alias: return CreateNamed(c, "create_dut",
                    ("name", name), ("type", EnumValue("DutType", "Alias")), ("baseType", SeedType));
                case ItemKind.Gvl: return Create(c, "create_gvl", name);
                case ItemKind.Interface: return Create(c, "create_interface", name);
                // Inline POU children (method/action/property) live on a DIFFERENT
                // container — ScriptIecLanguageMemberContainer — whose create_* methods
                // pick the right object factory (and interface-vs-POU variant) and set a
                // default declaration; we overwrite it via WriteSourceText. create_property
                // also auto-creates the Get/Set accessors. (Decompiled from
                // ScriptDriverProjects.ScriptIecLanguageMemberContainer.)
                case ItemKind.Method: return Create(MemberContainer(parent), "create_method", name);
                case ItemKind.Action: return Create(MemberContainer(parent), "create_action", name);
                case ItemKind.Property: return Create(MemberContainer(parent), "create_property", name);
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
            // Each reflection pick below is a VERSION-SHAPE assumption (the object-model API has no
            // compile-time reference here). Resolve loudly with a named error rather than a cryptic
            // "Sequence contains no matching element" if a CODESYS version changes the shape.
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
            var wrapped = createExt.MakeGenericMethod(baseType).Invoke(se, new[] { Unwrap(node) });

            var objects = Array.CreateInstance(elemType, 1);
            objects.SetValue(wrapped, 0);
            var xml = (string)export.Invoke(proj, new object?[] { objects, "", false, false, true })!;   // empty file path → returns the XML string in-memory
            return xml.TrimStart('﻿');   // export_xml's UTF8.GetString prepends a BOM that XDocument.Parse rejects
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
