using System;
using System.Collections.Generic;
using System.Runtime.ExceptionServices;
using System.Threading;
using Volt.Contracts;

namespace Volt.Engine.Host;

/// <summary>
/// ONE COMPUTATION PER QUESTION AT A TIME (openspec <c>twincat-large-solution-refs</c> 1). A call that arrives while an
/// identical one is running JOINS it: it waits for that computation and answers what it answers, success or error,
/// and receives its progress frames from the moment it joined.
///
/// <para><b>Why.</b> On an 18-PLC-project TwinCAT solution a <c>refs</c> took 148 s. A relay caller gave up at 60 s and
/// asked again, and each retry queued another full walk behind the one still running on the IDE's one thread, so every
/// later call waited for all of them. Joined, a retry waits for the walk already under way — never longer than it.</para>
///
/// <para><b>Not a cache.</b> Nothing outlives the computation: the moment it ends it is forgotten, and the next call
/// computes afresh. A joiner gets the answer of a computation that started before it asked — the same answer it would
/// have got had it arrived a moment earlier.</para>
///
/// <para><b>A listener that is gone does not stop the others.</b> Each caller's progress goes to its own connection; a
/// write to one that has closed drops that listener. Only when no caller is left listening does the failure reach the
/// computation — a lone caller that hung up stops its op at its next frame, as before.</para>
/// </summary>
internal sealed class SingleFlight
{
    private sealed class Flight
    {
        public readonly List<Action<object>> Listeners = new();
        public readonly ManualResetEventSlim Done = new(false);
        public object? Result;
        public ExceptionDispatchInfo? Error;
    }

    private readonly object _gate = new();
    private readonly Dictionary<string, Flight> _running = new(StringComparer.Ordinal);

    private readonly string _op;

    /// <param name="op">The op this answers, as its log line names it.</param>
    public SingleFlight(string op) => _op = op;

    /// <summary>Answer the call keyed <paramref name="key"/>: join the computation running for that key, or run
    /// <paramref name="compute"/> — with a progress sink that reaches every caller listening — as the new one.</summary>
    public object Run(string key, Action<object> onProgress, Func<Action<object>, object> compute)
    {
        Flight flight;
        bool owner;
        lock (_gate)
        {
            owner = !_running.TryGetValue(key, out flight!);
            if (owner) _running[key] = flight = new Flight();
            flight.Listeners.Add(onProgress);
        }

        if (!owner)
        {
            // Said, so a field log shows a retry waiting for the walk under way rather than starting another.
            VoltLog.Info($"{_op}: an identical {_op} is running — this one waits for it and answers what it answers");
            flight.Done.Wait();
            flight.Error?.Throw();
            return flight.Result!;
        }

        try
        {
            flight.Result = compute(frame => Broadcast(flight, frame));
            return flight.Result;
        }
        catch (Exception ex)
        {
            flight.Error = ExceptionDispatchInfo.Capture(ex);
            throw;
        }
        finally
        {
            lock (_gate) _running.Remove(key);
            flight.Done.Set();
        }
    }

    private void Broadcast(Flight flight, object frame)
    {
        Action<object>[] listeners;
        lock (_gate) listeners = flight.Listeners.ToArray();
        Exception? last = null;
        foreach (var listener in listeners)
        {
            try { listener(frame); }
            catch (Exception ex)
            {
                last = ex;
                lock (_gate) flight.Listeners.Remove(listener);
            }
        }
        bool none;
        lock (_gate) none = flight.Listeners.Count == 0;
        if (none && last is not null) ExceptionDispatchInfo.Capture(last).Throw();
    }
}
