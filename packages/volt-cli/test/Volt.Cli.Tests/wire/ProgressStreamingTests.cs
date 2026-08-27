using System;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Volt.Wire;
using Xunit;
using Xunit.Abstractions;

namespace Volt.Cli.Tests;

/// <summary>
/// Progress frames must reach the caller AS THEY ARRIVE, not after the operation finishes.
///
/// <para><c>PipeClient.ReadFrames</c> returned a <c>List</c>, so the client drained the socket to EOF before the
/// consuming loop saw anything. Every progress frame was then delivered after the work was already done: the
/// server streams progress precisely so a long pull can report while it runs, and buffering turned a live bar
/// into a replay — `volt pull` sat silent through the whole fetch, then printed its history at once.</para>
///
/// <para>The test is a DEADLOCK, not a stopwatch. The server sends progress and then waits for the client to
/// acknowledge it from inside <c>onProgress</c> before sending the result. If frames are buffered until EOF the
/// client cannot acknowledge — it is still blocked reading — and neither side can move. Timing assertions would
/// be flaky here; a hang is unambiguous.</para>
/// </summary>
public class ProgressStreamingTests
{
    private readonly ITestOutputHelper _out;
    public ProgressStreamingTests(ITestOutputHelper o) => _out = o;

    private static string PipeName() => "volt.test." + Guid.NewGuid().ToString("N");

    [Fact]
    public void A_progress_frame_reaches_the_caller_before_the_result_is_sent()
    {
        var pipe = PipeName();
        var sawProgress = new SemaphoreSlim(0, 1);
        var serverDone = new ManualResetEventSlim(false);

        var server = Task.Run(() =>
        {
            using var s = new NamedPipeServerStream(pipe, PipeDirection.InOut);
            s.WaitForConnection();

            // Drain the request line.
            var b = new byte[1];
            while (s.Read(b, 0, 1) > 0 && b[0] != (byte)'\n') { }

            void Send(string json)
            {
                var bytes = Encoding.UTF8.GetBytes(json + "\n");
                s.Write(bytes, 0, bytes.Length);
                s.Flush();
            }

            Send("{\"progress\":{\"done\":1,\"total\":2}}");

            // The whole point: block until the client has ACTED on that frame. A buffering client never will.
            if (!sawProgress.Wait(TimeSpan.FromSeconds(10)))
            {
                Send("{\"error\":{\"code\":\"TIMEOUT\",\"message\":\"client never saw progress before EOF\"}}");
                serverDone.Set();
                return;
            }

            Send("{\"result\":{\"ok\":true}}");
            serverDone.Set();
        });

        var client = new PipeClient(pipe);
        var progressCount = 0;

        var res = client.Call("noop", null, onProgress: _ =>
        {
            progressCount++;
            sawProgress.Release();          // unblocks the server — only possible if this ran mid-stream
        });

        server.Wait(TimeSpan.FromSeconds(15));
        serverDone.Wait(TimeSpan.FromSeconds(5));
        _out.WriteLine($"progress frames seen: {progressCount}");

        Assert.Equal(1, progressCount);
        Assert.True(res.TryGetProperty("ok", out var ok) && ok.GetBoolean());
    }
}
