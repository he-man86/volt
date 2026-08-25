using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Wire;
using Volt.Engine;
using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Vocabulary;

namespace Volt.Cli.Ide.Twincat;

/// <summary>Beckhoff driver — the <see cref="IProjectTree"/> facet: the walk/lookup/CRUD ALGORITHM over
/// the TwinCAT tree. The raw COM moves (child access, name, item-type, create/delete/rename) go through
/// <see cref="TcObjectModel"/>; <see cref="ItemRef"/> wraps an opaque COM tree item (no <c>dynamic</c>
/// here). The per-node try/catch is the walk's own defence against a COM node that faults mid-walk.</summary>
public sealed partial class BeckhoffDriver
{
    public ItemRef GetPlcProjectRoot() => new(_om.PlcRoot());

    // TwinCAT's walk starts AT the PLC project root (folder paths are relative to it), so the tree root and the
    // PLC-project root are the same node — full and relative toFolder coincide, and this stays a no-op vs CODESYS.
    public ItemRef GetTreeRoot() => new(_om.PlcRoot());

    public IReadOnlyList<ProjectItem> WalkItems()
    {
        var items = new List<ProjectItem>();
        WalkInner(_om.PlcRoot(), "", items);
        WalkIoDevices(items);
        return items;
    }

    private void WalkInner(object node, string folderPath, List<ProjectItem> items)
    {
        // A COM node that faults mid-walk is skipped (never break the whole walk) — but LOG it (Debug, so a
        // healthy project stays quiet) so a silently-dropped item is diagnosable. A swallowed materialize error
        // like this once hid a real read bug (FB-with-method / interface) for a long time.
        int count;
        try { count = _om.ChildCount(node); } catch (Exception ex) { VoltLog.Debug($"walk: ChildCount faulted at folder='{folderPath}': {ex.Message}"); return; }
        for (int i = 1; i <= count; i++)
        {
            object child;
            try { child = _om.ChildAt(node, i); } catch (Exception ex) { VoltLog.Debug($"walk: ChildAt({i}) faulted at folder='{folderPath}': {ex.Message}"); continue; }
            string name;
            try { name = _om.GetName(child); } catch (Exception ex) { VoltLog.Debug($"walk: GetName faulted at folder='{folderPath}' index={i}: {ex.Message}"); continue; }
            int itemType = ClassifiedKind(child);

            // A plain folder OR a container-manager (library / recipe / visualization manager) is a FOLDER, not a
            // file: recurse its children under a folder named after it, emit no item for the container itself.
            // (The library manager was already handled this way; container-managers now share one rule across
            // both drivers — the wire parity boundary.)
            if (itemType == ItemKind.PlcFolder || ItemKind.IsContainerManager(itemType))
            {
                var nested = FolderPath.Append(folderPath, name);
                WalkInner(child, nested, items);
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
                VoltLog.Warn($"twincat: '{name}' child count unreadable — its subtree is OMITTED from this walk: {ex.Message}");
                childCount = 0;
            }
            bool isHybrid = childCount > 0 && !ItemKind.IsTopLevelCrud(itemType);
            string emitFolder = isHybrid ? FolderPath.Append(folderPath, name) : folderPath;

            items.Add(new ProjectItem(name, new ItemRef(child), itemType, emitFolder));
            if (isHybrid) WalkInner(child, emitFolder, items);
        }
    }

    private void WalkIoDevices(List<ProjectItem> items)
    {
        object tiid;
        try { tiid = _om.LookupTreeItem("TIID"); } catch { return; }
        int count;
        try { count = _om.ChildCount(tiid); } catch { return; }
        for (int i = 1; i <= count; i++)
        {
            object device;
            try { device = _om.ChildAt(tiid, i); } catch { continue; }
            string name;
            try { name = _om.GetName(device); }
            catch (Exception ex) { VoltLog.Warn($"twincat: an I/O device name is unreadable — the device is omitted: {ex.Message}"); continue; }
            // Encode the synthetic label like any other segment — "I/O Devices" carries a literal '/'.
            items.Add(new ProjectItem(name, new ItemRef(device), ClassifiedKind(device), FolderPath.Encode("I/O Devices")));
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

    public ItemRef CreateChild(ItemRef parent, string name, int kindCode, string? language = null) => new(_om.CreateChild(parent.Native, name, kindCode, language));
    public void Delete(ItemRef parent, string name) => _om.DeleteChild(parent.Native, name);
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
        if (!Enumerable.Range(1, ChildCount(target)).Any(i => Name(ChildAt(target, i)) == name))
            throw new BridgeException(BridgeErrorCodes.NotFound,
                $"moved '{name}' but it is not under the target folder afterwards");
    }

    // TwinCAT reports EVERY DUT as one tree type (623 = ItemKind.PlcDut) — a DUT is a single wire kind (`dut`),
    // so we emit the raw code as-is. The struct/enum/union/alias distinction is NOT computed on a read (its only
    // consumer was the four-way extension, now unified to `.dut`); it is derived from the declaration on push-
    // create only. This drops the per-DUT declaration read the walk used to pay.
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
