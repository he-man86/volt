using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Cli.Sync;
using Volt.Contracts;
using Volt.Engine.Host;
using Volt.Engine.Item;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>
/// <c>.dut</c> AND <c>.dut</c> ↔ SUBTYPE OVER THE PIPE (openspec <c>push-without-header-check</c> 5.B.2 / 5.B.3) — the
/// transport layer of the two-layer rule: what <c>DutBareIdentityPushTests</c> pins on the service, observed through
/// a real <see cref="BridgePipeHost"/> and <see cref="BridgeClient"/>, the way every client reaches it. The vendor's
/// answer is pinned on the fake (<see cref="FakeIde.DutAnswers"/>).
/// </summary>
public class DutNameTransportTests
{
    private const string Enum = "TYPE E_Mode :\n(\n\tIdle := 0,\n\tRun\n);\nEND_TYPE";

    private static string Pipe() => "volt.test." + Guid.NewGuid().ToString("N");

    private static PushResponse Push(BridgeClient client, string? lease, params PushOp[] ops) =>
        client.PushBatch(new PushRequest { ExpectedProjectVersion = lease, Ops = ops.ToList() });

    /// <summary>No vendor answer → <c>refs</c> and <c>fetch</c> carry <c>E_Mode.dut</c> over the wire; and an update under
    /// it, after the vendor's answer arrived (<c>E_Mode.enum</c>), lands at an equal version with no force.</summary>
    [Fact]
    public void A_dot_dut_name_travels_and_an_update_under_it_reaches_the_dut_now_answering_its_subtype()
    {
        var ide = new FakeIde(new FakeIde.Item("E_Mode", ItemKind.PlcDut, "DUTs", true, Enum, null, null, null));
        ide.DutAnswers["E_Mode"] = null;
        var pipe = Pipe();
        using var host = new BridgePipeHost(ide, pipe);
        host.Start();
        var client = new BridgeClient(pipe);

        var refs = client.GetRefs();
        Assert.Equal(new[] { "E_Mode.dut" }, refs.Items.Keys.ToArray());
        var fetched = client.FetchChanges(new FetchRequest { Init = true });
        Assert.Equal("E_Mode.dut", Assert.Single(fetched.Changed).Name);
        var held = refs.Items["E_Mode.dut"];

        ide.DutAnswers["E_Mode"] = DutSubtype.Enum;
        var now = client.GetRefs();
        Assert.Equal(new[] { "E_Mode.enum" }, now.Items.Keys.ToArray());

        var resp = Push(client, now.ProjectVersion,
            new SetItemOp { Name = "E_Mode.dut", IfVersion = held, SourceText = Enum.Replace("\tRun", "\tRun,\n\tStop") + "\n" });
        Assert.True(resp.Accepted, string.Join("; ", resp.Conflicts?.Select(c => $"[{c.Code}] {c.Reason}") ?? new string[0]));
        Assert.Contains("writecontent:E_Mode", ide.Recorded);
        Assert.Equal(new[] { "E_Mode.enum" }, resp.NewItems!.Keys.ToArray());
    }

    /// <summary>…a stale version under the other DUT name is <c>STALE_ITEM_VERSION</c> over the wire, never
    /// <c>ITEM_MISSING</c>; and a create under it is <c>ITEM_EXISTS</c>.</summary>
    [Fact]
    public void Over_the_pipe_a_stale_dot_dut_update_is_stale_and_a_dot_dut_create_over_the_dut_is_item_exists()
    {
        var ide = new FakeIde(new FakeIde.Item("E_Mode", ItemKind.PlcDut, "DUTs", true, Enum, null, null, null));
        var pipe = Pipe();
        using var host = new BridgePipeHost(ide, pipe);
        host.Start();
        var client = new BridgeClient(pipe);
        var refs = client.GetRefs();
        Assert.Equal(new[] { "E_Mode.enum" }, refs.Items.Keys.ToArray());

        var stale = Push(client, refs.ProjectVersion, new SetItemOp { Name = "E_Mode.dut", IfVersion = "stale", SourceText = Enum });
        Assert.False(stale.Accepted);
        Assert.Equal(ConflictCodes.StaleItemVersion, Assert.Single(stale.Conflicts!).Code);

        var create = Push(client, refs.ProjectVersion,
            new SetItemOp { Name = "E_Mode.dut", IfVersion = null, ToFolder = "DUTs", SourceText = Enum });
        Assert.False(create.Accepted);
        Assert.Equal(ConflictCodes.ItemExists, Assert.Single(create.Conflicts!).Code);
        Assert.Empty(ide.Recorded);
    }
}
