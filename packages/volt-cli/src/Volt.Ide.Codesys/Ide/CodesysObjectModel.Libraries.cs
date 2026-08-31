using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Volt.Contracts;
using Volt.Engine.Library;
using Volt.Engine.Format.Body;
using Volt.Engine.Item;

namespace Volt.Ide.Codesys
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
            // NO EMPTY-LIST ESCAPES. Every early return here used to answer "this project references no
            // libraries", which is a LIE for all three conditions and an expensive one: `fetch` reports the
            // empty set with `librariesRefreshed` true, and `IdeTree.DroppedLibraryFile` then removes EVERY
            // `.library` file the client holds — taking with them every qualified namespace the LSP resolves
            // against. A version rename of one method would have deleted the engineer's whole library set.
            //
            // Two of the old guards were also unreachable: this is only called after `KindCodeOf` classified the
            // node by `Has(ifaces, "ILibManObject")` over a NON-NULL IObject, so neither a null object nor a
            // missing interface can arrive here. They are kept as throws rather than deleted because a caller
            // could change, and a wrong answer here costs files.
            var iobj = ReadObject(libManNode)
                ?? throw new InvalidOperationException(
                    "CODESYS: the library manager's object could not be read. Refusing rather than reporting a " +
                    "project with no libraries, which would delete every .library file in the workspace.");

            // GetAllLibraries lives on the base ILibManObject; invoke via the
            // interface MethodInfo so explicit implementations dispatch correctly.
            var libManIface = Array.Find(iobj.GetType().GetInterfaces(), i => i.Name == "ILibManObject")
                ?? throw new InvalidOperationException(
                    $"CODESYS: '{iobj.GetType().Name}' does not implement ILibManObject, so its libraries cannot " +
                    "be enumerated. Refusing rather than reporting a project with no libraries.");

            var getAll = libManIface.GetMethod("GetAllLibraries")
                ?? throw new InvalidOperationException(
                    "CODESYS: ILibManObject has no GetAllLibraries(bool) — the object model has a different shape " +
                    "than this build expects. Refusing rather than reporting a project with no libraries; a " +
                    "renamed method is a version mismatch, not an empty library list.");

            if (getAll.Invoke(iobj, new object[] { false }) is not IEnumerable items)
                throw new InvalidOperationException(
                    "CODESYS: GetAllLibraries did not return an enumerable. Refusing rather than reporting a " +
                    "project with no libraries.");

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
        public List<Volt.Engine.Library.LibSignature> ExtractLibrarySignatures()
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

            List<Volt.Engine.Library.LibVar> Vars(object? sig, string prop)
            {
                var outv = new List<Volt.Engine.Library.LibVar>();
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
                    outv.Add(new Volt.Engine.Library.LibVar(n, type!, string.IsNullOrEmpty(init) ? null : init));
                }
                return outv;
            }

            // An FB/interface's OWN methods, via `LanguageModelMgr.GetAllMethods(sign)` (the precompiled signatures
            // themselves carry no methods — SubSignatures is always empty). Skip inherited methods (ParentObjectGuid
            // ≠ this signature's) — the base FB renders its own, and the LSP resolves them through EXTENDS. The raw
            // pins pass through as-is; the renderer owns the return-pin convention (LibSignatureRenderer.LiftReturn).
            List<Volt.Engine.Library.LibMethod>? Methods(object sig)
            {
                if (InvokeMethod(lmm, "GetAllMethods", sig) is not object[] ms || ms.Length == 0) return null;
                var ownGuid = GetMember(sig, "ObjectGuid")?.ToString();
                var methods = new List<Volt.Engine.Library.LibMethod>();
                foreach (var m in ms)
                {
                    var parent = GetMember(m, "ParentObjectGuid")?.ToString();
                    if (!string.IsNullOrEmpty(ownGuid) && !string.IsNullOrEmpty(parent) && parent != ownGuid) continue; // inherited
                    if (GetMember(m, "Name") is not string mn || mn.Length == 0 || mn.Contains("__")) continue;
                    methods.Add(new Volt.Engine.Library.LibMethod(mn, Vars(m, "Inputs"), Vars(m, "Outputs"), Vars(m, "InOuts"),
                        GetMember(m, "ReturnType")?.ToString()));
                }
                return methods.Count > 0 ? methods : null;
            }

            var result = new List<Volt.Engine.Library.LibSignature>();
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
                result.Add(new Volt.Engine.Library.LibSignature(
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
        /// <paramref name="language"/> is UNUSED here — deliberately, not for want of a parameter. This said
        /// "CODESYS's <c>create_pou</c> has no implementation-language parameter"; enumerated off the live
        /// scripting container it has one, third and optional:
        /// <c>create_pou(name, type?, language?, return_type?, base_type?, interfaces?)</c> (DIALECT C2d).
        /// Volt still seeds and lets the PLCopen import establish the language, which is what the whole
        /// single-document write depends on — but that is a CHOICE, not the absence of an option.</summary>
        /// <summary>A POU, with its body LANGUAGE applied at creation.
        /// <para><b>The language used to be ignored here, and that was correct until it was not.</b> CODESYS
        /// took the language from the imported body element, so a POU created as ST became FBD the moment the
        /// document landed — the old comment said as much. Nothing imports a document now: a graphical body is
        /// written into the item's typed objects, and an item created as ST has an
        /// <c>STImplementationObject</c> with no <c>NetworkList</c> to write into. The first live graphical
        /// create failed exactly there, with that message.</para></summary>
        private object CreatePou(object container, string name, string pouType, string? language) =>
            CreateNamed(container, "create_pou",
                ("name", name), ("type", EnumValue("PouType", pouType)), ("language", LanguageArg(language)));

        /// <summary>Volt's language name as CODESYS's <c>ImplementationLanguages</c> member, or
        /// <see cref="Type.Missing"/> when the push carries no language (a textual body — let the IDE default).
        /// <para>The member names are lower-case and do NOT match Volt's: LD is <c>ladder</c>. Measured against
        /// the live enum, whose members are cfc, fbd, instruction_list, ladder, page_oriented_cfc, sfc, st and
        /// uml_statechart.</para></summary>
        private static object? LanguageArg(string? language) => language?.ToUpperInvariant() switch
        {
            "FBD" => LanguageValue("fbd"),
            "LD" => LanguageValue("ladder"),
            _ => Type.Missing,
        };

        /// <summary>The scripting API's value for an implementation language.
        /// <para><b>It is not an enum</b>, which is what the first attempt assumed: <c>ImplementationLanguages</c>
        /// is an INSTANCE of <c>ScriptImplementationLanguages</c> that the script host injects into the Python
        /// scope, and its members are GUIDs. Nothing hard-codes one here — the type is found by simple name and
        /// the member read off it, so a CODESYS version that renumbers a language stays correct and a version
        /// that renames the member fails loudly with the list of members it does have.</para></summary>
        private static object LanguageValue(string member)
        {
            var t = Reflection.FindTypeBySimpleName("ScriptImplementationLanguages")
                    ?? Reflection.FindTypeBySimpleName("ImplementationLanguages")
                    ?? throw new InvalidOperationException(
                        "CODESYS: neither ScriptImplementationLanguages nor ImplementationLanguages is loaded — " +
                        "the scripting API does not match what this driver was written against");

            // A static member first; the members are constants either way, so an instance is only a carrier.
            // STATIC-ONLY flags: `BF` carries Instance, and adding Static to it matches the INSTANCE property,
            // which then throws "Non-static method requires a target" on GetValue(null).
            const BindingFlags StaticOnly =
                BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.FlattenHierarchy;
            var sp = t.GetProperty(member, StaticOnly);
            if (sp != null) return sp.GetValue(null)!;
            var sf = t.GetField(member, StaticOnly);
            if (sf != null) return sf.GetValue(null)!;

            var instance = Activator.CreateInstance(t, nonPublic: true)
                ?? throw new InvalidOperationException($"CODESYS: cannot instantiate {t.Name} to read '{member}'");
            var ip = t.GetProperty(member, BF);
            if (ip != null) return ip.GetValue(instance)!;
            var f = t.GetField(member, BF);
            if (f != null) return f.GetValue(instance)!;

            var names = string.Join(", ", t.GetProperties(BF).Select(x => x.Name)
                                           .Concat(t.GetFields(BF).Select(x => x.Name)).Distinct());
            throw new InvalidOperationException(
                $"CODESYS: {t.Name} has no '{member}'. It offers: {names}");
        }

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
                case ItemKind.PlcPouProg: return CreatePou(c, name, "Program", language);
                // A function REQUIRES a non-null return_type at create; CODESYS errors without one. The
                // VALUE is immaterial — WriteSourceText then sets the real declaration and the return type
                // with it (same as methods, which create with no return_type and get theirs from the
                // written declaration). So seed "INT", bound by name (it sits behind optional `language`).
                case ItemKind.PlcPouFunc: return CreateNamed(c, "create_pou",
                    ("name", name), ("type", EnumValue("PouType", "Function")), ("return_type", SeedType),
                    ("language", LanguageArg(language)));
                case ItemKind.PlcPouFb: return CreatePou(c, name, "FunctionBlock", language);
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
                case ItemKind.PlcMethod: return CreateNamed(MemberContainer(parent), "create_method",
                    ("name", name), ("language", LanguageArg(language)));
                case ItemKind.PlcItfMeth: return CreateNamed(MemberContainer(parent), "create_method",
                    ("name", name), ("language", LanguageArg(language)));
                case ItemKind.PlcAction: return CreateNamed(MemberContainer(parent), "create_action",
                    ("name", name), ("language", LanguageArg(language)));
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
