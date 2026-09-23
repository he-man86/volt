using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Xml.Linq;
using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Format.Task;

namespace Volt.Ide.Twincat;

/// <summary>
/// The TwinCAT half of a `.task` file: XML in the vendor's shape ⇄ the shared <see cref="TaskSettings"/>.
///
/// <para><b>A TwinCAT PLC task is a REFERENCE, and that is the whole reason this type exists.</b> The item under
/// the PLC project (TREEITEMTYPE_PLCTASK, 621) carries one field —
/// <c>&lt;PlcTaskDef&gt;&lt;LinkedTask&gt;TIRT^PlcTask&lt;/LinkedTask&gt;</c> — and nothing about the schedule.
/// The schedule lives on the SYSTEM task that path names, as
/// <c>&lt;TaskDef&gt;&lt;Priority/&gt;&lt;CycleTime/&gt;&lt;/TaskDef&gt;</c>, while the ordered POU calls are the
/// PLC item's OWN children (TREEITEMTYPE_PLCPROGREF, 650, named by POU). So one `.task` file is assembled from
/// two tree items, and written back to two. Measured live, TcXaeShell 15.0 —
/// <c>scripts/probe-tc-task.ps1</c>. See DIALECT C19b.</para>
///
/// <para><b>The PLC project's `.TcTTO` is NOT the copy to read.</b> It carries the same three numbers
/// (<c>CycleTime</c> in µs, <c>Priority</c>, <c>PouCall</c>) and is the obvious target, which is exactly the trap:
/// it is the PLC-side copy, the system task is what the runtime is configured from, and the two are in different
/// units. A reader written against it was built and thrown away before it shipped.</para>
///
/// <para><b>Three of the shared format's six fields have no TwinCAT counterpart</b>, and they are REFUSED on a
/// push rather than dropped. A pushed `Type: Freewheeling`, an `Event:` line, or a watchdog would otherwise be
/// silently ignored — the engineer's file would say one thing and the IDE do another, and the next pull would
/// quietly rewrite their edit. TwinCAT's own cycle-exceed warning (<c>ExceedWarning</c>) is deliberately NOT
/// mapped onto `Watchdog:`: it is a count of tolerated overruns, not CODESYS's time-plus-sensitivity watchdog,
/// and equating them would put a number in the file that means something else.</para>
/// </summary>
internal static class TcTaskSchedule
{
    /// <summary>TwinCAT counts a system task's cycle in 100ns ticks: 100000 ticks = 10ms.</summary>
    private const long TicksPerUs = 10;
    private const long UsPerMs = 1000;

    /// <summary>The only task type TwinCAT's PLC task has. It is cycle-driven by construction — the system task
    /// carries a CycleTime and nothing else selects a mode.</summary>
    private const string CyclicType = "Cyclic";

    /// <summary>The system-task path a PLC task item points at (<c>TIRT^PlcTask</c>), or null if the XML is not a
    /// PLC task's metadata.</summary>
    public static string? LinkedTaskPath(string plcTaskXml) =>
        XDocument.Parse(plcTaskXml).Descendants("LinkedTask").FirstOrDefault()?.Value.Trim() is { Length: > 0 } p
            ? p : null;

    /// <summary>Assemble the shared settings from the SYSTEM task's XML plus the PLC task's call children.</summary>
    public static TaskSettings Read(string sysTaskXml, IReadOnlyList<string> calls)
    {
        var def = XDocument.Parse(sysTaskXml).Descendants("TaskDef").FirstOrDefault()
            ?? throw new InvalidOperationException(
                "twincat: the linked system task's XML carries no <TaskDef> — its schedule is unreadable, and " +
                "rendering a task without one would hash as a task with no priority at all");

        var priority = def.Element("Priority")?.Value.Trim() ?? "";
        var (interval, unit) = FromTicks(def.Element("CycleTime")?.Value.Trim() ?? "");
        return new TaskSettings(CyclicType, interval, unit, priority, Event: null, Watchdog: null, Calls: calls);
    }

