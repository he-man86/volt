using System;
using System.Text.Json;
using Volt.Engine.Host;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>
/// A NULL THE SCHEMA DOES NOT ALLOW IS A BAD_REQUEST FRAME NAMING THE MEMBER (volt-cli-rework 2.4, the public-API lens:
/// requests our CLI never sends). <c>ops: [null]</c>, a push op whose <c>name</c> is null and a grep <c>paths</c> entry
/// that is null each answered INTERNAL_ERROR ("NullReferenceException") — a request answered as a Volt bug — and a null
/// <c>onlyItems</c> / <c>knownApplications</c> / <c>applications</c> entry or <c>knownItems</c> version was read as if
/// absent. Refused by the strict body read before any walk, write or build.
/// </summary>
public class RequestNullFrameTests
{
    [Theory]
    [InlineData("push", @"{""expectedPlatform"":""codesys"",""expectedProjectName"":""FakeProject"",""ops"":[null]}", "ops")]
    [InlineData("push", @"{""expectedPlatform"":""codesys"",""expectedProjectName"":""FakeProject"",""ops"":[{""op"":""set"",""name"":null,""sourceText"":""x""}]}", "name")]
    [InlineData("grep", @"{""pattern"":""x"",""paths"":[null]}", "paths")]
    [InlineData("fetch", @"{""knownItems"":{},""onlyItems"":[null]}", "onlyItems")]
    [InlineData("fetch", @"{""knownItems"":{""P.pou"":null}}", "knownItems")]
    [InlineData("refs", @"{""knownApplications"":[null]}", "knownApplications")]
    [InlineData("build", @"{""expectedPlatform"":""codesys"",""expectedProjectName"":""FakeProject"",""applications"":[null]}", "applications")]
    public void A_null_where_the_wire_takes_a_value_is_a_BAD_REQUEST_naming_the_member(string op, string body, string member)
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"));
        var pipe = "volt.test." + Guid.NewGuid().ToString("N");
        using var host = new BridgePipeHost(ide, pipe);
        host.Start();

        var (code, message) = Error(pipe, $@"{{""op"":""{op}"",""protocol"":1,""body"":{body}}}");

        Assert.Equal("BAD_REQUEST", code);
        Assert.Contains(member, message);
        Assert.Equal(0, ide.WalkCalls);
        Assert.Empty(ide.Recorded);
        Assert.Empty(ide.BuildSequence);
    }

    private static (string Code, string Message) Error(string pipe, string line)
    {
        using var client = new System.IO.Pipes.NamedPipeClientStream(".", pipe, System.IO.Pipes.PipeDirection.InOut);
        client.Connect(5000);
        var bytes = System.Text.Encoding.UTF8.GetBytes(line + "\n");
        client.Write(bytes, 0, bytes.Length);
        client.Flush();
        using var reader = new System.IO.StreamReader(client, System.Text.Encoding.UTF8);
        string? raw;
        while ((raw = reader.ReadLine()) != null)
        {
            using var doc = JsonDocument.Parse(raw);
            if (doc.RootElement.TryGetProperty("progress", out _)) continue;
            if (!doc.RootElement.TryGetProperty("error", out var err))
                throw new Xunit.Sdk.XunitException("expected an error frame, got: " + raw);
            return (err.GetProperty("code").GetString()!, err.GetProperty("message").GetString()!);
        }
        throw new Xunit.Sdk.XunitException("the bridge answered nothing to: " + line);
    }
}
