using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Format.St;
using Volt.Contracts;

namespace Volt.Engine.Format.Task;

/// <summary>A task's watchdog: its three vendor members and whether it is ENABLED (openspec <c>bridge-one-to-one</c>
/// §1.2 "One watchdog spelling"). A disabled watchdog keeps its values behind the flag — measured across a reload, the
/// non-default unit too (<c>watchdog-off-values</c>: <c>123 µs</c> / <c>3</c> stayed) — so they are content, spelled
/// <c>off &lt;time&gt; &lt;unit&gt; (sensitivity &lt;n&gt;)</c> — hidden, a push would write them as whatever the file
/// did not say. Null on <see cref="TaskSettings.Watchdog"/> is the bare <c>off</c> of a task that HAS
/// no watchdog member — TwinCAT's (DIALECT C36).</summary>
public sealed record TaskWatchdog(string Time, string Unit, string Sensitivity, bool Enabled)
{
    /// <summary>An ENABLED watchdog.</summary>
    public TaskWatchdog(string time, string unit, string sensitivity) : this(time, unit, sensitivity, true) { }
}

/// <summary>A task member off the value measured on every corpus task, as its own label (openspec
/// <c>bridge-one-to-one</c> §1.2: <c>Core: 1</c>) — the label and the vendor value as the vendor renders it. A member at
/// its measured value has no label: that absence IS the measured value.</summary>
public sealed record TaskMember(string Label, string Value);

/// <summary>Everything a `.task` file says, as data rather than text.
///
/// <para><see cref="Interval"/> and <see cref="IntervalUnit"/> are kept SPLIT because the vendor keeps them
/// split, and because <see cref="Descriptor.Unitize"/> only joins them when the value is a bare number: a
/// project whose interval is the literal <c>t#4ms</c> has no unit to render, and re-splitting the joined string
/// would invent one.</para>
///
/// <para><b>The members after <see cref="Calls"/></b> (openspec <c>bridge-one-to-one</c> §1.2) carry what the six
/// original labels folded or hid: <see cref="ExternalEvent"/> (its own label: folded into <c>Event:</c>, a push moves it),
/// <see cref="CallComments"/> (one per call, <c>""</c> for none — index-aligned with <see cref="Calls"/>), and
/// <see cref="Members"/>, every other vendor member off its measured value. Each defaults to its measured absence (no
/// external event, no comment, every member at its measured value) — the same rule as an absent label.</para></summary>
public sealed record TaskSettings(
    string Type,
    string Interval,
    string IntervalUnit,
    string Priority,
    string? Event,
    TaskWatchdog? Watchdog,
    IReadOnlyList<string> Calls,
    string? ExternalEvent = null,
    IReadOnlyList<string>? CallComments = null,
    IReadOnlyList<TaskMember>? Members = null)
{
    /// <summary>The comment of the call at <paramref name="index"/> — <c>""</c> when it has none. The two lists are one
    /// list in two halves, so a <see cref="CallComments"/> that does not match <see cref="Calls"/> one for one (a
    /// <c>with { Calls = … }</c> that forgot the comments) is refused, never read against the wrong call.</summary>
    public string CommentOf(int index)
    {
        if (CallComments is null || CallComments.Count == 0) return "";
        if (CallComments.Count != Calls.Count)
            throw new VoltInvariantException(
                $"a task's {Calls.Count} call(s) carry {CallComments.Count} comment(s) — the two lists are index-aligned");
        return CallComments[index];
    }

    /// <summary>The members off their measured value, none when there are none.</summary>
    public IReadOnlyList<TaskMember> OffDefault => Members ?? Array.Empty<TaskMember>();

    /// <summary>The value of the member labelled <paramref name="label"/>, or null when it is at its measured value.</summary>
    public string? MemberValue(string label) => OffDefault.FirstOrDefault(m => m.Label == label)?.Value;
}

