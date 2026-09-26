using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Format.St;

namespace Volt.Engine.Format.Task;

/// <summary>A task's watchdog. Absent (<c>null</c> on <see cref="TaskSettings.Watchdog"/>) means "off", which is
/// how the file spells it — the vendor keeps an `enabled` flag beside the values, and a disabled watchdog still
/// carries stale numbers we deliberately do not render.</summary>
public sealed record TaskWatchdog(string Time, string Unit, string Sensitivity);

/// <summary>Everything a `.task` file says, as data rather than text.
///
/// <para><see cref="Interval"/> and <see cref="IntervalUnit"/> are kept SPLIT because the vendor keeps them
/// split, and because <see cref="Descriptor.Unitize"/> only joins them when the value is a bare number: a
/// project whose interval is the literal <c>t#4ms</c> has no unit to render, and re-splitting the joined string
/// would invent one.</para></summary>
public sealed record TaskSettings(
    string Type,
    string Interval,
    string IntervalUnit,
    string Priority,
    string? Event,
    TaskWatchdog? Watchdog,
    IReadOnlyList<string> Calls);

/// <summary>
/// The `.task` file FORMAT, in one place for both directions.
///
/// <para>It used to exist only as a renderer inside the CODESYS driver, which was fine while `.task` was
/// read-only: nothing ever had to read one back. Making it WRITABLE makes the two directions a pair, and a pair
/// that lives in one file cannot drift — the round-trip is then a property of this type, testable offline,
/// instead of something only a live IDE could disprove.</para>
///
/// <para><b>The layout is not chosen here, it is INHERITED.</b> These bytes are hashed into the item's version,
/// so every user's repo would show a diff if the padding or the field order moved. <see cref="Write"/> therefore
/// reproduces the old renderer exactly — <c>Descriptor(11)</c>, the same six labels in the same order — and the
/// tests pin real corpus files against it.</para>
/// </summary>
public static class TaskDescriptorFormat
{
    /// <summary>The column the descriptor's values start at. 11 is inherited, not chosen (see <see cref="Descriptor"/>).</summary>
    private const int Pad = 11;

    private const string LabelType = "Type";
    private const string LabelInterval = "Interval";
    private const string LabelPriority = "Priority";
    private const string LabelEvent = "Event";
    private const string LabelWatchdog = "Watchdog";
    private const string LabelCalls = "Calls";

    /// <summary>Render settings to the file body. Byte-identical to what the CODESYS driver emitted before this
    /// type existed, which is what lets it replace that renderer without re-flowing anybody's workspace.</summary>
    public static string Write(TaskSettings t)
    {
        var d = new Descriptor(Pad)
            .Add(LabelType, t.Type)
            .Add(LabelInterval, Descriptor.Unitize(t.Interval, t.IntervalUnit))
            .Add(LabelPriority, t.Priority)
            .Add(LabelEvent, t.Event)
            .Add(LabelWatchdog, t.Watchdog is { } w
                ? $"{Descriptor.Unitize(w.Time, w.Unit)} (sensitivity {w.Sensitivity.Trim()})"
                : "off");
        // Calls is omitted entirely when the task drives nothing — an empty `Calls:` line would read as a task
        // that calls something unnamed.
        if (t.Calls.Count > 0) d.Add(LabelCalls, string.Join(", ", t.Calls));
        return d.ToString();
    }

    /// <summary>Read a `.task` body back into settings. Throws <see cref="TaskDescriptorException"/> with the
    /// offending line on anything it cannot account for — a field it does not know is a push that would
    /// SILENTLY DROP something the engineer wrote, which is the one outcome worth failing for.</summary>
    public static TaskSettings Read(string text)
    {
        string? type = null, interval = null, priority = null, evt = null, watchdog = null, calls = null;
        var lineNo = 0;
        foreach (var raw in (text ?? "").Replace("\r", "").Split('\n'))
        {
            lineNo++;
            if (raw.Trim().Length == 0) continue;
            var colon = raw.IndexOf(':');
            if (colon < 0) throw new TaskDescriptorException($"line {lineNo}: expected `Label: value`, found '{raw.Trim()}'");
            var label = raw.Substring(0, colon).Trim();
            var value = raw.Substring(colon + 1).Trim();
            switch (label)
            {
                case LabelType: type = value; break;
                case LabelInterval: interval = value; break;
                case LabelPriority: priority = value; break;
                case LabelEvent: evt = value; break;
                case LabelWatchdog: watchdog = value; break;
                case LabelCalls: calls = value; break;
                default:
                    throw new TaskDescriptorException(
                        $"line {lineNo}: '{label}' is not a task field. Expected one of " +
                        $"{LabelType}, {LabelInterval}, {LabelPriority}, {LabelEvent}, {LabelWatchdog}, {LabelCalls}.");
            }
        }
        if (type is null) throw new TaskDescriptorException($"no '{LabelType}:' line — a task must say what kind it is");
        if (priority is null) throw new TaskDescriptorException($"no '{LabelPriority}:' line");

        var (iv, unit) = SplitUnit(interval ?? "");
        return new TaskSettings(type, iv, unit, priority, string.IsNullOrEmpty(evt) ? null : evt,
                                ReadWatchdog(watchdog), ReadCalls(calls));
    }

