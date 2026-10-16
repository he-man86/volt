using System;
using System.Collections.Generic;
using System.Reflection;
using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Format.Body;
using Volt.Engine.Item;

namespace Volt.Ide.Codesys;

/// <summary>CODESYS driver — the <see cref="IProjectTree"/> facet: walk the object-model tree and
/// classify/CRUD nodes. <see cref="ItemRef"/> wraps a raw object-model node (or a synthetic
/// <c>LibRefNode</c> for a library reference).</summary>
public sealed partial class CodesysDriver
{
    public WalkResult WalkItems()
    {
        // A walk starts an operation (fetch, refs, push, build), and the project's declarations are read afresh for
        // it: an item created or renamed since the last one must be in the scope network text is written and read
        // against (ProjectDeclarations), or a pulled call through it would go to the marker as undeclared.
        _declarations = null;
        var items = new List<ProjectItem>();
        var unwalked = new List<string>();
        var unreadable = new List<UnreadableObject>();
        var root = _om.PrimaryProject;
        if (root != null) Walk(root, "", items, unwalked, unreadable);
        return new WalkResult(items, unwalked, unreadable);
    }

    // The walk mirrors the CODESYS project tree 1:1 into workspace paths. Every container — a user folder, a
    // structural node (PLC Logic / Application / Task Configuration), or a device — nests its children under its
    // own name, so the tree reads exactly as the IDE: Device → Plc Logic → Application → usercode, with the
    // hardware devices as siblings under Device. Nothing is flattened; the only per-kind logic is WHAT each leaf
    // emits (source text vs a device descriptor vs a library reference).
    private void Walk(object node, string folderPath, List<ProjectItem> items, List<string> unwalked,
                      List<UnreadableObject> unreadable)
    {
        // Guard the child read: recursing an unclassified GenericContainer may reach an opaque subtree whose
        // children are unreadable — that must stop this branch, not crash the whole walk (matches Beckhoff).
        // Surface the failure (no-fallback policy) rather than swallowing it silently. BridgeLog writes both
        // sinks; see it for why one is not enough.
        IReadOnlyList<object> children;
        try { children = _om.GetChildren(node); }
        catch (Exception ex)
        {
            // Logged at Warn already — correctly, per the no-fallback policy — but a log cannot be acted on by
            // the caller. `FetchService` derives DELETIONS from absence, so it has to be TOLD, not informed.
            BridgeLog.Warn($"could not read children of folder='{folderPath}' (subtree skipped): {ex.Message}");
            unwalked.Add(folderPath);   // "" is the root: Removal reads it as covering everything
            return;
        }
        foreach (var child in children)
        {
            var name = _om.GetName(child);
            // ONE OBJECT NEVER FAILS THE WALK. Classifying reads the child's object, and that read was unguarded:
            // one failure threw out of WalkItems and `refs` answered INTERNAL_ERROR for the whole project (openspec
            // codesys-refs-guid-int32 — measured on a Pro2193 copy). The object is named instead, with its folder,
            // and WalkResult counts that folder as not fully read: its kind is unknown, so nothing there is
            // "deleted". Matches the TwinCAT walk's classification catch.
            //
            // ONLY a fault of THIS object. A binder failure (`Reflection.Overload`: an ambiguous or non-fitting
            // overload — `AmbiguousMatchException`, `MissingMethodException`) or a vendor member that is not there at
            // all (`MissingMemberException`) is the bridge disagreeing with the IDE's surface: it would hit EVERY
            // object, and caught here it would answer a successful walk with every object unreadable — so it fails
            // the operation, by name.
            int code;
            try { code = KindCodeOf(child); }
            catch (Exception ex) when (ex is not (MissingMemberException or AmbiguousMatchException))
            {
                BridgeLog.Warn($"could not read the kind of '{name}' in folder='{folderPath}' (named unreadable): {ex.Message}");
                unreadable.Add(new UnreadableObject(name, folderPath, ex.Message));
                continue;
            }

            // A device-tree node (controller, fieldbus master, drive, axis, I/O module — all IDeviceObject): emit
            // a read-only `.device` descriptor and mirror its subtree. A device WITH children gets a folder named
            // after it and keeps its descriptor INSIDE that folder (Coupler_I_O_moduls/Coupler_I_O_moduls.device)
            // so the node reads together with its children; a childless leaf is a plain file at the parent level.
            if (code == ItemKind.Device)
            {
                var deviceFolder = FolderPath.Append(folderPath, name);
                var hasChildren = HasChildren(child);
                items.Add(new ProjectItem(name, new ItemRef(child), ItemKind.PlcDevice,
                    hasChildren ? deviceFolder : folderPath));
                if (hasChildren) Walk(child, deviceFolder, items, unwalked, unreadable);
                continue;
            }
            // Any other container — a user folder or a structural node (PLC Logic, Application, Task Configuration,
            // the SoftMotion "Kinematics" / drive "Functions" groupers) — nests its children under its own name.
            if (code == ItemKind.PlcFolder || CodesysTypeMap.IsRecurseOnlyContainer(code))
            {
                // WHAT THE CONTAINER HOLDS THAT NO TEXT SPELLS (openspec bridge-one-to-one §1.1; gate review of step 3,
                // finding 3) is named in the pull report: an excluded folder's objects are not walked (they are not
                // built, and nothing would read them as excluded — so neither pulled as built nor read as deleted); an
                // application's or the Task Configuration's setting is listed, and what is under them is walked.
                (string Reason, bool Inside)? held;
                try { held = _om.ContainerRefusal(child); }
                catch (Exception ex) when (ex is not (MissingMemberException or AmbiguousMatchException))
                {
                    BridgeLog.Warn($"could not read the properties of '{name}' in folder='{folderPath}' (named unreadable): {ex.Message}");
                    unreadable.Add(new UnreadableObject(name, folderPath, ex.Message));
                    continue;
                }
                var sub = FolderPath.Append(folderPath, name);
                if (held is { } refusal)
                {
                    BridgeLog.Warn($"pull: {refusal.Reason}");
                    // Its kind is KNOWN (a container), so it is no object of unknown kind: the folder it sits in was
                    // walked whole, and absence beside it still means deleted (gate review of step 3, finding 1 — recorded
                    // with no kind, it put its PARENT into UnwalkedFolders, at the root the whole project).
                    unreadable.Add(new UnreadableObject(name, folderPath, refusal.Reason, Array.Empty<string>()));
                    if (!refusal.Inside)
                    {
                        // An EXCLUDED folder's objects are not built, so none is pulled as a built one — but each is
                        // NAMED, with its kind, never left unseen: a known one is kept (not read as deleted), an op on
                        // one is refused by name, and the walk stays complete, so the push pre-flight still decides
                        // every create (`WillCreate`). Walked as any folder, then reported instead of published.
                        var held2 = new List<ProjectItem>();
                        Walk(child, sub, held2, unwalked, unreadable);
                        foreach (var it in held2)
                            if (ItemKind.Map(it.KindCode) is { } kind)
                                unreadable.Add(new UnreadableObject(it.Name, it.Folder,
                                    $"'{it.Name}' sits in the excluded folder '{sub}' — it is not built, so it is not pulled as a built one",
                                    new[] { kind }));
                        continue;
                    }
                }
                Walk(child, sub, items, unwalked, unreadable);
                continue;
            }
            if (CodesysTypeMap.IsSkipped(code)) continue;       // transient/hidden/unknown
            if (ItemKind.IsInlinedInPou(code)) continue;        // collected inside the POU

            // A container-manager (library / recipe / visualization manager) is a FOLDER, not a file: it groups
            // its children and has no content of its own, so we emit NO stub item for it — only its children,
            // nested under a folder named after it. This matches the Beckhoff walk and fixes the redundant
            // `<Manager>.<kind>` stub (which also duplicated when two same-named managers exist at different tree
            // levels — e.g. a project-level and an Application-level "Library Manager").
            if (ItemKind.IsContainerManager(code))
            {
                var managerFolder = FolderPath.Append(folderPath, name);
                if (code == ItemKind.PlcLibMan)
                    // The library manager's children are SYNTHESIZED from ILibManObject (not tree children).
                    // A placeholder library's name can carry a Windows-illegal char (the '*' wildcard version,
                    // e.g. "SysTypes2 Interfaces, * (System)") — encode it so the .library file still materializes.
                {
                    // THE MANAGER IS ONE ITEM, NOT THE OP (environment-dependency-audit 2.0): a member its read cannot
                    // take — absent on a platform no census measured without it, or present and failing — names the
                    // manager unreadable and the walk goes on. Uncaught, it failed every op that walks (212 of 218 SP18
                    // e2e failures). Its kind is known (a container), so only its OWN folder is unwalked: no `.library`
                    // file there is read as removed, and absence beside the manager still means deleted. A binder
                    // failure is the bridge disagreeing with the IDE's surface and fails the op, as for every object.
                    List<LibRefNode> refs;
                    List<string> unspelled;
                    try { refs = _om.GetLibraryRefs(child, out unspelled); }
                    catch (Exception ex) when (ex is not (MissingMemberException or AmbiguousMatchException))
                    {
                        BridgeLog.Warn($"could not read the library manager '{name}' in folder='{folderPath}' (named unreadable): {ex.Message}");
                        unreadable.Add(new UnreadableObject(name, folderPath, ex.Message, Array.Empty<string>()));
                        unwalked.Add(managerFolder);
                        continue;
                    }
                    foreach (var lib in refs)
                        items.Add(new ProjectItem(FolderPath.Encode(lib.Name), new ItemRef(lib), ItemKind.PlcLibRef, managerFolder));
                    // What the manager holds that no manifest spells is named in the pull report (openspec
                    // bridge-one-to-one §1.1 library manager; gate review of step 3, finding 4) — its references walked.
                    foreach (var why in unspelled)
                    {
                        BridgeLog.Warn($"pull: '{name}' {why}");
                        unreadable.Add(new UnreadableObject(name, folderPath, $"'{name}' {why}.", Array.Empty<string>()));
                    }
                }
                else
                    // Recipe / visualization managers hold real tree children (recipe definitions, visualizations).
                    Walk(child, managerFolder, items, unwalked, unreadable);
                continue;
            }

            items.Add(new ProjectItem(name, new ItemRef(child), code, folderPath));
        }
    }

