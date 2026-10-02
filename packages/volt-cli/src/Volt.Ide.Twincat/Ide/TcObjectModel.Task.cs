using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Format.Task;
using Volt.Engine.Item;

namespace Volt.Ide.Twincat;

/// <summary>
/// A task's schedule and call list, over COM. The translation itself is <see cref="TcTaskSchedule"/> (pure, and
/// tested offline); what lives here is the pair of tree items a `.task` file is assembled from — the PLC task
/// node the caller hands in, and the SYSTEM task its <c>LinkedTask</c> names.
///
/// <para><b>Every write is READ BACK.</b> TwinCAT accepts <c>ConsumeXml</c> for fields it has no intention of
/// changing and reports nothing, and its tree items go stale after a mutation. A push that returns success over
/// an unchanged schedule is the one outcome worth failing for: the engineer's file would then claim a cycle time
/// the machine does not run, and the next pull would rewrite the file back without explaining why. So the write
/// re-reads and compares, and throws when the vendor did not take it.</para>
/// </summary>
internal sealed partial class TcObjectModel
{
    /// <summary>Where TwinCAT keeps the real tasks: Realtime Settings, in the system-manager tree.</summary>
    private const string SystemTasks = "TIRT";

    /// <summary>The subtype a PLC-driven system task is created with. Measured off the live `TIRT^PlcTask`,
    /// which reports <c>ItemType=1 ItemSubType=1</c>.</summary>
    private const int SystemTaskSubType = 1;

    /// <summary>Create a task — the SYSTEM one first, then the PLC reference to it.
    ///
    /// <para>The order is not a preference, it is the vendor's: creating the PLC item alone fails with
    /// <c>"No task 'X' found in Realtime-Settings!"</c>, because a PLC task IS a reference and there is nothing
    /// for it to point at yet. Found by running the e2e create against a live XAE, which is the only place this
    /// could have been found — every offline test would have passed.</para>
    ///
    /// <para>If the PLC half then fails, the system task this method made is removed again. A create that
    /// half-lands is worse than one that fails: the orphan is invisible from the workspace (nothing walks
    /// Realtime Settings), so it would accumulate silently across retries.</para></summary>
    private object CreatePlcTask(object parent, string name)
    {
        var mine = LookupPath($"{SystemTasks}^{name}") is null;
        if (mine)
            ((dynamic)LookupTreeItem(SystemTasks)).CreateChild(name, SystemTaskSubType, "", System.Type.Missing);
        try
        {
            return (object)((dynamic)parent).CreateChild(name, ItemKind.PlcTask, "", System.Type.Missing);
        }
        catch
        {
            if (mine) try { DeleteSystemTask($"{SystemTasks}^{name}"); } catch { /* the original failure wins */ }
            throw;
        }
    }

    /// <summary>The system task a named child points at, or null when that child is not a task. Read BEFORE the
    /// child is deleted, because afterwards there is nothing left to ask.</summary>
    private string? LinkedTaskOfChild(object parent, string name)
    {
        var n = ChildCount(parent);
        for (var i = 1; i <= n; i++)
        {
            object child;
            // A POU Volt must not open (DIALECT C2i) is no task — and deleting it, by name, is exactly how it is
            // repaired, so it must not stop this scan.
            try { child = ChildAt(parent, i); }
            catch (Volt.Engine.Ide.UnreadableItemException) { continue; }
            if (ItemType(child) != ItemKind.PlcTask) continue;
            if (!string.Equals(GetName(child), name, StringComparison.OrdinalIgnoreCase)) continue;
            return TcTaskSchedule.LinkedTaskPath(ProduceXml(child));
        }
        return null;
    }

    /// <summary>Drop `TIRT^Name`. Absence is fine — the PLC reference is already gone, and a task that was
    /// never linked has nothing to clean up.</summary>
    private void DeleteSystemTask(string path)
    {
        var cut = path.LastIndexOf('^');
        if (cut < 0) return;
        if (LookupPath(path) is null) return;
        ((dynamic)LookupTreeItem(path.Substring(0, cut))).DeleteChild(path.Substring(cut + 1));
    }

    /// <summary>A PLC task's settings, assembled from the linked system task plus this item's call children.</summary>
    public TaskSettings ReadTask(object node) =>
        TcTaskSchedule.Read(ProduceXml(LinkedSystemTask(node)), CallNames(node));

    /// <summary>Apply a task's settings: the schedule onto the system task, the call list onto this item.
    /// Throws rather than half-apply — a task running the right POUs on the wrong cycle is not a partial
    /// success.</summary>
    public void WriteTask(object node, TaskSettings t)
    {
        var patch = TcTaskSchedule.SysTaskPatch(t);   // refuses what TwinCAT cannot express, before touching COM
        var path = LinkedTaskPath(node);

        ((dynamic)LookupTreeItem(path)).ConsumeXml(patch);

        // Re-LOOKUP rather than reuse the handle: a tree item is invalidated by a mutation ("Item 'x' is deleted
        // or invalidated by an ealier operation!"), which is the same trap `ReadManifest` records for the walk.
        var got = ProduceXml(LookupTreeItem(path));
        if (!TcTaskSchedule.Matches(got, t))
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"TwinCAT accepted the schedule for '{GetName(node)}' and did not apply it. Asked the system " +
                $"task '{path}' for {TcTaskSchedule.Describe(t)}; it reports {TcTaskSchedule.Describe(got)}. " +
                "Set it in the IDE — pushing the same body again will not help.");

        WriteCallList(node, t.Calls);
    }

    /// <summary>The POUs this task calls, in call order. They are the task item's own children, one per POU.</summary>
    private List<string> CallNames(object node)
    {
        var names = new List<string>();
        var n = ChildCount(node);
        for (var i = 1; i <= n; i++)
        {
            var child = ChildAt(node, i);
            if (ItemType(child) == ItemKind.PlcProgRef) names.Add(GetName(child));
        }
        return names;
    }

    /// <summary>Make the task's children exactly the POUs named, in order.
    ///
    /// <para>Rebuilt rather than diffed, which is what the CODESYS twin does and for the same reason: the
    /// `Calls:` line means "these POUs, in this order", and order is a property of the whole list. The no-change
    /// case returns early — re-creating identical children would churn the project file on every push of an
    /// unrelated field.</para></summary>
    private void WriteCallList(object node, IReadOnlyList<string> calls)
    {
        var current = CallNames(node);
        if (current.SequenceEqual(calls, StringComparer.Ordinal)) return;

        foreach (var name in current) DeleteChild(node, name);
        foreach (var name in calls) CreateChild(node, name, ItemKind.PlcProgRef);

        var after = CallNames(node);
        if (!after.SequenceEqual(calls, StringComparer.Ordinal))
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"TwinCAT did not take the call list for '{GetName(node)}': asked for " +
                $"[{string.Join(", ", calls)}], the task now calls [{string.Join(", ", after)}]. " +
                "A POU can only be called by a task that can see it — check the name.");
    }

    /// <summary>The system task a PLC task points at. NOT optional: a PLC task with no <c>LinkedTask</c> has no
    /// schedule anywhere, and answering with a default would invent one.</summary>
    private string LinkedTaskPath(object node) =>
        TcTaskSchedule.LinkedTaskPath(ProduceXml(node))
        ?? throw new BridgeException(BridgeErrorCodes.Unsupported,
            $"TwinCAT: task '{GetName(node)}' names no linked system task, so it has no schedule to read or " +
            "write. This is a task the IDE itself would show as unconfigured.");

    private object LinkedSystemTask(object node) => LookupTreeItem(LinkedTaskPath(node));
}
