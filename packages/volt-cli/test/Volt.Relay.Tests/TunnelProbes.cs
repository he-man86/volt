using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Volt.Contracts;

namespace Volt.Relay.Tests;

/// <summary>The tunnel's reconnect wait, held by the test.
///
/// <para>Every wait the tunnel asks for is RECORDED and then BLOCKS until the test releases it. That is what lets
/// a test assert the real policy (an hour after a refusal, 30 s after a restart) without waiting any of it, and
/// what makes "no second dial during the wait" observable: the tunnel cannot dial while it is parked here.</para></summary>
public sealed class FakeDelay
{
    private readonly object _gate = new();
    private readonly List<TimeSpan> _asked = new();
    private readonly Queue<TaskCompletionSource<bool>> _pending = new();
    private readonly SemaphoreSlim _signal = new(0);
    private int _read;

    public Task Delay(TimeSpan wait, CancellationToken token)
    {
        var parked = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        // Cancellable, so disposing the tunnel ends a test that is parked in a one-hour wait.
        token.Register(() => parked.TrySetCanceled(token));
        lock (_gate)
        {
            _asked.Add(wait);
            _pending.Enqueue(parked);
        }
        _signal.Release();
        return parked.Task;
    }

    /// <summary>The next wait the tunnel asked for, in order.</summary>
    public async Task<TimeSpan> NextWait(int timeoutMs = 15_000)
    {
        if (!await _signal.WaitAsync(timeoutMs))
            throw new TimeoutException("the tunnel never asked to wait, so it never saw the connection end");
        lock (_gate) return _asked[_read++];
    }

    /// <summary>End the oldest wait: the tunnel redials.</summary>
    public void Release()
    {
        TaskCompletionSource<bool> parked;
        lock (_gate) parked = _pending.Dequeue();
        parked.TrySetResult(true);
    }
}

/// <summary>The tunnel's log lines, for this test only. VoltLog is one process-wide file that every test running
/// in parallel writes to; asserting "exactly one error line" against it would count other tests' lines.</summary>
public sealed class LogCapture
{
    private readonly ConcurrentQueue<(VoltLogLevel Level, string Message)> _lines = new();

    public void Write(VoltLogLevel level, string message) => _lines.Enqueue((level, message));

    public IReadOnlyList<(VoltLogLevel Level, string Message)> Lines => _lines.ToArray();

    public IReadOnlyList<string> At(VoltLogLevel level) =>
        _lines.Where(l => l.Level == level).Select(l => l.Message).ToList();

    public override string ToString() => string.Join("\n", _lines.Select(l => "[" + l.Level + "] " + l.Message));
}