    // The walk starts here (PrimaryProject), so a full toFolder like "Device/Plc Logic/Application/POUs" resolves
    // by descending from the same origin — the structural nodes (Device/Plc Logic/Application) are matched, not
    // re-created as user folders under the Application (which doubled the path).
    public ItemRef GetTreeRoot() =>
        new(_om.PrimaryProject ?? throw new InvalidOperationException("CODESYS: no primary project"));

    /// <summary>Does the node have any children? This decides where a device descriptor is PLACED, so a wrong
    /// answer moves the item to a different folder — which reads to the workspace as a move, not as an error.
    /// The read is unguarded: an unreadable subtree is a real failure and belongs to the caller, who logs it per
    /// item (<c>Versioning.SafeVersion</c>) and names which one. Answering "false" here silently placed the
    /// descriptor somewhere else instead.</summary>
    private bool HasChildren(object node) => _om.GetChildren(node).Count > 0;

    public int ChildCount(ItemRef item) => _om.GetChildren(item.Native).Count;
    public ItemRef ChildAt(ItemRef parent, int index1Based) => new(_om.GetChildren(parent.Native)[index1Based - 1]);
    public ItemRef Parent(ItemRef item) => new(_om.ParentOf(item.Native)!);
    public string Name(ItemRef item) => item.Native is LibRefNode lib ? lib.Name : _om.GetName(item.Native);
    // ponytail: KindCode answers the RAW classification, so a device node reads as ItemKind.Device (692, the
    // recurse-only spine) here while Walk() emits that same node as ItemKind.PlcDevice (695, the read-only
    // descriptor it materializes). The split is ItemKind's own (see its comment on PlcDevice), not drift — but it
    // does mean one node has two codes depending on which member you ask. Nothing consumes both today; a caller that
    // needs the EMITTED kind must apply the same Device→PlcDevice promotion Walk does, or ItemKind.Map() will hand
    // it the null it deliberately maps 692 to.
    public int KindCode(ItemRef item) => KindCodeOf(item.Native);