    /// <summary>The `<c>&lt;TaskDef&gt;</c>` patch that applies <paramref name="t"/> to the system task, or throws
    /// <see cref="BridgeException"/> naming the field TwinCAT cannot express.
    ///
    /// <para>UNSUPPORTED for a setting this VENDOR cannot hold, BAD_REQUEST for a value nobody could read. Every
    /// refusal here used to be BAD_REQUEST, which told an engineer who had pulled a freewheeling CODESYS task
    /// that their file was malformed — it is not, and no edit to it can make TwinCAT schedule that task.</para></summary>
    public static string SysTaskPatch(TaskSettings t)
    {
        if (!string.Equals(t.Type, CyclicType, StringComparison.OrdinalIgnoreCase))
            throw Refuse(BridgeErrorCodes.Unsupported, $"`Type: {t.Type}` — a TwinCAT PLC task is always {CyclicType}.");
        if (!string.IsNullOrEmpty(t.Event))
            throw Refuse(BridgeErrorCodes.Unsupported, $"`Event: {t.Event}` — a TwinCAT PLC task has no event source.");
        if (t.Watchdog is not null)
            throw Refuse(BridgeErrorCodes.Unsupported,
                         "a watchdog — TwinCAT has no per-task watchdog with a time and a sensitivity. " +
                         "Write `Watchdog: off`.");
        if (!long.TryParse(t.Priority, NumberStyles.Integer, CultureInfo.InvariantCulture, out var priority))
            throw Refuse(BridgeErrorCodes.BadRequest, $"`Priority: {t.Priority}` is not a whole number.");

        return $"<TreeItem><TaskDef><Priority>{priority}</Priority>" +
               $"<CycleTime>{ToTicks(t.Interval, t.IntervalUnit)}</CycleTime></TaskDef></TreeItem>";
    }

    /// <summary>Whether the system task now says what was asked — the read-back that turns a write TwinCAT
    /// declined to honour into a loud failure instead of a file that disagrees with the IDE.
    ///
    /// <para>It checks EVERY copy the system task publishes, not just the one written. A system task carries its
    /// schedule twice: <c>&lt;TaskDef&gt;</c> in 100ns ticks, and again under
    /// <c>&lt;TcModuleInstance&gt;&lt;Context&gt;</c> in nanoseconds. Verifying only the field we set would pass
    /// on exactly the failure this whole gap was held open for — one copy moved, the other left behind, and no
    /// way to tell from the file which one the runtime obeys.</para></summary>
    public static bool Matches(string sysTaskXml, TaskSettings want)
    {
        var wantTicks = ToTicks(want.Interval, want.IntervalUnit);
        var wantPriority = want.Priority.Trim();
        var root = XDocument.Parse(sysTaskXml);

        var def = root.Descendants("TaskDef").FirstOrDefault()
            ?? throw new InvalidOperationException("twincat: the system task lost its <TaskDef> across the write");
        if (def.Element("Priority")?.Value.Trim() != wantPriority) return false;
        if (def.Element("CycleTime")?.Value.Trim() != wantTicks.ToString(CultureInfo.InvariantCulture)) return false;

        // The module context's cycle is the SAME time in nanoseconds — 100 ns per tick.
        foreach (var ctx in root.Descendants("Context"))
        {
            if (ctx.Element("Priority") is { } p && p.Value.Trim() != wantPriority) return false;
            if (ctx.Element("CycleTime") is { } c &&
                c.Value.Trim() != (wantTicks * 100).ToString(CultureInfo.InvariantCulture)) return false;
        }
        return true;
    }

    /// <summary>What a set of settings asks for, in the vendor's own numbers — for the read-back failure, which
    /// is useless without them. "Did not apply it" tells nobody which field moved or where it landed.</summary>
    public static string Describe(TaskSettings t) =>
        $"priority {t.Priority}, cycle {ToTicks(t.Interval, t.IntervalUnit)} ticks";

    /// <summary>The same, read off whatever the system task currently publishes — every copy of it, since a
    /// half-moved schedule is the thing worth seeing.</summary>
    public static string Describe(string sysTaskXml)
    {
        var root = XDocument.Parse(sysTaskXml);
        var def = root.Descendants("TaskDef").FirstOrDefault();
        var parts = new List<string>
        {
            $"priority {def?.Element("Priority")?.Value.Trim() ?? "?"}, " +
            $"cycle {def?.Element("CycleTime")?.Value.Trim() ?? "?"} ticks",
        };
        foreach (var ctx in root.Descendants("Context"))
            parts.Add($"context '{ctx.Element("Name")?.Value.Trim()}' priority " +
                      $"{ctx.Element("Priority")?.Value.Trim() ?? "-"}, cycle " +
                      $"{ctx.Element("CycleTime")?.Value.Trim() ?? "-"} ns");
        return string.Join("; ", parts);
    }

