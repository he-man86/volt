using System;
using System.Xml.Linq;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine;
using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Task;
using Volt.Engine.Item;

namespace Volt.Ide.Twincat;

/// <summary>Beckhoff driver — the <see cref="IProjectTree"/> facet: the walk/lookup/CRUD ALGORITHM over
/// the TwinCAT tree. The raw COM moves (child access, name, item-type, create/delete/rename) go through
/// <see cref="TcObjectModel"/>; <see cref="ItemRef"/> wraps an opaque COM tree item (no <c>dynamic</c>
/// here). The per-node try/catch is the walk's own defence against a COM node that faults mid-walk.</summary>
public sealed partial class BeckhoffDriver
{

    // TwinCAT's walk starts AT the PLC project root (folder paths are relative to it), so the tree root and the
    // PLC-project root are the same node — full and relative toFolder coincide, and this stays a no-op vs CODESYS.
    public ItemRef GetTreeRoot() => new(_om.PlcRoot());

    /// <summary>Apply a task's settings — the mirror of the `.task` descriptor <c>ReadManifest</c> renders, so
    /// the pair cannot drift. The two tree items involved, and the fields TwinCAT cannot express (which are
    /// REFUSED, never dropped), are <see cref="TcTaskSchedule"/>'s subject.</summary>
    public void WriteTask(ItemRef task, TaskSettings settings) => _om.WriteTask(task.Native, settings);

    public WalkResult WalkItems()
    {
        // A walk starts an operation (fetch, refs, push, build), and the project's declarations are read afresh for
        // it: an item created or renamed since the last one must be in the scope network text is written and read
        // against (ProjectDeclarations), or a pulled call through it would go to the marker as undeclared.
        _declarations = null;
        // The Solution Explorer snapshot is read FIRST, outside the per-node catches below: without it the walk cannot
        // know which child would crash XAE, so an unreadable hierarchy fails the walk rather than being swallowed as a
        // child fault (DIALECT C2i).
        _om.ForgetExplorer();
        _om.Explorer();
        var items = new List<ProjectItem>();
        var unwalked = new List<string>();
        var unreadable = new List<UnreadableObject>();
        WalkInner(_om.PlcRoot(), "", items, unwalked, unreadable);
        WalkIoDevices(items, unwalked);
        return new WalkResult(items, unwalked, unreadable);
    }