    /// <summary>Read, then prove the text is CANONICAL by re-rendering it. A body that parses but re-renders
    /// differently would be rewritten by the very next pull, so the push is refused with the exact text to use —
    /// the same bargain `NetworkTextGate` strikes for graphical bodies, and for the same reason: drift the
    /// engineer did not ask for is worse than a refusal they can act on.</summary>
    public static TaskSettings Gate(string text)
    {
        var settings = Read(text);
        var canonical = Write(settings);
        if (!string.Equals(Normalize(canonical), Normalize(text), StringComparison.Ordinal))
            throw new TaskDescriptorException(
                "the task descriptor is not in canonical form — it would not round-trip identically (you'd see " +
                $"drift on the next pull). Use this exact body:\n\n{canonical}");
        return settings;
    }

    /// <summary>Whether two descriptors differ only in what <see cref="Gate"/> lets vary — trailing whitespace and
    /// the final newline. This is the task's LAYOUT: a push the gate accepted as canonical may come back from the
    /// IDE in the canonical bytes, and that is the same descriptor, not an IDE-side change.</summary>
    public static bool SameDescriptor(string a, string b) => Normalize(a) == Normalize(b);

    /// <summary>Trailing-whitespace-and-newline insensitive: a workspace file may lose or gain a final newline
    /// on the way through an editor, and that is not a reason to refuse a push.</summary>
    private static string Normalize(string s) =>
        string.Join("\n", (s ?? "").Replace("\r", "").Split('\n').Select(l => l.TrimEnd())).TrimEnd('\n');

    /// <summary>`3200 µs` → (3200, µs); `t#4ms` → (t#4ms, ""). The inverse of <see cref="Descriptor.Unitize"/>,
    /// which only appends a unit to a BARE NUMBER — so a value carrying letters keeps them and has no unit.</summary>
    private static (string Value, string Unit) SplitUnit(string s)
    {
        var v = (s ?? "").Trim();
        if (v.Length == 0) return ("", "");
        var sp = v.IndexOf(' ');
        if (sp < 0) return (v, "");
        var head = v.Substring(0, sp);
        var tail = v.Substring(sp + 1).Trim();
        return head.All(c => char.IsDigit(c) || c == '.' || c == '-' || c == '+') ? (head, tail) : (v, "");
    }

    private static TaskWatchdog? ReadWatchdog(string? s)
    {
        var v = (s ?? "").Trim();
        if (v.Length == 0 || v.Equals("off", StringComparison.OrdinalIgnoreCase)) return null;
        var open = v.LastIndexOf('(');
        if (open < 0 || !v.EndsWith(")", StringComparison.Ordinal))
            throw new TaskDescriptorException(
                $"watchdog '{v}': expected `<time> (sensitivity <n>)` or `off`");
        var inner = v.Substring(open + 1, v.Length - open - 2).Trim();
        const string prefix = "sensitivity";
        if (!inner.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            throw new TaskDescriptorException($"watchdog '{v}': expected `(sensitivity <n>)`, found '({inner})'");
        var (time, unit) = SplitUnit(v.Substring(0, open).Trim());
        return new TaskWatchdog(time, unit, inner.Substring(prefix.Length).Trim());
    }

    private static IReadOnlyList<string> ReadCalls(string? s) =>
        (s ?? "").Split(',').Select(p => p.Trim()).Where(p => p.Length > 0).ToList();
}

/// <summary>A `.task` body Volt will not write. Carries the reason, and for a non-canonical body the exact text
/// to use instead.</summary>
public sealed class TaskDescriptorException : Exception
{
    public TaskDescriptorException(string message) : base(message) { }
}