    // ── the cycle time, both ways ────────────────────────────────────────────────────────────────────────

    /// <summary>100ns ticks → the largest unit that stays EXACT, so a 10ms task reads `10 ms` rather than
    /// `10000 µs`. Exactness is not cosmetic: the value round-trips through <see cref="ToTicks"/> on every push,
    /// and a lossy rendering would make the file un-pushable or, worse, re-time the task.</summary>
    private static (string Value, string Unit) FromTicks(string ticksText)
    {
        if (!long.TryParse(ticksText, NumberStyles.Integer, CultureInfo.InvariantCulture, out var ticks))
            throw new InvalidOperationException(
                $"twincat: the system task's <CycleTime> is '{ticksText}', not a whole number of 100ns ticks");
        if (ticks % TicksPerUs != 0) return ((ticks * 100).ToString(CultureInfo.InvariantCulture), "ns");
        var us = ticks / TicksPerUs;
        return us % UsPerMs == 0
            ? ((us / UsPerMs).ToString(CultureInfo.InvariantCulture), "ms")
            : (us.ToString(CultureInfo.InvariantCulture), "µs");
    }

    /// <summary>The inverse. A bare number or a TIME literal is REFUSED rather than assumed into a unit — the
    /// difference between `4` meaning microseconds and milliseconds is three orders of magnitude on a live
    /// machine, and this vendor gives no default to fall back on.</summary>
    private static long ToTicks(string value, string unit)
    {
        if (!long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var v))
            // TWO REFUSALS, not one, because the engineer's next move differs. A TIME literal is CODESYS's own
            // spelling of a perfectly schedulable interval — the file is RIGHT and this vendor has no way to say
            // it, which is UNSUPPORTED. Anything else is a value nobody can read, which is BAD_REQUEST. They
            // shared a code and a sentence, so the one remedy printed ("write a whole number and a unit") was
            // advice the author of a pulled CODESYS task could not act on.
            throw IsTimeLiteral(value)
                ? Refuse(BridgeErrorCodes.Unsupported,
                         $"`Interval: {Volt.Engine.Format.St.Descriptor.Unitize(value, unit)}` — a TIME literal " +
                         "is CODESYS's spelling and has no TwinCAT equivalent; write it as a whole number and " +
                         "one of `ns`, `µs`/`us`, `ms`, `s`.")
                : Refuse(BridgeErrorCodes.BadRequest,
                         $"`Interval: {Volt.Engine.Format.St.Descriptor.Unitize(value, unit)}` — TwinCAT needs a " +
                         "whole number and a unit, one of `ns`, `µs`/`us`, `ms`, `s`.");
        return unit.Trim().ToLowerInvariant() switch
        {
            "ns" => Exact(v, 100, unit),
            "µs" or "us" => v * TicksPerUs,
            "ms" => v * TicksPerUs * UsPerMs,
            "s" => v * TicksPerUs * UsPerMs * 1000,
            _ => throw Refuse(BridgeErrorCodes.BadRequest,
                              $"interval unit '{unit}' — TwinCAT counts in 100ns ticks, so the unit must be " +
                              "`ns`, `µs`/`us`, `ms` or `s`."),
        };
    }

    /// <summary>`t#4ms` / `TIME#500us` — an interval written the way CODESYS writes it.</summary>
    private static bool IsTimeLiteral(string value)
    {
        var v = value.Trim();
        return v.StartsWith("t#", StringComparison.OrdinalIgnoreCase)
            || v.StartsWith("time#", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Nanoseconds below a whole tick cannot be scheduled, and rounding them would silently re-time
    /// the task.
    ///
    /// <para>UNSUPPORTED, not BAD_REQUEST: `150 ns` is a well-formed interval that CODESYS schedules happily,
    /// and the only reason it is refused is that TwinCAT's clock counts in 100ns ticks. Nothing about the
    /// request is wrong, so telling the engineer to fix it sends them to edit a file that is already correct.</para></summary>
    private static long Exact(long ns, long perTick, string unit) =>
        ns % perTick == 0 ? ns / perTick
            : throw Refuse(BridgeErrorCodes.Unsupported,
                           $"`{ns} {unit}` is not a whole number of 100ns ticks, which is TwinCAT's resolution.");

    private static BridgeException Refuse(string code, string what) =>
        new(code, $"TwinCAT cannot schedule {what}");
}
