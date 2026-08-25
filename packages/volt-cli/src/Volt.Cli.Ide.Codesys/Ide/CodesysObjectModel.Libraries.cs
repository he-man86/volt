using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Volt.Wire;
using Volt.Contracts;
using Volt.Engine.Library;
using Volt.Engine.Manifest;
using Volt.Engine.Model;
using Volt.Engine.Vocabulary;

namespace Volt.Cli.Ide.Codesys
{
    internal sealed partial class CodesysObjectModel
    {
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
                // Skips stay best-effort here (one unreadable property must not fail the whole refs/fetch walk),
                // but they are LOGGED — a library that vanishes from the manifest set with no trace is the
                // "silently dropped" failure ARCHITECTURE.md forbids.
                try { ns = GetMember(item, "Namespace") as string ?? ""; nm = GetMember(item, "Name") as string ?? ""; }
                catch (Exception ex)
                {
                    VoltLog.Warn($"library ref skipped (identity unreadable on {item.GetType().Name}) — this ref " +
                                 $"and its dependency subtree are absent from the manifest set: {ex.Message}");
                    return;
                }
                if (!seen.Add(ns + "|" + nm)) return; // cycle / re-reference guard (logical key, not instance)
                try { var r = ToLibRef(item); byName[r.Name] = r; }
                catch (Exception ex)
                {
                    VoltLog.Warn($"library ref '{ns}.{nm}' skipped — no .library item will materialize: {ex.Message}");
                }
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
                    if (d != null)
                    {
                        string dn = "";
                        // This one changes MANIFEST BYTES (and therefore the version hash), so an unreadable
                        // dependency name must say so rather than just shortening the DEPENDENCIES line.
                        try { dn = RefDisplayName(d); }
                        catch (Exception ex)
                        {
                            VoltLog.Warn($"library '{name}': a dependency name is unreadable and is omitted from " +
                                         $"its DEPENDENCIES line: {ex.Message}");
                        }
                        if (dn.Length > 0) deps.Add(dn);
                    }

            // Deterministic manifest — the fetch body AND the version-hash input. Built by the SHARED Core
            // formatter so CODESYS and TwinCAT emit the same canonical shape.
            var manifest = Volt.Engine.Library.LibraryManifest.Build(name, ns, resolution, isPlaceholder, system, deps);
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

        // ── library signature extraction (referenced-library declarations from the resolved language model) ──

        /// <summary>Extract the SIGNATURE (declaration, no body) of every referenced-library element. Precompiles the
        /// libraries (best-effort build), then reads their precompiled <c>ISignature</c>s from
        /// <c>SystemInstances.LanguageModelMgr.AllPrecompiledSignatures</c> — the same DLL the IDE's Library Manager
        /// renders from, and the same reflection the rest of the bridge uses. Vendor libraries only; system libraries
        /// are dropped by the caller. Filters compiler-mangled entries (<c>__</c>-prefixed) and non-library objects.</summary>
        public List<Volt.Engine.Model.LibSignature> ExtractLibrarySignatures()
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

            List<Volt.Engine.Model.LibVar> Vars(object? sig, string prop)
            {
                var outv = new List<Volt.Engine.Model.LibVar>();
                if (GetMember(sig, prop) is not IEnumerable coll) return outv;
                foreach (var v in coll)
                {
                    if (GetMember(v, "Name") is not string n || n.Length == 0) continue;
                    var init = GetMember(v, "Initial")?.ToString();
                    // NOT `?? "BOOL"`. An unreadable Type used to be fabricated as BOOL and shipped to the LSP as
                    // ground truth — a wrong type is worse than no library, because it resolves and then lies.
                    // IsNullOrEmpty, not null: GetMember can hand back a present-but-empty value.
                    var type = GetMember(v, "Type")?.ToString();
                    if (string.IsNullOrEmpty(type))
                        throw new InvalidOperationException(
                            $"CODESYS: library variable '{n}' in {prop} of '{GetMember(sig, "Name")}' has no " +
                            "readable Type — object-model version mismatch");
                    outv.Add(new Volt.Engine.Model.LibVar(n, type!, string.IsNullOrEmpty(init) ? null : init));
                }
                return outv;
            }

            // An FB/interface's OWN methods, via `LanguageModelMgr.GetAllMethods(sign)` (the precompiled signatures
            // themselves carry no methods — SubSignatures is always empty). Skip inherited methods (ParentObjectGuid
            // ≠ this signature's) — the base FB renders its own, and the LSP resolves them through EXTENDS. The raw
            // pins pass through as-is; the renderer owns the return-pin convention (LibSignatureRenderer.LiftReturn).
            List<Volt.Engine.Model.LibMethod>? Methods(object sig)
            {
                if (InvokeMethod(lmm, "GetAllMethods", sig) is not object[] ms || ms.Length == 0) return null;
                var ownGuid = GetMember(sig, "ObjectGuid")?.ToString();
                var methods = new List<Volt.Engine.Model.LibMethod>();
                foreach (var m in ms)
                {
                    var parent = GetMember(m, "ParentObjectGuid")?.ToString();
                    if (!string.IsNullOrEmpty(ownGuid) && !string.IsNullOrEmpty(parent) && parent != ownGuid) continue; // inherited
                    if (GetMember(m, "Name") is not string mn || mn.Length == 0 || mn.Contains("__")) continue;
                    methods.Add(new Volt.Engine.Model.LibMethod(mn, Vars(m, "Inputs"), Vars(m, "Outputs"), Vars(m, "InOuts"),
                        GetMember(m, "ReturnType")?.ToString()));
                }
                return methods.Count > 0 ? methods : null;
            }

