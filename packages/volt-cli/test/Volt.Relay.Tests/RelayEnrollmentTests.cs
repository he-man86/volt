using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Volt.Relay;
using Xunit;

namespace Volt.Relay.Tests;

/// <summary>The one-time setup code is redeemed ONCE, into the folder the bridge was installed in. The code cannot be
/// redeemed a second time, so the sidecar it becomes is the whole pairing: written where the next start does not look
/// (a per-session copy), or not written at all after the code was spent, and the bridge has no relay for good.</summary>
public class RelayEnrollmentTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "volt-enrol-" + Guid.NewGuid().ToString("N"));
    private readonly List<string> _log = new();
    private readonly SetupEndpoint _app = new();

    public RelayEnrollmentTests()
    {
        Directory.CreateDirectory(_dir);
        File.WriteAllText(Path.Combine(_dir, RelayEnrollment.FileName),
            "{\"code\":\"abc\",\"app\":\"" + _app.Url + "\"}");
    }

    public void Dispose()
    {
        _app.Dispose();
        try { Directory.Delete(_dir, true); } catch { }
    }

    [Fact]
    public void The_code_is_redeemed_once_into_the_folder_given_and_a_later_start_reads_that_sidecar()
    {
        Assert.True(RelayEnrollment.EnsureSidecar(_dir, _log.Add));
        var sidecar = RelaySidecar.Load(_dir);
        Assert.NotNull(sidecar);
        Assert.Equal("wss://relay.test/bridge", sidecar!.Url);
        Assert.Contains(_log, l => l.Contains(Path.Combine(_dir, RelaySidecar.FileName), StringComparison.Ordinal));

        // The next IDE start: already paired, nothing redeemed.
        Assert.False(RelayEnrollment.EnsureSidecar(_dir, _log.Add));
        Assert.Equal(1, _app.Hits);
    }

    [Fact]
    public void A_folder_the_sidecar_cannot_be_written_to_is_refused_by_name_before_the_code_is_spent()
    {
        // The sidecar's temp file cannot be created: a directory holds its name.
        Directory.CreateDirectory(Path.Combine(_dir, RelaySidecar.FileName + ".tmp"));

        Assert.False(RelayEnrollment.EnsureSidecar(_dir, _log.Add));

        Assert.Equal(0, _app.Hits);
        Assert.Contains(_log, l => l.StartsWith("relay: cannot write ", StringComparison.Ordinal)
                                   && l.Contains(_dir, StringComparison.Ordinal)
                                   && l.Contains("not redeemed", StringComparison.Ordinal));
        Assert.Null(RelaySidecar.Load(_dir));
    }

    /// <summary>The app's <c>/api/bridge/setup/{code}</c>: answers every GET with a sidecar body and counts the calls. A
    /// raw socket, not HttpListener: a non-admin HttpListener needs a URL ACL.</summary>
    private sealed class SetupEndpoint : IDisposable
    {
        private readonly TcpListener _listener = new(IPAddress.Loopback, 0);
        private readonly CancellationTokenSource _stop = new();
        private int _hits;

        public SetupEndpoint()
        {
            _listener.Start();
            _ = Task.Run(Serve);
        }

        public string Url => "http://127.0.0.1:" + ((IPEndPoint)_listener.LocalEndpoint).Port;
        public int Hits => Volatile.Read(ref _hits);

        private async Task Serve()
        {
            while (!_stop.IsCancellationRequested)
            {
                TcpClient client;
                try { client = await _listener.AcceptTcpClientAsync(_stop.Token); }
                catch { return; }
                using (client)
                {
                    var stream = client.GetStream();
                    var buffer = new byte[4096];
                    var request = new StringBuilder();
                    while (!request.ToString().Contains("\r\n\r\n", StringComparison.Ordinal))
                    {
                        var n = await stream.ReadAsync(buffer);
                        if (n == 0) break;
                        request.Append(Encoding.ASCII.GetString(buffer, 0, n));
                    }
                    Interlocked.Increment(ref _hits);
                    var body = "{\"url\":\"wss://relay.test/bridge\",\"token\":\"t\"}";
                    var response = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: " + body.Length
                                   + "\r\nConnection: close\r\n\r\n" + body;
                    await stream.WriteAsync(Encoding.ASCII.GetBytes(response));
                }
            }
        }

        public void Dispose()
        {
            _stop.Cancel();
            _listener.Stop();
        }
    }
}