    private void WalkInner(object node, string folderPath, List<ProjectItem> items, List<string> unwalked,
                           List<UnreadableObject> unreadable)
    {
        // A COM node that faults mid-walk is skipped (never break the whole walk) — but LOG it (Debug, so a
        // healthy project stays quiet) so a silently-dropped item is diagnosable. A swallowed materialize error
        // like this once hid a real read bug (FB-with-method / interface) for a long time.
        int count;
        try { count = _om.ChildCount(node); }
        catch (Exception ex)
        {
            // The ENTIRE subtree is lost here, not one item. Recorded as well as logged: the log was at Debug,
            // which is off by default, and the caller that derives DELETIONS from absence never saw it — so a
            // single faulting folder made `volt pull` delete every file beneath it.
            VoltLog.Warn($"walk: ChildCount faulted at folder='{folderPath}' — SUBTREE SKIPPED: {ex.Message}");
            unwalked.Add(folderPath);   // "" is the root: Removal reads it as covering everything
            return;
        }
        for (int i = 1; i <= count; i++)
        {
            object child;
            try { child = _om.ChildAt(node, i); }
            catch (UnreadableItemException untouchable)
            {
                // NAMED, never opened: a POU the IDE does not read as a POU, whose tree item crashes XAE after a load
                // (DIALECT C2i). Its kind family is known, so it is no container and this folder still counts as walked.
                VoltLog.Warn($"walk: '{untouchable.Name}' at folder='{folderPath}' is not opened: {untouchable.Reason}");
                unreadable.Add(new UnreadableObject(untouchable.Name, folderPath, untouchable.Reason, untouchable.Kinds));
                continue;
            }
            catch (Exception ex)
            {
                // One child lost rather than a subtree — still enough to make absence meaningless.
                VoltLog.Warn($"walk: ChildAt({i}) faulted at folder='{folderPath}': {ex.Message}");
                unwalked.Add(folderPath);   // "" is the root: Removal reads it as covering everything
                continue;
            }
            string name;
            try { name = _om.GetName(child); }
            catch (Exception ex)
            {
                VoltLog.Warn($"walk: GetName faulted at folder='{folderPath}' index={i}: {ex.Message}");
                unwalked.Add(folderPath);   // "" is the root: Removal reads it as covering everything
                continue;
            }
            // Classification faults where every other read in this loop does - and is recorded the same way, so
            // absence under this folder stops meaning "deleted". It used to be swallowed one layer down.
            int itemType;
            try { itemType = ClassifiedKind(child); }
            catch (Exception ex)
            {
                // NAMED, not only folder-marked: the walk knows which object it was, and `refs`/`fetch` list it in
                // `unreadable` (WalkResult derives the folder) — the same answer the CODESYS walk gives (openspec
                // codesys-refs-guid-int32; the parity boundary is the wire).
                VoltLog.Warn($"walk: kind unreadable for '{name}' at folder='{folderPath}': {ex.Message}");
                unreadable.Add(new UnreadableObject(name, folderPath, ex.Message));
                continue;
            }

            // A plain folder OR a container-manager (library / recipe / visualization manager) is a FOLDER, not a
            // file: recurse its children under a folder named after it, emit no item for the container itself.
            // (The library manager was already handled this way; container-managers now share one rule across
            // both drivers — the wire parity boundary.)
            if (itemType == ItemKind.PlcFolder || ItemKind.IsContainerManager(itemType))
            {
                var nested = FolderPath.Append(folderPath, name);
                WalkInner(child, nested, items, unwalked, unreadable);
                continue;
            }
            if (ItemKind.IsInlinedInPou(itemType)) continue;

            // Surface (once) a real PLC tree-item code we don't classify — a kind we may be missing. Logged,
            // NOT thrown: one unknown node must never break the walk. (Unknown=-2 read-failures aren't logged.)
            if (itemType > 0 && ItemKind.Map(itemType) is null)
                WarnUnmappedTcCode(itemType, name);

            // NOT `catch { childCount = 0; }`. A COM fault here used to read as "this node has no children", so
            // isHybrid went false and the whole SUBTREE was skipped — every item under it silently absent from
            // refs/fetch, and absent means DELETED to a pull. One unreadable node must not break the walk (the
            // WarnUnmappedTcCode line above is the established policy), but it must be SAID.
            int childCount;
            try { childCount = _om.ChildCount(child); }
            catch (Exception ex)
            {
                // SAID on the channel the caller can act on, not only to the log. The three sibling catches in
                // this method all append here; this one did not, so `WalkResult.Complete` stayed TRUE and
                // `FetchService` did not suppress deletions - a pull then deleted files for items still in the
                // IDE, which is the precise failure `WalkResult` exists to prevent. A log line no code reads is
                // not a signal.
                var lost = FolderPath.Append(folderPath, name);
                VoltLog.Warn($"twincat: '{name}' child count unreadable — its subtree is OMITTED from this walk: {ex.Message}");
                unwalked.Add(lost);
                childCount = 0;
            }
            // A node whose children are all folded into its own body (a task's POU calls) is a FILE, not a
            // folder — otherwise it opens one named after itself for children the walk never emits.
            bool isHybrid = childCount > 0 && !ItemKind.IsTopLevelCrud(itemType) && !ItemKind.InlinesItsChildren(itemType);
            string emitFolder = isHybrid ? FolderPath.Append(folderPath, name) : folderPath;

            items.Add(new ProjectItem(name, new ItemRef(child), itemType, emitFolder));
            if (isHybrid) WalkInner(child, emitFolder, items, unwalked, unreadable);
        }
    }