    public ItemRef CreateChild(ItemRef parent, string name, int kindCode, string? seed, ObjectClass? cls)
    {
        try { return new(_om.CreateChild(parent.Native, name, kindCode, seed, cls)); }
        catch (Exception ex) when (Refusal(ex) is { } why) { throw new ChildRefusedException(why.Message, why.Cause, ex); }
    }

    /// <summary>Is this CODESYS's own refusal of a child under its parent? Measured wording (SP21, DIALECT C2k,
    /// `kind-audit2.log` (deleted; `git show b2496efb4b:packages/volt-cli/scripts/kind-audit2.log`)): "Object 'Method' is not accepted by parent object, or invalid (e. g. missing plugin or
    /// device description)" — for a member under FUNCTION text, and a method or property under text that declares
    /// nothing. Anything else (a stale handle, a transport fault) is not a refusal and is not reported as one.
    /// The vendor's message, from wherever it sits in the chain (a reflective call wraps it), or null.</summary>
    public static string? ChildRefusal(Exception ex) => Refusal(ex)?.Message;

    /// <summary>The push pre-flight's NAME refusal (<c>ICodeStore.RefusedName</c>, openspec <c>push-keeps-what-landed</c>
    /// 3.1): a word CODESYS was measured to refuse for a new POU or METHOD / ACTION / PROPERTY (<see cref="CodesysRefusedNames"/>, the
    /// probe logs), answered in the words the IDE uses — or null for a word it took or was never asked.</summary>
    public override string? RefusedName(string kind, string name) => NameRefusal(kind, name);

