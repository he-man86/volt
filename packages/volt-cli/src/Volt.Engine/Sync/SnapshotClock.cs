using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using System.Text;

using Volt.Engine.Ide;

namespace Volt.Engine.Sync;

/// <summary>
/// Where the time of one project snapshot (<see cref="ProjectSnapshot.Walk"/>) went, and what it was doing when it
/// stopped — for the one Info line a <c>refs</c> logs (openspec <c>twincat-large-solution-refs</c>).
///
/// <para>A customer's 18-PLC-project TwinCAT <c>refs</c> took 148 s and the log said only that; nobody could tell the
/// walk from the materialize, nor which PLC project cost what. The line names: the walk, the vendor's own walk phases
/// (<see cref="WalkObserver.Phase"/>: TwinCAT's Solution Explorer reads, its I/O devices), each application's walk, the
/// materialize, each application's materialize, and the compiler-settings items among them. A snapshot that fails says
/// what it was doing (<see cref="Doing"/>), so a fault met at one item or one PLC project is named by it.</para>
/// </summary>
public sealed class SnapshotClock
{
    private readonly Stopwatch _total = Stopwatch.StartNew();
    private long _walkMs;
    private long _lapAt;
    private readonly List<(string Application, long Ms)> _walkPerApplication = new();
    private IReadOnlyList<(string Name, long Ms)> _walkPhases = Array.Empty<(string, long)>();
    private long _materializeMs;
    private readonly Dictionary<string, long> _materializePerApplication = new(StringComparer.Ordinal);
    private readonly List<string> _applicationOrder = new();
    private long _settingsMs;
    private int _items;

    /// <summary>What the snapshot is doing now — <c>walking</c>, <c>walking (after &lt;application&gt;)</c>,
    /// <c>materializing &lt;item path&gt;</c>, or <c>done</c>.</summary>
    public string Doing { get; private set; } = "walking";

    /// <summary>Milliseconds since the clock started.</summary>
    public long ElapsedMs => _total.ElapsedMilliseconds;

    internal void ApplicationWalked(string application)
    {
        var now = _total.ElapsedMilliseconds;
        _walkPerApplication.Add((application, now - _lapAt));
        _lapAt = now;
        Doing = $"walking (after {application})";
    }

    internal void Walked(WalkObserver observer)
    {
        _walkMs = _total.ElapsedMilliseconds;
        _walkPhases = observer.Phases;
    }

    internal void Materializing(string path) => Doing = $"materializing {path}";

    internal void Materialized(string? application, string kind, long ms)
    {
        _items++;
        var key = application ?? "(no application)";
        if (!_materializePerApplication.ContainsKey(key)) _applicationOrder.Add(key);
        _materializePerApplication[key] = (_materializePerApplication.TryGetValue(key, out var sum) ? sum : 0) + ms;
        if (kind == Item.ItemKind.Kinds.ProjectSettings) _settingsMs += ms;
    }

    internal void Done()
    {
        _materializeMs = _total.ElapsedMilliseconds - _walkMs;
        Doing = "done";
    }

    /// <summary>The breakdown, one line: <c>walk W ms [phase P ms, …; per application: A W ms, …], materialize M ms
    /// [N items; settings S ms; per application: A M ms, …]</c>.</summary>
    public override string ToString()
    {
        static string Ms(long ms) => ms.ToString(CultureInfo.InvariantCulture) + " ms";
        var sb = new StringBuilder();
        sb.Append("walk ").Append(Ms(_walkMs)).Append(" [");
        foreach (var (name, ms) in _walkPhases) sb.Append(name).Append(' ').Append(Ms(ms)).Append(", ");
        sb.Append("per application: ")
          .Append(_walkPerApplication.Count == 0 ? "none" : string.Join(", ", _walkPerApplication.Select(a => a.Application + " " + Ms(a.Ms))))
          .Append("], materialize ").Append(Ms(_materializeMs))
          .Append(" [").Append(_items.ToString(CultureInfo.InvariantCulture)).Append(" items; settings ").Append(Ms(_settingsMs))
          .Append("; per application: ")
          .Append(_applicationOrder.Count == 0 ? "none" : string.Join(", ", _applicationOrder.Select(a => a + " " + Ms(_materializePerApplication[a]))))
          .Append(']');
        return sb.ToString();
    }
}
