using System;
using System.Collections.Generic;

namespace Volt.Engine.Ide;

/// <summary>
/// What a driver says WHILE it walks the project (<c>IVendorTree.Walk</c>), for the operation that asked:
/// each application as its walk finishes, and the time of a phase of the walk that only the vendor can see (TwinCAT's
/// Solution Explorer reads).
///
/// <para><b>Why it exists</b> (openspec <c>twincat-large-solution-refs</c>): on an 18-PLC-project TwinCAT solution the
/// walk took longer than a relay's 60 s budget and said nothing while it ran, so the relay counted no progress and could
/// not tell a working bridge from a hung one; and nobody could say which part of the 148 s was the walk. The operation
/// turns each application into a progress frame (<c>phase: "walking"</c>) and every phase into its timing line.</para>
///
/// <para>Observation only: nothing a driver reports here changes what the walk returns.</para>
/// </summary>
public sealed class WalkObserver
{
    private readonly Action<string, int, int?>? _applicationWalked;
    private readonly List<(string Name, long Ms)> _phases = new();

    /// <param name="applicationWalked">Called with the application's root, how many applications the walk has finished,
    /// and how many it will walk (null when the vendor learns its applications as it walks).</param>
    public WalkObserver(Action<string, int, int?>? applicationWalked = null) => _applicationWalked = applicationWalked;

    /// <summary>The walk finished the application rooted at <paramref name="application"/> — the
    /// <paramref name="done"/>-th of <paramref name="total"/>.</summary>
    public void ApplicationWalked(string application, int done, int? total) => _applicationWalked?.Invoke(application, done, total);

    /// <summary>A phase of the walk the vendor timed, in milliseconds — summed by name.</summary>
    public void Phase(string name, long ms)
    {
        for (var i = 0; i < _phases.Count; i++)
        {
            if (_phases[i].Name != name) continue;
            _phases[i] = (name, _phases[i].Ms + ms);
            return;
        }
        _phases.Add((name, ms));
    }

    /// <summary>Every phase reported, in the order first reported, with its summed time.</summary>
    public IReadOnlyList<(string Name, long Ms)> Phases => _phases;
}
