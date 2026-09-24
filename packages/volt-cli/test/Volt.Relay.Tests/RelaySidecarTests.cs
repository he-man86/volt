using System;
using System.IO;
using Volt.Relay;
using Xunit;

namespace Volt.Relay.Tests;

/// <summary>
/// The sidecar decides whether a bridge is reachable from anywhere at all, and it is written by a DOWNLOAD
/// rather than by a human — so the failure that matters is a file that is present and subtly wrong.
///
/// <para>The tempting behaviour is to warn and carry on locally. It is the wrong one: the result is a bridge
/// that looks healthy on the machine it runs on and is simply absent from the far end, which is
/// indistinguishable from "the relay is down" and has a completely different fix.</para>
/// </summary>
public class RelaySidecarTests : IDisposable
{
    private readonly string _dir;

    public RelaySidecarTests()
    {
        _dir = Path.Combine(Path.GetTempPath(), "volt-sidecar-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_dir);
    }

    public void Dispose()
    {
        try { Directory.Delete(_dir, recursive: true); } catch { }
    }

    private static RelaySidecar Parse(string json) => RelaySidecar.Parse(json, "C:/test/volt-relay.json");

    // ── absent is not an error ───────────────────────────────────

    /// <summary>A bridge with no sidecar is exactly the bridge that exists today: no tunnel, no socket, no
    /// behaviour change. This must never become a startup failure.</summary>
    [Fact]
    public void No_file_is_null_not_a_throw()
    {
        Assert.Null(RelaySidecar.Load(_dir));
    }

    [Fact]
    public void No_directory_is_null_too()
    {
        Assert.Null(RelaySidecar.Load(Path.Combine(_dir, "nope")));
        Assert.Null(RelaySidecar.Load(null));
    }

    // ── present and usable ───────────────────────────────────────

    [Fact]
    public void Reads_url_and_token()
    {
        var config = Parse("{\"url\":\"wss://relay.example.com/bridge\",\"token\":\"secret-token\"}");
        Assert.Equal("wss://relay.example.com/bridge", config.Url);
        Assert.Equal("secret-token", config.Token);
    }

    [Fact]
    public void Loads_from_a_directory()
    {
        File.WriteAllText(Path.Combine(_dir, RelaySidecar.FileName),
            "{\"url\":\"wss://r.test/bridge\",\"token\":\"t\"}");
        var config = RelaySidecar.Load(_dir);
        Assert.NotNull(config);
        Assert.Equal("t", config!.Token);
    }

    // ── present and NOT usable: every one of these must throw ────

    [Theory]
    [InlineData("", "empty file")]
    [InlineData("not json", "not JSON at all")]
    [InlineData("[]", "a JSON array")]
    [InlineData("\"a string\"", "a bare JSON string")]
    [InlineData("{}", "neither field")]
    [InlineData("{\"token\":\"t\"}", "no url")]
    [InlineData("{\"url\":\"wss://r.test\"}", "no token")]
    [InlineData("{\"url\":\"\",\"token\":\"t\"}", "empty url")]
    [InlineData("{\"url\":\"wss://r.test\",\"token\":\"\"}", "empty token")]
    [InlineData("{\"url\":123,\"token\":\"t\"}", "url is a number")]
    [InlineData("{\"url\":\"wss://r.test\",\"token\":true}", "token is a bool")]
    [InlineData("{\"url\":\"relay.example.com\",\"token\":\"t\"}", "url is not absolute")]
    [InlineData("{\"url\":\"https://r.test/bridge\",\"token\":\"t\"}", "https, not a websocket scheme")]
    [InlineData("{\"url\":\"file:///c:/nope\",\"token\":\"t\"}", "not a websocket scheme")]
    public void A_broken_sidecar_throws_and_names_the_file(string json, string why)
    {
        var ex = Assert.Throws<RelaySidecarException>(() => Parse(json));
        Assert.Contains("volt-relay.json", ex.Message, StringComparison.Ordinal);
        Assert.Contains("C:/test/volt-relay.json", ex.Message, StringComparison.Ordinal);
        Assert.False(string.IsNullOrWhiteSpace(why));
    }

    /// <summary>The CODESYS staging step copies every `.json` beside the script into %TEMP%, so "which copy did
    /// it read" is the first question. The path is on the exception, not only in the message.</summary>
    [Fact]
    public void The_exception_carries_the_path()
    {
        var ex = Assert.Throws<RelaySidecarException>(() => RelaySidecar.Parse("{}", "D:/staged/volt-relay.json"));
        Assert.Equal("D:/staged/volt-relay.json", ex.Path);
    }

    // ── the token must not leak ──────────────────────────────────

    /// <summary>This value authorizes writes to a live PLC project. The one formatter a host is meant to log
    /// gives the URL's HOST and nothing else.</summary>
    [Fact]
    public void SafeDescription_is_the_host_and_never_the_token()
    {
        var config = Parse("{\"url\":\"wss://relay.example.com/bridge?x=1\",\"token\":\"SUPER-SECRET\"}");
        Assert.Equal("relay.example.com", config.SafeDescription);
        Assert.DoesNotContain("SUPER-SECRET", config.SafeDescription, StringComparison.Ordinal);
    }

    /// <summary>A malformed-sidecar message is written to a log. It names the file and the reason — it must not
    /// carry the token, and a `token` that fails validation is exactly when a naive formatter would echo it.
    /// </summary>
    [Theory]
    [InlineData("{\"url\":\"wss://r.test\",\"token\":\"\"}")]
    [InlineData("{\"url\":\"wss://r.test\",\"token\":\"SUPER-SECRET-BUT-WRONG-TYPE\"}")]
    public void No_error_message_ever_contains_a_token(string json)
    {
        try
        {
            var config = Parse(json);
            // Parsed fine — then nothing was logged about it anyway.
            Assert.NotNull(config);
        }
        catch (RelaySidecarException ex)
        {
            Assert.DoesNotContain("SUPER-SECRET", ex.Message, StringComparison.Ordinal);
        }
    }
}