    /// <summary>The I/O tree, walked under the synthetic <c>I/O Devices</c> folder.
    ///
    /// <para><b>It takes <paramref name="unwalked"/> for the same reason <see cref="WalkInner"/> does.</b> Every
    /// catch here used to answer <c>return</c> or <c>continue</c> and record NOTHING, so a COM fault on the TIID
    /// node left <c>WalkResult.Complete</c> TRUE — and <c>Complete</c> is the one signal that stops <c>fetch</c>
    /// deriving DELETIONS from absence. A transient fault therefore reads as "these devices are gone" and takes
    /// the engineer's descriptors with it. That is the identical failure the four catches in <c>WalkInner</c>
    /// each carry a comment about; this method was written without them.</para>
    ///
    /// <para>A failure to resolve TIID is reported as unwalked rather than as "this project has no I/O", because
    /// the two are indistinguishable here and only one of them is safe to guess wrong: reporting unwalked
    /// suppresses deletions for this pull, while guessing "no I/O" deletes files. Every XAE-bound project has a
    /// TIID node, so this is a fault path, not a shape a real project takes. (Telling genuine absence from an
    /// unreadable node needs the not-found HRESULT — the same narrowing <c>LookupPath</c> wants; until that is
    /// measured, failing toward "keep the files" is the honest default.)</para></summary>
    private void WalkIoDevices(List<ProjectItem> items, List<string> unwalked)
    {
        // The synthetic label carries a literal '/', so it is encoded like any other segment.
        var ioFolder = FolderPath.Encode("I/O Devices");

        object tiid;
        try { tiid = _om.LookupTreeItem("TIID"); }
        catch (Exception ex)
        {
            VoltLog.Warn($"twincat: the I/O tree (TIID) is unreadable — every device is OMITTED from this walk: {ex.Message}");
            unwalked.Add(ioFolder);
            return;
        }

        int count;
        try { count = _om.ChildCount(tiid); }
        catch (Exception ex)
        {
            VoltLog.Warn($"twincat: the I/O device count is unreadable — every device is OMITTED from this walk: {ex.Message}");
            unwalked.Add(ioFolder);
            return;
        }

        WalkIoNode(tiid, ioFolder, items, unwalked);
    }

    /// <summary>One level of the I/O tree, recursing into every device that has children.
    ///
    /// <para><b>Kind is <see cref="ItemKind.PlcDevice"/>, not the raw TwinCAT tree code.</b> Measured on a live
    /// XAE: an EtherCAT master reports <c>ItemType 2</c> and an EK1100 coupler <c>ItemType 5</c>, both far below
    /// the 601-657 PLC range <c>ItemKind.Map</c> covers, so every device fell through to unmapped and was dropped
    /// by <c>fetch</c>, <c>refs</c> and <c>push</c> alike. The walk paid a live COM round trip per device and
    /// emitted nothing an engineer ever saw. <c>PlcDevice</c> (695) is the kind CODESYS already emits for the
    /// same thing, and its own definition names this case ("a TC bridge would map its I/O tree here").</para>
    ///
    /// <para><b>The folder rule is CODESYS's, deliberately.</b> A device WITH children becomes a folder named
    /// after it and keeps its own descriptor inside that folder, so the node reads together with what hangs off
    /// it; a childless leaf is a plain file beside its siblings. Same shape on both vendors, so a workspace laid
    /// out from a TwinCAT project looks like one laid out from a CODESYS project.</para></summary>
    private void WalkIoNode(object node, string folderPath, List<ProjectItem> items, List<string> unwalked)
    {
        int count;
        try { count = _om.ChildCount(node); }
        catch (Exception ex)
        {
            VoltLog.Warn($"twincat: the I/O children of '{folderPath}' are unreadable — that subtree is OMITTED " +
                         $"from this walk: {ex.Message}");
            unwalked.Add(folderPath);
            return;
        }

        for (int i = 1; i <= count; i++)
        {
            object device;
            try { device = _om.ChildAt(node, i); }
            catch (Exception ex)
            {
                VoltLog.Warn($"twincat: I/O device #{i} under '{folderPath}' is unreadable — it is OMITTED from " +
                             $"this walk: {ex.Message}");
                unwalked.Add(folderPath);
                continue;
            }
            string name;
            try { name = _om.GetName(device); }
            catch (Exception ex)
            {
                VoltLog.Warn($"twincat: an I/O device name is unreadable — the device is OMITTED from this walk: {ex.Message}");
                unwalked.Add(folderPath);
                continue;
            }

            int children;
            try { children = _om.ChildCount(device); }
            catch (Exception ex)
            {
                VoltLog.Warn($"twincat: the child count of I/O device '{name}' is unreadable — it and any subtree " +
                             $"are OMITTED from this walk: {ex.Message}");
                unwalked.Add(folderPath);
                continue;
            }

            var deviceFolder = FolderPath.Append(folderPath, name);
            items.Add(new ProjectItem(name, new ItemRef(device), ItemKind.PlcDevice,
                                      children > 0 ? deviceFolder : folderPath));
            if (children > 0) WalkIoNode(device, deviceFolder, items, unwalked);
        }
    }

