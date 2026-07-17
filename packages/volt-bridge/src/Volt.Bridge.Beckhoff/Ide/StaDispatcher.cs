using System;
using System.Collections.Concurrent;
using System.Threading;

namespace Volt.Bridge.Beckhoff;

/// <summary>
/// Marshals work onto the bridge's dedicated STA thread. The TwinCAT COM (DTE / system manager) objects
/// are apartment-bound, so every read/write must run on the one STA thread that created the attachment —
/// but the HTTP server runs on background ThreadPool threads. This is the Beckhoff analogue of the
/// CODESYS bridge's <c>CodesysDispatcher</c> (which wraps the IDE's own <c>InvokeInPrimaryThread</c>);
/// here we own the thread ourselves and feed it through a blocking queue.
///
/// <para><see cref="RunMessageLoop"/> is the loop that thread runs (started from <c>Program.cs</c>);
/// <see cref="Run{T}"/> is called from any thread to dispatch a unit of work onto it and block for the
/// result.</para>
/// </summary>
internal sealed class StaDispatcher
{
    private readonly BlockingCollection<Action> _queue = new();

    /// <summary>Drain and run queued work on the calling (STA) thread until cancelled. Per-item failures
    /// are already surfaced to each caller via <see cref="Run{T}"/>, so the loop itself never throws.</summary>
    public void RunMessageLoop(CancellationToken cancel)
    {
        while (!cancel.IsCancellationRequested)
        {
            if (_queue.TryTake(out var action, 100))
            {
                try { action(); } catch { /* per-item failure already surfaced to its caller via the result */ }
            }
            else { try { Thread.Sleep(10); } catch { } }
        }
    }

    /// <summary>Run <paramref name="fn"/> on the STA thread, block for its result, and re-throw any exception
    /// on the calling thread. No artificial time cap: a build (or a large refs walk) legitimately runs for
    /// minutes, and the per-operation budget already lives on the caller side — the CLI's per-endpoint HTTP
    /// timeouts and the streaming keep-alive. A waiter-timeout here could not unwedge a genuinely stuck STA
    /// thread anyway (the queued action stays stuck; the next item never runs), so it would only mistranslate
    /// "slow but healthy" into a failure. This matches the CODESYS bridge, which marshals via the IDE's own
    /// InvokeInPrimaryThread with no artificial cap.</summary>
    public T Run<T>(Func<T> fn)
    {
        using var evt = new ManualResetEventSlim(false);
        T result = default!;
        Exception? error = null;
        _queue.Add(() =>
        {
            try { result = fn(); }
            catch (Exception ex) { error = ex; }
            finally { evt.Set(); }
        });
        evt.Wait();
        if (error != null) throw error;
        return result;
    }
}
