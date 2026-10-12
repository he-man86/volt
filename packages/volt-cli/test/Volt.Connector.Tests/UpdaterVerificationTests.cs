using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Volt.Contracts;
using Xunit;

namespace Volt.Connector.Tests;

/// <summary>
/// The verified update (openspec installer-rebuild, design "Verified update"): the connector runs a downloaded
/// installer only after its SHA-256 equals the <c>digest</c> GitHub publishes for the release asset; a mismatch or a
/// missing digest is refused BY NAME and nothing is handed to the launcher. The feed is served from localhost —
/// the Updater takes its feed URL as a parameter, so no env var, hidden verb or UI automation is involved.
///
/// <para>ONE fact, three releases in a fixed order. The Updater is a static singleton (<c>_pending</c>,
/// <c>_applying</c>), and a SUCCESSFUL download deliberately leaves <c>_applying</c> set — the tray is about to
/// launch and exit — so the positive control must run last, and xunit does not order facts.
/// <c>scripts/test-install.ts</c> runs this class as its step 10 so the install gate reports it.</para>
/// </summary>
public class UpdaterVerificationTests : IDisposable
{
    private readonly string _logDir = Path.Combine(Path.GetTempPath(), "volt-updater-test-" + Guid.NewGuid().ToString("N"));
    private readonly HttpListener _http = new();
    private readonly CancellationTokenSource _stop = new();
    private readonly string _root;

    // What the feed serves right now (one release at a time).
    private volatile string _tag = "";
    private volatile string? _digest;
    private readonly byte[] _installer = Encoding.ASCII.GetBytes("MZ pretend Volt-win-Setup.exe " + Guid.NewGuid());

    public UpdaterVerificationTests()
    {
        VoltLog.Init("connector", _logDir);
        var port = FreePort();
        _root = $"http://127.0.0.1:{port}";
        _http.Prefixes.Add(_root + "/");
        _http.Start();
        _ = Task.Run(Serve);
    }

    public void Dispose()
    {
        _stop.Cancel();
        try { _http.Stop(); } catch { /* already stopped */ }
        foreach (var f in Directory.GetFiles(Path.GetTempPath(), "Volt-9*-Setup.exe")) try { File.Delete(f); } catch { }
        try { Directory.Delete(_logDir, true); } catch { /* best effort */ }
    }

    [Fact]
    public async Task Download_RunsOnlyAnInstallerWhoseDigestMatches()
    {
        // 1. No digest published → refused by name, nothing to launch.
        _tag = "901.0.0"; _digest = null;
        await Updater.CheckOnce(_root, "1.0.0");
        Assert.Equal("901.0.0", Updater.PendingVersion);
        var missing = await Updater.DownloadPendingAsync();
        Assert.True(missing == null, $"a release with NO digest was downloaded for launch: {missing}");
        AssertRefusedByName("901.0.0");
        Assert.False(File.Exists(Path.Combine(Path.GetTempPath(), "Volt-901.0.0-Setup.exe")), "the unverified download was left in %TEMP%");

        // 2. A digest that does not match the bytes (a tampered download) → refused by name, nothing to launch.
        _tag = "902.0.0"; _digest = "sha256:" + Hex(SHA256.HashData(Encoding.ASCII.GetBytes("something else")));
        await Updater.CheckOnce(_root, "1.0.0");
        Assert.Equal("902.0.0", Updater.PendingVersion);
        var tampered = await Updater.DownloadPendingAsync();
        Assert.True(tampered == null, $"a download whose SHA-256 differs from the published digest was accepted: {tampered}");
        AssertRefusedByName("902.0.0");
        Assert.False(File.Exists(Path.Combine(Path.GetTempPath(), "Volt-902.0.0-Setup.exe")), "the tampered download was left in %TEMP%");

        // 3. Positive control (LAST — see the class comment): the matching digest is accepted and the exact bytes land.
        _tag = "903.0.0"; _digest = "sha256:" + Hex(SHA256.HashData(_installer));
        await Updater.CheckOnce(_root, "1.0.0");
        var good = await Updater.DownloadPendingAsync();
        Assert.NotNull(good);
        Assert.Equal(_installer, File.ReadAllBytes(good!));
    }

    /// <summary>The refusal is a named log line: it says WHICH release and that its digest is why.</summary>
    private void AssertRefusedByName(string version)
    {
        var lines = Directory.Exists(_logDir)
            ? Directory.GetFiles(_logDir, "*.log").SelectMany(File.ReadAllLines).ToArray()
            : Array.Empty<string>();
        Assert.True(
            lines.Any(l => l.Contains(version) && l.Contains("digest", StringComparison.OrdinalIgnoreCase)),
            $"no log line refuses {version} by its digest; the log was:\n{string.Join("\n", lines)}");
    }

    private async Task Serve()
    {
        while (!_stop.IsCancellationRequested)
        {
            HttpListenerContext ctx;
            try { ctx = await _http.GetContextAsync(); }
            catch { return; } // listener stopped
            var path = ctx.Request.Url!.AbsolutePath;
            byte[] body;
            if (path == "/Volt-win-Setup.exe") body = _installer;
            else if (path == "/releases/latest") body = Encoding.UTF8.GetBytes(Release(prerelease: false));
            else if (path == "/releases") body = Encoding.UTF8.GetBytes("[" + Release(prerelease: true) + "]");
            else { ctx.Response.StatusCode = 404; ctx.Response.Close(); continue; }
            ctx.Response.ContentLength64 = body.Length;
            await ctx.Response.OutputStream.WriteAsync(body);
            ctx.Response.Close();
        }
    }

    /// <summary>One GitHub-shaped release. Served on both feeds (stable: /releases/latest; dev: the newest
    /// prerelease of /releases), so the test does not depend on the machine's update channel.</summary>
    private string Release(bool prerelease)
    {
        var asset = new System.Collections.Generic.Dictionary<string, object?>
        {
            ["name"] = "Volt-win-Setup.exe",
            ["browser_download_url"] = _root + "/Volt-win-Setup.exe",
        };
        if (_digest != null) asset["digest"] = _digest;
        return JsonSerializer.Serialize(new { tag_name = _tag, prerelease, draft = false, assets = new[] { asset } });
    }

    private static string Hex(byte[] b) => Convert.ToHexString(b).ToLowerInvariant();

    private static int FreePort()
    {
        var l = new TcpListener(IPAddress.Loopback, 0);
        l.Start();
        var port = ((IPEndPoint)l.LocalEndpoint).Port;
        l.Stop();
        return port;
    }
}