    /// <summary>Whether CODESYS refuses <paramref name="name"/> as a POU's name (<see cref="NameRefusal"/>, measured).
    /// Network scope asks it of a variable's declared type: a word no POU can be named is no function block a body
    /// calls (openspec <c>bridge-refusal-review</c> D4) — <c>INT</c>, <c>ARRAY</c>, and on CODESYS <c>LDT</c>.</summary>
    internal static bool RefusedPouName(string name) => NameRefusal(ItemKind.Kinds.Pou, name) is not null;

    /// <summary>The push pre-flight's task refusal (<c>ICodeStore.ValidateTask</c>): a `Type:` the vendor's
    /// <c>KindOfTask</c> does not NAME — BAD_REQUEST, by the same lookup the descriptor write makes, so the batch's earlier
    /// ops are not written before the request's own fault is found.</summary>
    public override void ValidateTask(Volt.Engine.Format.Task.TaskSettings settings)
    {
        CodesysObjectModel.TaskKind(settings.Type);
        CodesysObjectModel.RequireWatchdog(settings);
        CodesysObjectModel.RequireCodesysMembers(settings);
    }

    /// <summary>A measured word (for the kinds the words were asked on), or an ASCII name SHAPE SP21 refused for every
    /// kind (openspec <c>bridge-refusal-review</c> 3.1, <c>scripts/vendor-facts.codesys.json, fact identifier-shapes</c>):
    /// no identifier and no backtick-quoted name. Both answer with the same vendor sentence — measured, the IDE words them
    /// alike. A name holding a character past ASCII is the IDE's to judge, by the project's "Unicode identifiers" option
    /// (DIALECT C28b, openspec <c>codesys-existing-unicode-members</c>): it reaches the IDE, whose refusal comes back in
    /// its own words.</summary>
    internal static string? NameRefusal(string kind, string name) =>
        (Volt.Engine.Ide.MeasuredNames.WordMeasuredFor(kind, name) && CodesysRefusedNames.Words.Contains(name))
        || (Volt.Engine.Ide.MeasuredNames.IsAsciiNonIdentifier(name) && !IsBacktickQuoted(name))
            ? $"CODESYS does not take '{name}' as a name (\"The name '{name}' is not valid for this object.\")"
            : null;

