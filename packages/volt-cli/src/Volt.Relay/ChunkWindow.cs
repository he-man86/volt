using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace Volt.Relay
{
    /// <summary>One connection's chunk flow control (openspec relay-chunked-results): the queue of chunks to send, the
    /// chunks sent and not yet acked, and the window that bounds them.
    ///
    /// <para><b>Why a window.</b> Chunking alone keeps the socket alive but not the other calls: measured, chunks sent
    /// back to back fill the OS buffer (115–230 KB) and a 300 B answer waited 60–118 s behind it. With at most W bytes
    /// unacked, any whole frame waits about W / uplink plus one chunk.</para>
    ///
    /// <para><b>The window</b> is the bytes acked over the last 5 s (a rate × 5 s), clamped to 16–256 KiB, starting at
    /// 16 KiB. From a cold start the acked sum grows by at most the window it allowed, so W at most doubles per round
    /// (16, 16, 32, 64, 128, 256 KiB: the cap in 5 rounds); on a 2 KB/s link it stays at the floor.</para>
    ///
    /// <para>Chunks of different ids share it in FIFO order: an answer's chunks are queued whole, in order, when it is
    /// ready. Whole text frames do not count against it and go out between chunks.</para>
    ///
    /// <para>Thread-safe; one lock. The clock is injected so the 5 s span is testable without waiting it.</para></summary>
    internal sealed class ChunkWindow
    {
        public const int Floor = 16 * 1024;
        public const int Cap = 256 * 1024;
        private static readonly TimeSpan Span = TimeSpan.FromSeconds(5);

        private sealed class Delivery
        {
            public int Unacked;
            public readonly TaskCompletionSource<bool> Done =
                new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        }

        private sealed class Entry
        {
            public Entry(RelayChunks.Outgoing chunk, Delivery delivery) { Chunk = chunk; Delivery = delivery; }
            public RelayChunks.Outgoing Chunk { get; }
            public Delivery Delivery { get; }
            public TimeSpan SentAt;
        }

        private readonly object _gate = new object();
        private readonly Func<TimeSpan> _now;
        private readonly Queue<Entry> _queued = new Queue<Entry>();
        // In send order, so the first is the oldest: what a stall names.
        private readonly List<Entry> _unacked = new List<Entry>();
        private readonly Queue<KeyValuePair<TimeSpan, int>> _acked = new Queue<KeyValuePair<TimeSpan, int>>();
        private int _unackedBytes;
        private long _ackedInSpan;
        private bool _closed;
        // Released when something may now be sendable: a chunk queued, or an ack that freed room.
        private readonly SemaphoreSlim _ready = new SemaphoreSlim(0);

        public ChunkWindow(Func<TimeSpan> now) { _now = now ?? throw new ArgumentNullException(nameof(now)); }

        /// <summary>The current window, in bytes.</summary>
        public int Window
        {
            get { lock (_gate) return WindowLocked(); }
        }

        private int WindowLocked()
        {
            var since = _now() - Span;
            while (_acked.Count > 0 && _acked.Peek().Key < since) _ackedInSpan -= _acked.Dequeue().Value;
            return (int)Math.Max(Floor, Math.Min(Cap, _ackedInSpan));
        }

        /// <summary>Queue an answer's chunks, in order. The task completes when the LAST of them is acked; it is
        /// cancelled when the connection ends first, and faults when one of them could not be sent.</summary>
        public Task Enqueue(string id, IReadOnlyList<byte[]> messages)
        {
            var delivery = new Delivery { Unacked = messages.Count };
            lock (_gate)
            {
                if (_closed) delivery.Done.TrySetCanceled();
                else
                    for (var seq = 0; seq < messages.Count; seq++)
                        _queued.Enqueue(new Entry(new RelayChunks.Outgoing(id, seq, messages[seq]), delivery));
            }
            _ready.Release();
            return delivery.Done.Task;
        }

        /// <summary>Wait until something may be sendable.</summary>
        public Task WaitReadyAsync(CancellationToken token) => _ready.WaitAsync(token);

        /// <summary>The next chunk, when it fits the window. Taking it counts it as sent and unacked NOW, before the
        /// send: an ack can come back before the send call returns.</summary>
        public bool TryTake(out RelayChunks.Outgoing chunk)
        {
            lock (_gate)
            {
                chunk = null!;
                if (_closed || _queued.Count == 0) return false;
                var next = _queued.Peek();
                if (_unackedBytes + next.Chunk.Message.Length > WindowLocked()) return false;
                _queued.Dequeue();
                next.SentAt = _now();
                _unacked.Add(next);
                _unackedBytes += next.Chunk.Message.Length;
                chunk = next.Chunk;
                return true;
            }
        }

        /// <summary>The relay acked chunk <paramref name="seq"/> of <paramref name="id"/>. False when no such chunk is
        /// awaiting an ack (an ack for nothing — the caller names it).</summary>
        public bool Ack(string id, int seq)
        {
            Delivery? done = null;
            lock (_gate)
            {
                var index = _unacked.FindIndex(e => e.Chunk.Seq == seq && string.Equals(e.Chunk.Id, id, StringComparison.Ordinal));
                if (index < 0) return false;
                var entry = _unacked[index];
                _unacked.RemoveAt(index);
                var size = entry.Chunk.Message.Length;
                _unackedBytes -= size;
                _acked.Enqueue(new KeyValuePair<TimeSpan, int>(_now(), size));
                _ackedInSpan += size;
                if (--entry.Delivery.Unacked == 0) done = entry.Delivery;
            }
            done?.Done.TrySetResult(true);
            _ready.Release();
            return true;
        }

        /// <summary>The oldest unacked chunk, when it was sent longer than <paramref name="limit"/> ago; null otherwise.</summary>
        public RelayChunks.Outgoing? Stalled(TimeSpan limit)
        {
            lock (_gate)
            {
                if (_unacked.Count == 0) return null;
                var oldest = _unacked[0];
                return _now() - oldest.SentAt > limit ? oldest.Chunk : null;
            }
        }

        /// <summary>A chunk could not be sent: its answer is not delivered. Its other chunks are dropped (queued and
        /// unacked), so the window is not held by an answer that can no longer complete. The caller then drops the
        /// socket: the relay learns that way that it holds a partial answer, and no ack for it can come back.</summary>
        public void Fail(RelayChunks.Outgoing chunk, Exception reason)
        {
            Delivery? delivery = null;
            lock (_gate)
            {
                foreach (var e in _unacked.Concat(_queued))
                    if (ReferenceEquals(e.Chunk, chunk)) { delivery = e.Delivery; break; }
                if (delivery == null) return;
                foreach (var e in _unacked.Where(e => e.Delivery == delivery).ToList())
                {
                    _unacked.Remove(e);
                    _unackedBytes -= e.Chunk.Message.Length;
                }
                var keep = _queued.Where(e => e.Delivery != delivery).ToList();
                _queued.Clear();
                foreach (var e in keep) _queued.Enqueue(e);
            }
            delivery.Done.TrySetException(reason);
            _ready.Release();
        }

        /// <summary>The connection ended: every answer not yet acked is abandoned, and nothing more is taken.</summary>
        public void Close()
        {
            List<Delivery> pending;
            lock (_gate)
            {
                _closed = true;
                pending = _queued.Select(e => e.Delivery).Concat(_unacked.Select(e => e.Delivery)).Distinct().ToList();
                _queued.Clear();
                _unacked.Clear();
                _unackedBytes = 0;
            }
            foreach (var d in pending) d.Done.TrySetCanceled();
        }
    }
}