/// <summary>
/// The `.task` file FORMAT, in one place for both directions.
///
/// <para>`.task` is WRITABLE, so the two directions are a pair, and a pair in one file cannot drift: the round trip is
/// a property of this type, testable offline.</para>
///
/// <para><b>The layout is INHERITED, then extended.</b> These bytes are hashed into the item's version, so the
/// original six labels keep their padding and order — <c>Descriptor(11)</c> — and the labels openspec
/// <c>bridge-one-to-one</c> added (<c>External event:</c>, a call's <c>// comment</c>, the off-default members) appear
/// only on a task that holds such a value. The watchdog's spelling is the one deliberate change to an existing line: its
/// unit is a vendor member and is always spelled, and a disabled watchdog shows its values.</para>
/// </summary>
public static class TaskDescriptorFormat
{
    /// <summary>The column the descriptor's values start at. 11 is inherited, not chosen (see <see cref="Descriptor"/>).</summary>
    private const int Pad = 11;

    private const string LabelType = "Type";
    private const string LabelInterval = "Interval";
    private const string LabelPriority = "Priority";
    private const string LabelEvent = "Event";
    private const string LabelExternalEvent = "External event";
    private const string LabelWatchdog = "Watchdog";
    private const string LabelCalls = "Calls";

    /// <summary>The word that states a disabled watchdog.</summary>
    private const string Off = "off";

    /// <summary>An EMPTY vendor member, spelled so the line still has its token (§1.2: <c>''</c>).</summary>
    private const string Empty = "''";

    /// <summary>The separator between a call and its comment.</summary>
    private const string CommentMark = " // ";

    // ── the off-default member labels (openspec bridge-one-to-one §1.1 "Tasks"), canonical order ───────────────────
    public const string LabelCore = "Core";
    public const string LabelCore2 = "Core2";
    public const string LabelTaskGroup = "Task group";
    public const string LabelAllowEmpty = "Allow empty";
    public const string LabelImplicit = "Implicit";
    public const string LabelWithinSpsTimeSlicing = "Within SPS time slicing";
    public const string LabelSynchTask = "Synch task";
    public const string LabelAutoStart = "Auto start";
    public const string LabelIoAtBegin = "IO at begin";
    public const string LabelExceedWarning = "Exceed warning";
    public const string LabelCreateSymbols = "Create symbols";
    public const string LabelExtSync = "Ext sync";
    public const string LabelTickModulo = "Tick modulo";
    public const string LabelInputUpdatePreTicks = "Input update pre ticks";
    public const string LabelDisableFpExceptions = "Disable FP exceptions";
    public const string LabelWatchdogStackCapacity = "Watchdog stack capacity";
    public const string LabelCpuAffinity = "CPU affinity";

    /// <summary>Every member label, CODESYS's then TwinCAT's, in the order the file states them. Which a vendor takes is
    /// the driver's to say (<c>IVendorStore.ValidateTask</c>).</summary>
    public static readonly IReadOnlyList<string> MemberLabels = new[]
    {
        LabelCore, LabelCore2, LabelTaskGroup, LabelAllowEmpty, LabelImplicit, LabelWithinSpsTimeSlicing, LabelSynchTask,
        LabelAutoStart, LabelIoAtBegin, LabelExceedWarning, LabelCreateSymbols, LabelExtSync, LabelTickModulo,
        LabelInputUpdatePreTicks, LabelDisableFpExceptions, LabelWatchdogStackCapacity, LabelCpuAffinity,
    };

    /// <summary>Render settings to the file body. The six inherited labels byte-identical to the renderer this type
    /// replaced; the added ones only where they hold a value.</summary>
    public static string Write(TaskSettings t)
    {
        var d = new Descriptor(Pad, spaceAfterLongLabel: true)
            .Add(LabelType, t.Type)
            .Add(LabelInterval, Descriptor.Unitize(t.Interval, t.IntervalUnit))
            .Add(LabelPriority, t.Priority)
            .Add(LabelEvent, t.Event)
            .Add(LabelExternalEvent, t.ExternalEvent)
            .Add(LabelWatchdog, WatchdogText(t.Watchdog));
        // Calls is omitted entirely when the task drives nothing — an empty `Calls:` line would read as a task
        // that calls something unnamed.
        if (t.Calls.Count > 0)
            d.Add(LabelCalls, string.Join(", ", t.Calls.Select((c, i) =>
                t.CommentOf(i) is { Length: > 0 } comment ? c + CommentMark + comment : c)));
        foreach (var label in MemberLabels)
            if (t.MemberValue(label) is { } value) d.Add(label, value.Length == 0 ? Empty : value);
        return d.ToString();
    }