    // No guard: a COM fault is a real failure and the caller (the walk, the folder map) decides. Answering 0
    // made an unreadable node look like a leaf, which drops its whole subtree; answering "" for a name (below)
    // fabricated the wire IDENTITY, and two blank names collapse onto each other.
    // No guard. A COM fault is a real failure and must reach the caller: answering 0 made an
    // unreadable or INVALIDATED node look like a childless one, which turned the push's orphan walk
    // into a silent no-op on every graphical TwinCAT push (the handle is invalidated by the PLCopen
    // import that precedes it). The walk in this file catches per node and logs, because a walk can
    // meaningfully skip one item; a caller asking about ONE item cannot.
    public int ChildCount(ItemRef item) => _om.ChildCount(item.Native);
    public ItemRef ChildAt(ItemRef parent, int index1Based) => new(_om.ChildAt(parent.Native, index1Based));
    public ItemRef Parent(ItemRef item) => new(_om.Parent(item.Native));
    public string Name(ItemRef item) => _om.GetName(item.Native);   // never "" — the name is the wire identity
    public int KindCode(ItemRef item) => ClassifiedKind(item.Native);

    public ItemRef CreateChild(ItemRef parent, string name, int kindCode, string? seed = null)
    {
        try { return new(_om.CreateChild(parent.Native, name, kindCode, seed)); }
        catch (Exception ex) when (Refusal(ex) is { } why) { throw new ChildRefusedException(why.Message, why.Cause, ex); }
    }

    /// <summary>Is this TwinCAT's own refusal of a child under its parent? Measured wording (TcXaeShell, DIALECT C2k,
    /// `tc-function-members.log`): "Creating the child type 'TREEITEMTYPE_PLCMETHOD' is not possible on parent node
    /// type 'TREEITEMTYPE_PLCPOUFB' (SubType mismatch)" — a method under FUNCTION text. Anything else (an "Unbound
    /// tree item", a COM fault) is not a refusal and is not reported as one.
    /// The vendor's message, from wherever it sits in the chain (a reflective call wraps it), or null.</summary>
    public static string? ChildRefusal(Exception ex) => Refusal(ex)?.Message;

