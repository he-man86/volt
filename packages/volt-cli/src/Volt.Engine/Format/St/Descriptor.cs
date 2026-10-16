using System.Collections.Generic;
using System.Linq;
using System.Text;
using Volt.Engine.Library;

namespace Volt.Engine.Format.St;

/// <summary>
/// The read-only descriptor FORMAT: aligned <c>Label: value</c> lines, empty values omitted. It is the file body
/// of every non-source item Volt materializes — <c>.device</c>, <c>.task</c>, <c>.trace</c>, <c>.projectinfo</c>,
/// <c>.symbols</c>, <c>.recipe</c>.
/// <para><b>These bytes are hashed into the item's version</b>, so a change here is a diff in every user's repo. The
/// vendor half — which scripting facet, which property name — stays in the driver; the formatting half is pure, and is
/// here, with tests.</para>
/// <para><b>The padding is a parameter, not a detail.</b> Three rules are in use: a fixed 14 (device), a fixed 11
/// (task), and "widest label + 2" (the facet-driven three). They are preserved exactly, because unifying them would
/// silently rewrite files.</para>
/// </summary>
public sealed class Descriptor
{
    private readonly List<(string Label, string Value)> _lines = new();
    private readonly List<string> _declared = new();
    private readonly int _fixedPad;
    private readonly bool _spaceAfterLongLabel;

    /// <summary><paramref name="pad"/> 0 is AUTO width: every line is padded to the widest LABEL plus two (the
    /// facet-driven descriptors: project info, trace, symbol config). Otherwise it is a FIXED width, in columns from the
    /// start of the label INCLUDING its colon: device uses 14, task 11 — two hand-picked numbers kept because the output
    /// is hashed.
    /// <para><paramref name="spaceAfterLongLabel"/>: a label that reaches the fixed column gets ONE space after its colon
    /// instead of none — the task descriptor's labels added by openspec <c>bridge-one-to-one</c> (<c>External event:</c>)
    /// are longer than its inherited 11 columns, and <c>External event:CanRx</c> would read as one word. The inherited
    /// labels are all shorter, so their bytes do not move.</para></summary>
    public Descriptor(int pad = 0, bool spaceAfterLongLabel = false)
    {
        _fixedPad = pad;
        _spaceAfterLongLabel = spaceAfterLongLabel;
    }

    /// <summary>Add a line. A null, empty or whitespace-only value EMITS nothing — an absent field is absent from
    /// the file rather than present and blank, which is what makes these descriptors diff cleanly.
    /// <para>The label still counts toward the auto width even when its value is empty, and that is not an
    /// oversight: the original computed the column from the DECLARED field list before reading any values, so a
    /// project-info file with only a Title still aligned to "Default namespace". Narrowing the column when a
    /// field happens to be blank would re-flow the file for every user whose project fills a different subset.</para></summary>
    public Descriptor Add(string label, string? value)
    {
        _declared.Add(label);
        var v = Flatten(value);
        if (v.Length > 0) _lines.Add((label, v));
        return this;
    }

    /// <summary>Collapse a vendor string to one line: CR dropped, LF to a space, then trimmed. A device
    /// description is routinely multi-line, and a line break inside a <c>Label: value</c> file would read as a
    /// new field.</summary>
    public static string Flatten(string? value) =>
        (value ?? "").Replace("\r", "").Replace("\n", " ").Trim();

    /// <summary>Append a unit to a value ONLY when the value is a bare number (digits, sign, dot). A value already
    /// rendered as a TIME literal (<c>t#20ms</c>) or otherwise carrying letters is returned unchanged, so an
    /// interval reads unambiguously whether the vendor hands back <c>t#20ms</c> or <c>3</c> + <c>ms</c>.</summary>
    public static string Unitize(string? value, string? unit)
    {
        var v = (value ?? "").Trim();
        var u = (unit ?? "").Trim();
        if (v.Length == 0) return "";
        var bare = v.All(c => char.IsDigit(c) || c == '.' || c == '-' || c == '+');
        return bare && u.Length > 0 ? $"{v} {u}" : v;
    }

    public override string ToString()
    {
        var pad = _fixedPad > 0
            ? _fixedPad
            : (_declared.Count == 0 ? 0 : _declared.Max(l => l.Length) + 2);
        var sb = new StringBuilder();
        foreach (var (label, value) in _lines)
        {
            var head = (label + ":").PadRight(pad);
            if (_spaceAfterLongLabel && head.Length == label.Length + 1) head += " ";
            sb.Append(head).Append(value).Append('\n');
        }
        return sb.ToString();
    }
}