    /// <summary><c>[off ]&lt;time&gt; &lt;unit&gt; (sensitivity &lt;n&gt;)</c>, each member exactly as the vendor holds it and
    /// <c>''</c> for an empty one — the unit NEVER implied by a default and never dropped after a TIME literal (a
    /// <c>3200 µs</c> pushed back as <c>3200</c> in <c>ms</c> is a 1000× change). A task with no watchdog member is the
    /// bare <c>off</c>.</summary>
    private static string WatchdogText(TaskWatchdog? w) =>
        w is null ? Off
            : $"{(w.Enabled ? "" : Off + " ")}{Token(w.Time)} {Token(w.Unit)} (sensitivity {Token(w.Sensitivity)})";

    private static string Token(string value) => value.Trim().Length == 0 ? Empty : value.Trim();

    /// <summary>Read a `.task` body back into settings. Throws <see cref="TaskDescriptorException"/> with the
    /// offending line on anything it cannot account for — a field it does not know is a push that would
    /// SILENTLY DROP something the engineer wrote, which is the one outcome worth failing for.
    /// <para>It is also the push's gate: a descriptor that reads but is not in the canonical form (fields in another
    /// order, another spacing) is WRITTEN — the settings are what the IDE holds, and the canonical text comes back on
    /// the next pull (openspec <c>bridge-refusal-review</c> 2.13).</para></summary>
    public static TaskSettings Read(string text)
    {
        string? type = null, interval = null, priority = null, evt = null, externalEvent = null, watchdog = null, calls = null;
        var members = new List<TaskMember>();
        var lineNo = 0;
        var seen = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var raw in (text ?? "").Replace("\r", "").Split('\n'))
        {
            lineNo++;
            if (raw.Trim().Length == 0) continue;
            var colon = raw.IndexOf(':');
            if (colon < 0) throw new TaskDescriptorException($"line {lineNo}: expected `Label: value`, found '{raw.Trim()}'");
            var label = raw.Substring(0, colon).Trim();
            var value = raw.Substring(colon + 1).Trim();
            // One value per field: a second line of a label Volt knows would silently replace the first (a second
            // `Calls:` stops the task calling a program), so it is refused by name and line, not last-wins.
            if (seen.TryGetValue(label, out var first))
                throw new TaskDescriptorException(
                    $"line {lineNo}: '{label}' is written twice (first on line {first}) — a task field holds one value");
            switch (label)
            {
                case LabelType: type = value; break;
                case LabelInterval: interval = value; break;
                case LabelPriority: priority = value; break;
                case LabelEvent: evt = value; break;
                case LabelExternalEvent: externalEvent = value; break;
                case LabelWatchdog: watchdog = value; break;
                case LabelCalls: calls = value; break;
                default:
                    if (!MemberLabels.Contains(label, StringComparer.Ordinal))
                        throw new TaskDescriptorException(
                            $"line {lineNo}: '{label}' is not a task field. Expected one of " +
                            $"{LabelType}, {LabelInterval}, {LabelPriority}, {LabelEvent}, {LabelExternalEvent}, " +
                            $"{LabelWatchdog}, {LabelCalls}, {string.Join(", ", MemberLabels)}.");
                    members.Add(new TaskMember(label, value == Empty ? "" : value));
                    break;
            }
            seen[label] = lineNo;
        }
        if (type is null) throw new TaskDescriptorException($"no '{LabelType}:' line — a task must say what kind it is");
        if (priority is null) throw new TaskDescriptorException($"no '{LabelPriority}:' line");