    /// <summary>CODESYS CREATES a name that opens with a backtick and holds a second one — whatever stands between them
    /// (a hyphen, a space, a keyword, nothing) and after (<c>`a`b</c>) — for all six kinds, and builds it clean; one that
    /// never closes (<c>`ab</c>) or a backtick inside a plain name (<c>a`b</c>) is refused (measured, 3.1). TwinCAT refuses
    /// every backtick name. The ST reader keeps a quoted name whole — a blank or a colon between the backticks is the
    /// name's (<c>StReader.Words</c>) — so every such name reaches this answer.</summary>
    private static bool IsBacktickQuoted(string name) => name.Length >= 2 && name[0] == '`' && name.IndexOf('`', 1) > 0;

    /// <summary>The refusal and what it refuses: the child's KIND under this parent (above), or its NAME —
    /// "The name 'Log' is not valid for this object." — a METHOD named <c>Log</c> under a function block (SP21, openspec
    /// <c>push-keeps-what-landed</c> 1.1, measured live 2026-10-03): the NAME is refused, whatever the declaration says.
    /// Only measured wording; no guessed reserved-word list — in every language CODESYS ships.</summary>
    public static (string Message, ChildRefusalCause Cause)? Refusal(Exception ex)
    {
        for (Exception? e = ex; e is not null; e = e.InnerException)
        {
            // In the IDE's own language (CodesysRefusalWording, DIALECT V9): a German CODESYS refuses in German.
            if (CodesysRefusalWording.Of(e.Message) is { } cause) return (e.Message, cause);
        }
        return null;
    }
    /// <summary>CODESYS has no scripting call to add a property's missing Get or Set — a vendor "cannot", so a
    /// <see cref="NotSupportedException"/> (the push reports it UNSUPPORTED). Raised inside the push's apply loop (the
    /// accessor reconcile), it can reach a conflict on an ACCEPTED push, so it names what the IDE can do and no client
    /// command (openspec <c>push-keeps-what-landed</c> gate step 2: it said "Add it in the IDE, then pull.", unclassified).
    /// <paramref name="offers"/>: the create calls the member container DOES expose.</summary>
    internal static NotSupportedException NoAccessorCreate(string name, string offers) =>
        new($"CODESYS: cannot create the '{name}' accessor — CODESYS creates a property's Get/Set with the property " +
            "itself, and exposes no scripting call to add one afterwards; only the IDE's own editor can add it. " +
            "(member container offers: " + offers + ")");

    public void Delete(ItemRef parent, string name) => _om.DeleteChild(parent.Native, name);
    /// <summary>Enumerated directly — in-process CODESYS has no problem with it, unlike TwinCAT's COM.</summary>
    public (bool Get, bool Set) InterfacePropertyAccessors(ItemRef property)
    {
        bool get = false, set = false;
        int n = ChildCount(property);
        for (int i = 1; i <= n; i++)
        {
            var code = KindCode(ChildAt(property, i));
            if (code is ItemKind.PlcPropGet or ItemKind.PlcItfPropGet) get = true;
            else if (code is ItemKind.PlcPropSet or ItemKind.PlcItfPropSet) set = true;
        }
        return (get, set);
    }

    /// <summary>Live scripting objects: adding or removing a child does not disturb a handle to its parent.</summary>
    public bool HandlesSurviveStructureChange => true;

    public void Rename(ItemRef item, string newName) => _om.Rename(item.Native, newName);
    public void Move(ItemRef item, ItemRef target) => _om.Move(item.Native, target.Native);

    private int KindCodeOf(object node)
    {
        if (node is LibRefNode) return ItemKind.PlcLibRef;
        if (_om.IsFolder(node)) return ItemKind.PlcFolder;
        var iobj = _om.ReadObject(node);
        // The CLASS decides, and no aspect is read: a POU is `X.pou` whatever its text says (openspec
        // `push-without-header-check` 5.Q), so the walk no longer opens a POU's declaration to name it.
        return CodesysTypeMap.CodeForObject(_om.ObjectInterfaceNames(iobj), false, _om.GetName(node), iobj);
    }
}


