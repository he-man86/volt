using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Volt.Contracts;
using Volt.Engine.Library;
using Volt.Engine.Source.Body;

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
    /// ALL source-text I/O and kind classification go through the object model. The
    /// scripting objects (<c>projects</c>) carry everything else: tree enumeration
    /// (<c>get_children</c>/<c>get_name</c>/<c>guid</c>/<c>handle</c>), CRUD
    /// (<c>create_*</c>/<c>rename</c>/<c>remove</c>), the PLCopen <c>export_xml</c>/
    /// <c>import_xml</c> transport, and the read-only descriptors read off their
    /// <c>Extender</c> facets — all real .NET members. NO IronPython-injected members
    /// (e.g. <c>textual_declaration</c>). Reflection-only, so this one binary loads in any 3.5.x.
    /// </summary>
    internal sealed partial class CodesysObjectModel
    {
        private const BindingFlags BF = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;

        // Placeholder type CODESYS requires at create-time for a function (return_type);
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
            // ARITY probe, not a guess: some scripting objects expose get_children(bool), others
            // get_children(). "No such overload" is the signal to try the other one.
            var r = TryInvokeMethod(Unwrap(node), "get_children", false)
                    ?? TryInvokeMethod(Unwrap(node), "get_children");
            if (r is IEnumerable e)
                foreach (var x in e) { var u = Unwrap(x); if (u != null) list.Add(u); }
            return list;
        }

        /// <summary>The node's name. NEVER "": the item name IS the wire identity (refs, knownItems, every push
        /// op, structureVersion, the one-item-per-file layout), and the tree walk uses it as both the item name
        /// and a folder-path segment — so a fabricated blank corrupts identity rather than merely losing text.
        /// Two same-named blanks collapse last-write-wins, silently.
        /// <para>The two calls are an ARITY probe (see GetChildren): some scripting objects expose
        /// <c>get_name(bool)</c>, others <c>get_name()</c>. "No such overload on EITHER" is a broken object-model
        /// contract, not an item that happens to be called nothing.</para></summary>
        public string GetName(object node)
        {
            var n = Unwrap(node);
            var r = TryInvokeMethod(n, "get_name", out var found, false);
            if (!found) r = TryInvokeMethod(n, "get_name", out found);
            if (!found)
                throw new InvalidOperationException(
                    $"CODESYS: {n?.GetType().Name ?? "node"} exposes no get_name() or get_name(bool) — " +
                    "object-model version mismatch");
            return r as string
                ?? throw new InvalidOperationException(
                    $"CODESYS: get_name() on {n?.GetType().Name ?? "node"} returned " +
                    $"{(r is null ? "null" : r.GetType().Name)} — the item name is the wire identity and cannot be blank");
        }

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

        // ── source text (object model: aspect → ITextDocument.Text) ────────────
        public string ReadDeclaration(object node) => ReadAspectText(ReadObject(node), "Interface");

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

        /// <summary>Write one aspect's text (Interface = declaration, Implementation = body).
        /// <para>A MISSING ASPECT is a legitimate answer — a GVL has no implementation — and the CALLER decides
        /// that by passing null for a slot the kind does not have. But an aspect that EXISTS while its
        /// TextDocument does not is a broken object-model contract, and returning quietly there made the write
        /// land nothing while the enclosing transaction still committed and the push reported success. That is
        /// the exact silent-no-op shape this codebase has shipped before.</para></summary>
        private static void SetAspectText(object? iobject, string aspectName, string text)
        {
            var aspect = GetMember(iobject, aspectName);
            if (aspect == null) return;                            // object has no such aspect (e.g. GVL has no impl)
            var doc = GetMember(aspect, "TextDocument")
                ?? throw new InvalidOperationException(
                    $"CODESYS: the '{aspectName}' aspect has no TextDocument — the write would be accepted and " +
                    "land nothing");
            SetMember(doc, "Text", text);
        }

        // ── structural ─────────────────────────────────────────────────────────
        /// <summary>The Application node — default parent for new POUs.</summary>
        public object? FindApplication() =>
            FindFirst(PrimaryProject, c => !IsFolder(c) && ObjectInterfaceNames(ReadObject(c)).Contains("IApplicationObject"), 0);

        // `FindByName` lived here — a name search over the whole project, case-SENSITIVE and matching any
        // non-transient node. Both of those were wrong (see Engine's Ide/ItemLookup, which replaced it and
        // TwinCAT's differently-wrong twin with one tested walk), and `IsTransient` went with it: nothing else
        // asked whether a node was transient.

        // Depth cap for the tree walk below: a guard against a cyclic / pathologically nested tree, not a limit
        // any real project reaches.
        private const int MaxTreeDepth = 14;

        /// <summary>Depth-first search for the first descendant matching <paramref name="match"/>.</summary>
        private object? FindFirst(object? node, Func<object, bool> match, int depth)
        {
            if (node == null || depth > MaxTreeDepth) return null;
            foreach (var child in GetChildren(node))
            {
                if (match(child)) return child;
                var hit = FindFirst(child, match, depth + 1);
                if (hit != null) return hit;
            }
            return null;
        }

        public object? ParentOf(object node) => GetMember(Unwrap(node), "parent");

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
