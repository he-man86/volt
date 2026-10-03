using System;
using System.IO;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Host;
using Volt.Wire;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>
/// AN UNCODED FAILURE OF A CALL LEAVES EVERYTHING 3.1 NEEDS — in the bridge log and in the client's error (openspec
/// ide-identity-report 3.1).
///
/// <para>The 3.5.17 field failure is a member that failed to bind AT CALL TIME (the bridge had printed "connected to
/// IDE"). Before this, <c>PipeServer</c> wrote such a failure to the client as its bare message and logged nothing — no
/// type, no stack, nothing about which copies were loaded — and its error frame is written with the very
/// <c>WireJson.Write</c> the 3.5.21.50 failure names, so in that case the client got nothing either and the failure
/// left no trace at all. It is deliberately NOT <c>IDE_UNSUPPORTED</c>: that refusal is decided once, at attach, by a
/// missing CODESYS capability; a Volt member missing at call time is a load conflict, and it is reported as one.</para>
/// </summary>
public class CallFailureEvidenceTests
{
    // The field's own text (chat 896f798f): the member is Volt's, not a CODESYS API.
    private const string Field = "Method not found: 'Void Volt.Wire.PipeClient.Call(System.String, System.Object, " +
                                 "System.Action`1<System.Text.Json.JsonElement>, Int32)'.";

    private static string Pipe() => "volt.test." + Guid.NewGuid().ToString("N");

    private static string WithLog(Action run)
    {
        var dir = Path.Combine(Path.GetTempPath(), "volt-log-test-" + Guid.NewGuid().ToString("N"));
        VoltLog.Init("codesys", dir);
        try
        {
            run();
            return string.Concat(Directory.GetFiles(dir, "codesys-*.log").Select(File.ReadAllText));
        }
        finally { try { Directory.Delete(dir, true); } catch { } }
    }

    [Fact]
    public void A_member_missing_at_call_time_reaches_the_client_with_its_type_and_the_log_with_stack_and_copies()
    {
        var pipe = Pipe();
        PipeCallException? ex = null;
        var log = WithLog(() =>
        {
            using var host = new BridgePipeHost(
                new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"))
                    { CallFault = () => new MissingMethodException(Field) },
                pipe);
            host.Start();
            ex = Assert.Throws<PipeCallException>(() => new PipeClient(pipe).Call(Ops.Refs));
        });

        // The client: uncoded → INTERNAL_ERROR, never IDE_UNSUPPORTED; the type and the member, verbatim; and what was
        // loaded at that moment.
        Assert.Equal(BridgeErrorCodes.InternalError, ex!.Code);
        Assert.StartsWith("MissingMethodException: " + Field + " [", ex.Message);
        Assert.Matches(@"\[(loaded: one copy of each|load conflict: )", ex.Message);

        // The log: the op, the whole exception with its stack, every watched copy with its build.
        Assert.Contains($"pipe {pipe}: 'refs' failed — System.MissingMethodException: {Field}", log);
        Assert.Contains("   at ", log);
        Assert.Contains("  loaded at the failure:", log);
        var wire = typeof(PipeClient).Assembly;
        Assert.Contains($"    Volt.Wire {LoadedCopies.Of(wire).Describe()}", log);
        Assert.Contains("  load conflicts:", log);
    }

    [Fact]
    public void An_ordinary_uncoded_failure_names_its_type_and_is_logged_once_without_load_evidence()
    {
        var pipe = Pipe();
        PipeCallException? ex = null;
        var log = WithLog(() =>
        {
            using var host = new BridgePipeHost(
                new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"))
                    { CallFault = () => new InvalidOperationException("the IDE thread faulted") },
                pipe);
            host.Start();
            ex = Assert.Throws<PipeCallException>(() => new PipeClient(pipe).Call(Ops.Refs));
        });

        Assert.Equal(BridgeErrorCodes.InternalError, ex!.Code);
        Assert.Equal("InvalidOperationException: the IDE thread faulted", ex.Message);
        Assert.Contains($"pipe {pipe}: 'refs' failed — System.InvalidOperationException: the IDE thread faulted", log);
        Assert.DoesNotContain("loaded at the failure", log);
    }

    /// <summary>A CODED refusal is the caller's ordinary answer, not a failure: its message is unchanged and the log
    /// is not filled with every PLC_DISCONNECTED a poll can produce.</summary>
    [Fact]
    public void A_coded_refusal_keeps_its_message_and_is_not_logged_as_a_failure()
    {
        var pipe = Pipe();
        PipeCallException? ex = null;
        var log = WithLog(() =>
        {
            using var host = new BridgePipeHost(new FakeIde { HealthConnected = false }, pipe);
            host.Start();
            ex = Assert.Throws<PipeCallException>(() => new PipeClient(pipe).Call(Ops.Refs));
        });

        Assert.Equal(BridgeErrorCodes.PlcDisconnected, ex!.Code);
        Assert.DoesNotContain("Exception:", ex.Message);
        Assert.DoesNotContain("failed —", log);
    }
}