        var (iv, unit) = SplitUnit(interval ?? "");
        var (names, comments) = ReadCalls(calls);
        // No comment at all is the measured absence (19 of 19 corpus calls): stated as none, not as a list of empties.
        var stated = comments.Any(c => c.Length > 0) ? comments : null;
        // The members in canonical order, whatever order the file stated them in: one record, one rendering.
        members.Sort((a, b) => IndexOf(a.Label).CompareTo(IndexOf(b.Label)));
        return new TaskSettings(type, iv, unit, priority, string.IsNullOrEmpty(evt) ? null : evt,
                                ReadWatchdog(watchdog), names,
                                string.IsNullOrEmpty(externalEvent) ? null : externalEvent, stated, members);

        static int IndexOf(string label) => MemberLabels.ToList().IndexOf(label);
    }

    /// <summary>Whether two descriptors state the SAME settings: equal canonical renderings (<see cref="Write"/> of
    /// <see cref="Read"/>). A push in another form comes back from the IDE in the canonical bytes, and that is the same
    /// descriptor, not an IDE-side change. Both texts read: one was accepted by the push's <see cref="Read"/>, the other is the
    /// IDE's own.</summary>
    public static bool SameDescriptor(string a, string b) =>
        Normalize(a) == Normalize(b) || Normalize(Write(Read(a))) == Normalize(Write(Read(b)));

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
        if (v.Length == 0 || v.Equals(Off, StringComparison.Ordinal)) return null;
        var open = v.LastIndexOf('(');
        if (open < 0 || !v.EndsWith(")", StringComparison.Ordinal))
            throw new TaskDescriptorException(
                $"watchdog '{v}': expected `[off ]<time> <unit> (sensitivity <n>)` or `off`");
        var inner = v.Substring(open + 1, v.Length - open - 2).Trim();
        const string prefix = "sensitivity";
        if (!inner.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            throw new TaskDescriptorException($"watchdog '{v}': expected `(sensitivity <n>)`, found '({inner})'");
        var words = v.Substring(0, open).Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries).ToList();
        var enabled = !(words.Count > 0 && words[0] == Off);
        if (!enabled) words.RemoveAt(0);
        // Two tokens, time and unit, each its vendor member — `''` for an empty one. A watchdog with one token (the
        // spelling before the unit was always stated, or a unit dropped by hand) is refused: which unit the time is in
        // is three orders of magnitude, and nothing may imply it.
        if (words.Count != 2)
            throw new TaskDescriptorException(
                $"watchdog '{v}': expected its time and its unit as two words — `<time> <unit>`, `''` for an empty one " +
                "(`Watchdog: 3200 µs (sensitivity 1)`, `Watchdog: off '' ms (sensitivity 1)`)");
        return new TaskWatchdog(Member(words[0]), Member(words[1]), Member(inner.Substring(prefix.Length).Trim()), enabled);

        static string Member(string token) => token == Empty ? "" : token;
    }

    /// <summary>The calls in order, and each one's comment (<c>A // comment</c>; <c>""</c> for none).</summary>
    private static (IReadOnlyList<string> Names, IReadOnlyList<string> Comments) ReadCalls(string? s)
    {
        var names = new List<string>();
        var comments = new List<string>();
        foreach (var part in (s ?? "").Split(','))
        {
            var p = part.Trim();
            if (p.Length == 0) continue;
            var mark = p.IndexOf("//", StringComparison.Ordinal);
            names.Add(mark < 0 ? p : p.Substring(0, mark).Trim());
            comments.Add(mark < 0 ? "" : p.Substring(mark + 2).Trim());
        }
        return (names, comments);
    }
}

/// <summary>A `.task` body that does not read: the reason, naming the line or the field. Coded BAD_REQUEST — a malformed
/// descriptor is the request's grammar, not Volt's broken invariant (openspec bridge-refusal-review D14). Uncoded, it
/// fell through <c>PushService.ConflictFor</c>'s coded-error check and reached the wire as INTERNAL_ERROR.</summary>
public sealed class TaskDescriptorException : BridgeException
{
    public TaskDescriptorException(string message) : base(Volt.Contracts.BridgeErrorCodes.BadRequest, message) { }
}