    /// <summary>The refusal and what it refuses: the child's KIND under this parent (above), or its NAME —
    /// "… Creating the child named 'Log' is not possible on node (Name mismatch)" — a METHOD named <c>Log</c> under a
    /// function block (TcXaeShell, openspec <c>push-keeps-what-landed</c> 1.G F3, measured live 2026-10-03): the NAME
    /// is refused, whatever the declaration says.
    /// Only measured wording; no guessed reserved-word list.</summary>
    public static (string Message, ChildRefusalCause Cause)? Refusal(Exception ex)
    {
        for (Exception? e = ex; e is not null; e = e.InnerException)
        {
            if (e.Message.IndexOf("(SubType mismatch)", StringComparison.Ordinal) >= 0) return (e.Message, ChildRefusalCause.Kind);
            if (e.Message.IndexOf("(Name mismatch)", StringComparison.Ordinal) >= 0) return (e.Message, ChildRefusalCause.Name);
        }
        return null;
    }
    public void Delete(ItemRef parent, string name) => _om.DeleteChild(parent.Native, name);
    /// <summary>Which accessors an INTERFACE property has — by ENUMERATING its children, the same way a
    /// non-interface property is read one file over.
    ///
    /// <para><b>This replaced a read of the property's own metadata XML, which could never have worked.</b>
    /// That version called <c>ProduceXml(recursive: true)</c> and looked for nested <c>ItemName</c> elements
    /// named Get/Set. Measured on a live GET-only interface property: <c>ProduceXml(true)</c> returns output
    /// BYTE-IDENTICAL to <c>ProduceXml(false)</c> — metadata for the property alone, no children at any depth.
    /// It does carry <c>&lt;ChildCount&gt;1&lt;/ChildCount&gt;</c>, but a count cannot tell a GET-only property
    /// from a SET-only one. So the detection always answered "no accessors": the pull wrote a bare
    /// <c>PROPERTY x : T END_PROPERTY</c> and the next push DELETED the accessor the engineer had.</para>
    ///
    /// <para><b>And the reason it was written that way does not hold.</b> The comment said enumerating accessor
    /// COM children "can hard-crash TcXaeShell". Measured: walking into the property, reading the child's
    /// metadata and its <c>ItemType</c> (654 = <c>TREEITEMTYPE_PLCITFPROPGET</c>) leaves the shell alive. The
    /// real hazard, DIALECT D21, is WRITING an interface accessor's DECLARATION — which <c>WriteAccessor</c>
    /// refuses outright and still does.</para></summary>
    public (bool Get, bool Set) InterfacePropertyAccessors(ItemRef property)
    {
        bool get = false, set = false;

        // NO CATCH. An unreadable child must not read as "this property has no accessors" - PushService acts on
        // that answer by DELETING accessors, so a swallowed fault here destroys the engineer's code.
        int n = ChildCount(property);
        for (int i = 1; i <= n; i++)
        {
            var code = KindCode(ChildAt(property, i));
            if (code == ItemKind.PlcItfPropGet) get = true;
            else if (code == ItemKind.PlcItfPropSet) set = true;
        }
        return (get, set);
    }

    /// <summary>A member is not a separate file here, so placing one round-trips the enclosing POU through its own archive and the import REPLACES the item (DIALECT D4d/D4j) - every handle into it dies.</summary>
    public bool HandlesSurviveStructureChange => false;

    public void Rename(ItemRef item, string newName) => _om.Rename(item.Native, newName);

    /// <summary>Relocate an item, whole. TwinCAT has no <c>Move</c> member on its tree item — the dispatch
    /// surface of <c>ITcSmTreeItem</c> was enumerated off the shipped type library to settle that — but the
    /// export/import pair IS one once the archive's entry paths are flattened (<c>TcItemArchive</c>, DIALECT D4f).
    /// <para>This used to throw <c>Unsupported</c>, on a note that admitted the COM surface "has not been measured
    /// for an equivalent". It had not been: the earlier probe looked for a method with a PROPERTY read, which can
    /// never find one, and the one after it read the archive's path recreation as a vendor limit rather than as a
    /// zip entry name. Both are measured now, and the refusal was the thing standing between TwinCAT and the
    /// single-document write.</para>
    /// <para>Unlike <c>PushService</c>'s delete-and-recreate move (the arm a driver without this takes), the item
    /// travels as the IDE's own archive, so a GRAPHICAL body survives — nothing is rebuilt from text.</para></summary>
    public void Move(ItemRef item, ItemRef target)
    {
        var name = Name(item);

        // A POU MEMBER takes a different route, and the vendor forces it: `ExportChild` refuses a member because
        // TwinCAT keeps the whole POU — members and all — in ONE `.TcPOU`, so a member has no archive of its own.
        // Its placement is an attribute IN that file (`FolderPath`), which is what makes this expressible at all
        // (DIALECT D4j). So the round trip happens on the enclosing POU and only the attribute changes.
        if (_om.EnclosingPouOf(item.Native) is { } pou)
        {
            var pouName = _om.GetName(pou);
            var folder = _om.RelativePath(pou, target.Native);   // "" when the target IS the POU (back to its root)
            _om.MoveMember(_om.Parent(pou), pouName, name, folder);

            // CONFIRM it. The round trip reports success by side effect and has already deleted and re-imported
            // the POU by this point, so a placement that silently did not land would be indistinguishable from one
            // that did. Re-find the POU first: every handle into it is dead (D4d).
            var written = ItemLookup.Find(this, pouName)
                ?? throw new BridgeException(BridgeErrorCodes.NotFound,
                    $"placed '{name}' but its POU '{pouName}' cannot be found afterwards");
            var atPouRoot = Enumerable.Range(1, ChildCount(written)).Any(i => Name(ChildAt(written, i)) == name);
            if (atPouRoot != (folder.Length == 0))
                throw new BridgeException(BridgeErrorCodes.Unsupported,
                    $"'{name}' did not land in '{folder}' inside '{pouName}'");
            return;
        }

        _om.Move(_om.Parent(item.Native), target.Native, name);
        // The archive round trip returns no handle and reports success by side effect, so CONFIRM it: a move that
        // silently landed nowhere would otherwise be indistinguishable from one that worked, and the caller has
        // already written the item's content by this point.
        if (!HoldsChildNamed(target, name))
            throw new BridgeException(BridgeErrorCodes.NotFound,
                $"moved '{name}' but it is not under the target folder afterwards");
    }