            var result = new List<Volt.Engine.Model.LibSignature>();
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
                var pou = GetMember(s, "POUType")?.ToString() ?? "";
                var methods = pou.Contains("FunctionBlock") || pou.Contains("Interface") ? Methods(s) : null;
                result.Add(new Volt.Engine.Model.LibSignature(
                    name, libPath, pou,
                    Vars(s, "Inputs"), Vars(s, "Outputs"), Vars(s, "InOuts"), Vars(s, "AllVariables"),
                    baseName, GetMember(s, "ReturnType")?.ToString(), aliasBase, flags, methods));
            }
            return result;
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
        /// new node; the caller writes its text via <see cref="WriteSourceText"/>.
        /// <paramref name="language"/> is UNUSED here — CODESYS's <c>create_pou</c> has no
        /// implementation-language parameter, so a graphical POU is created as ST and its language is set
        /// afterwards by the PLCopen import (see PushService / NetworkCodeIo.Write). The parameter stays
        /// for the IProjectTree signature, which TwinCAT does honour.</summary>
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
                // Property accessors. create_property above makes BOTH Get and Set with the property, so the
                // normal path never gets here — PushService.EnsureAccessor finds the existing accessor first.
                // This is the ADD-A-MISSING-ACCESSOR case (a property that gains a setter), and CODESYS's
                // member container exposes no create_* for it. Say that, and list what the container DOES
                // offer, rather than falling through: the fall-through created a FUNCTION BLOCK named
                // "Get"/"Set" under the property — junk in the user's project where their accessor should be,
                // and a silent divergence from TwinCAT, which creates these natively.
                case ItemKind.PlcPropGet:
                case ItemKind.PlcPropSet:
                case ItemKind.PlcItfPropGet:
                case ItemKind.PlcItfPropSet:
                    throw new InvalidOperationException(
                        $"CODESYS: cannot create the '{name}' accessor — CODESYS creates a property's Get/Set " +
                        "with the property itself, and exposes no scripting call to add one afterwards. Add it " +
                        "in the IDE, then pull. (member container offers: " + CreateMethodNames(MemberContainer(parent)) + ")");
                // No fallback: an unhandled kind is a bug (a new kind missed here), not a function block —
                // same policy PushService.PouKindToCode states for its own mapping.
                default:
                    throw new InvalidOperationException($"CODESYS: no create for item kind {itemType} ('{name}')");
            }
        }

        public void DeleteChild(object parent, string name)
        {
            foreach (var child in GetChildren(parent))
                if (string.Equals(GetName(child), name, StringComparison.Ordinal))
                { InvokeMethod(child, "remove"); return; }
            // A miss is LOUD. It used to return silently, so a delete that matched nothing reported success while
            // the object stayed in the project — and it reported success on CODESYS while the same wire name made
            // TwinCAT raise a raw COM error, which is the actual parity break. Delete-idempotency is NOT weakened:
            // it lives one level up in PushService.ApplyOp, which answers "no-op" when the item is absent and
            // never calls here at all.
            throw new InvalidOperationException($"CODESYS: no child named '{name}' under '{GetName(parent)}'");
        }

        public void Rename(object node, string newName) => InvokeMethod(Unwrap(node), "rename", newName);

        /// <summary>Re-place an object under <paramref name="target"/>. Verified live on 3.5.21.40: a POU child
        /// flattened out of its folder by a PLCopen merge import is moved back with its body intact.
        /// <para>Resolved across the object's INTERFACES as well as its own type, and with trailing optionals
        /// filled. Neither is incidental: <c>move</c> is not on <c>ScriptObject</c>'s own method table, so both
        /// <see cref="InvokeMethod"/> (arity-exact, own type only) and <see cref="InvokeWithOptionals"/> (own type
        /// only) reported "no such method" for a method that plainly exists — IronPython finds it because it
        /// walks interfaces and fills defaults. A probe that enumerates only <c>GetType().GetMethods()</c> will
        /// wrongly conclude the vendor has no move; enumerate <c>GetInterfaces()</c> too.</para></summary>
        public void Move(object node, object target)
        {
            var obj = Unwrap(node)!;
            var t = obj.GetType();
            var found = new List<string>();
            foreach (var tt in new[] { t }.Concat(t.GetInterfaces()))
                foreach (var m in tt.GetMethods(BF))
                {
                    if (m.Name != "move") continue;
                    var ps = m.GetParameters();
                    found.Add($"{tt.Name}.move({string.Join(", ", ps.Select(p => p.ParameterType.Name))})");
                    // move(IExtendedObject<IScriptObject> newParent, int index) — the index is the insert
                    // position and is NOT optional in the metadata; -1 appends, which is what the scripting
                    // console's one-argument call resolves to.
                    if (ps.Length != 2 || !ps[0].ParameterType.IsGenericType || ps[1].ParameterType != typeof(int)) continue;
                    var parent = AsExtended(Unwrap(target)!, ps[0].ParameterType.GetGenericArguments()[0]);
                    try { m.Invoke(obj, new object?[] { parent, -1 }); return; }
                    catch (TargetInvocationException tie) { throw tie.InnerException ?? tie; }
                }
            throw new MissingMethodException(
                $"No usable 'move' on {t.FullName} or its interfaces (saw: {(found.Count == 0 ? "none" : string.Join("; ", found))})");
        }
    }
}