    /// <summary>Does <paramref name="folder"/> hold a child named <paramref name="name"/>?</summary>
    private bool HoldsChildNamed(ItemRef folder, string name) => ChildNamed(folder, name) is not null;

    /// <summary><paramref name="folder"/>'s child named <paramref name="name"/> (case-insensitive, as IEC names are), or
    /// null. A child Volt must not open (DIALECT C2i) is passed over, unless it is that name: an item this session just
    /// wrote — moved, or re-imported through its archive — never lands as one, so that refusal propagates.</summary>
    private ItemRef? ChildNamed(ItemRef folder, string name)
    {
        var n = ChildCount(folder);
        for (var i = 1; i <= n; i++)
        {
            try
            {
                var child = ChildAt(folder, i);
                if (string.Equals(Name(child), name, StringComparison.OrdinalIgnoreCase)) return child;
            }
            catch (UnreadableItemException u) when (!string.Equals(u.Name, name, StringComparison.OrdinalIgnoreCase)) { }
        }
        return null;
    }

    // TwinCAT has FOUR DUT tree codes, not one: 605/606/607/623 = TREEITEMTYPE_PLCDUTENUM/STRUCT/UNION/ALIAS
    // (DIALECT C2b — 623 is the ALIAS code, not a generic DUT). An IDE-authored DUT carries its subtype's code
    // (ItemKind.cs, measured two ways). This comment used to claim "EVERY DUT is 623"; those three codes were
    // unmapped, so every such item was dropped by Core as an unknown kind — invisible to refs and fetch, and
    // absent means DELETED to a pull.
    // All four map onto the one internal DUT kind, so we emit the raw code as-is and Core maps it; the wire NAME
    // is `X.dut` for every one of them (`Materializer`). The code says nothing reliable about the shape anyway: a
    // push-create always seeds 606 whatever the body (`TcObjectModel.CreateChild`), and an in-place write of another
    // shape keeps the OLD code in the live session until a reload re-derives it (DIALECT C2e).
    private int ClassifiedKind(object node) => _om.ItemType(node);

    private static readonly HashSet<int> _loggedTcCodes = new HashSet<int>();

    /// <summary>Log an unmapped TwinCAT PLC tree-item code once, so a kind we may be missing is visible. The node is
    /// NOT skipped here — the walk emits it and Core drops it later as unmapped-kind; say so, because "(skipped)"
    /// sent a reader looking for a skip that never happens. To BOTH sinks, as the CODESYS walk does: VoltLog is the
    /// only one an engineer can read after a pull, stderr is what the headless dev loop and the connector's worker
    /// redirect capture.</summary>
    private static void WarnUnmappedTcCode(int code, string name) =>
        BridgeLog.WarnOnce(code.ToString(),
            $"unmapped TwinCAT TREEITEMTYPE {code} (emitted, then dropped by Core as unmapped-kind): " +
            $"example item='{name}' — add it to ItemKind if it should be tracked");
}
