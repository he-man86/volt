using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using Volt.Contracts;
using Volt.Wire;
using Xunit;

namespace Volt.Contracts.Tests;

/// <summary>
/// THE WIRE'S FINAL SHAPE, as its types state it (openspec <c>wire-final-shape</c> 3.1, design sections 1–5): what each
/// DTO serializes to, and what it no longer carries. The behaviour behind each member is tested where it is produced
/// (the pipe host, the services); this pins the SHAPE a client codes against.
/// </summary>
public class WireFinalShapeTests
{
    private static JsonElement Json(object value) =>
        JsonDocument.Parse(JsonSerializer.Serialize(value, WireJson.Write)).RootElement;

    private static IReadOnlyList<string> Members(object value) =>
        Json(value).EnumerateObject().Select(p => p.Name).ToList();

    // ── below the wire: no vendor in the contract (design "Below the wire", W1) ──

    [Fact]
    public void The_contract_names_no_vendor()
    {
        var types = typeof(WireJson).Assembly.GetTypes().Select(t => t.Name).ToList();
        Assert.DoesNotContain("Vendors", types);
    }

    [Fact]
    public void A_pipe_name_is_minted_once_for_every_vendor()
    {
        Assert.Equal("volt.bridge.codesys.7", PipeNames.Instance("codesys", 7));
        Assert.Equal("volt.bridge.fakeco.12", PipeNames.Instance("fakeco", 12));
        Assert.Equal("volt.bridge.twincat.", PipeNames.PrefixForVendor("twincat"));
        var perVendor = typeof(PipeNames).GetMembers(BindingFlags.Public | BindingFlags.Static)
            .Select(m => m.Name).Where(n => n.Contains("Codesys") || n.Contains("Twincat")).ToList();
        Assert.Empty(perVendor);
    }

    // ── section 1: the envelope ──

    [Fact]
    public void Every_request_states_its_protocol()
    {
        var frame = Json(new PipeRequest { Op = Ops.Health, Protocol = WireProtocol.Version });
        Assert.Equal(1, frame.GetProperty("protocol").GetInt32());
    }

    [Fact]
    public void An_error_frame_carries_its_facts_as_data()
    {
        Assert.Equal(new[] { "bridgeProtocol" }, Members(new ProtocolMismatchData { BridgeProtocol = 1 }));
        Assert.Equal(new[] { "currentProjectVersion" }, Members(new StaleProjectVersionData { CurrentProjectVersion = "v" }));
        Assert.Equal("PROTOCOL_MISMATCH", BridgeErrorCodes.ProtocolMismatch);
        Assert.Equal("STALE_PROJECT_VERSION", BridgeErrorCodes.StaleProjectVersion);
    }

    // ── section 2: health ──

    [Fact]
    public void Health_states_the_bridges_languages_and_kinds_and_no_networkText_flag()
    {
        var health = Json(new HealthResponse
        {
            Languages = new List<string> { "ST" },
            Kinds = new List<HealthKind> { new() { Extension = "pou", Writable = true } },
            Ops = new List<string> { Ops.Health },
            Protocol = WireProtocol.Version,
        });
        Assert.False(health.TryGetProperty("networkText", out _));
        Assert.Equal("ST", health.GetProperty("languages")[0].GetString());
        var kind = health.GetProperty("kinds")[0];
        Assert.Equal("pou", kind.GetProperty("extension").GetString());
        Assert.True(kind.GetProperty("writable").GetBoolean());
    }

    [Fact]
    public void A_project_row_has_no_version_and_no_dirty_the_IDE_did_not_state()
    {
        var row = new ProjectEntry("codesys", "P", HealthStatus.Idle, Dirty: null);
        Assert.Equal(new[] { "vendor", "project", "status" }, Members(row));
        Assert.True(Json(row with { Dirty = false }).GetProperty("dirty").ValueKind == JsonValueKind.False);
    }

    // ── section 3: connect / disconnect ──

    [Fact]
    public void Connect_and_disconnect_answer_an_empty_object() =>
        Assert.Empty(Members(new EmptyResult()));

    // ── section 4: refs / fetch ──

    [Fact]
    public void An_unreadable_entry_carries_its_code()
    {
        Assert.Equal(new[] { "name", "code", "reason" }, Members(new UnreadableItem("A/X.pou", BridgeErrorCodes.Unreadable, "r")));
        Assert.Equal(new[] { "name", "code", "reason" }, Members(new UnreadableNode("A/Lib", BridgeErrorCodes.Unsupported, "r")));
    }

    // ── section 5: push ──

    [Fact]
    public void A_push_answer_has_no_accepted_flag_and_always_lists_conflicts_newItems_and_removed()
    {
        var empty = Members(new PushResponse());
        Assert.DoesNotContain("accepted", empty);
        Assert.DoesNotContain("currentProjectVersion", empty);
        Assert.DoesNotContain("newProjectVersion", empty);   // absent exactly when nothing landed
        foreach (var always in new[] { "conflicts", "newItems", "removed", "unwalkedFolders" })
            Assert.Contains(always, empty);
        Assert.Null(typeof(PushResponse).GetProperty("Accepted"));
        Assert.Null(typeof(PushResponse).GetProperty("CurrentProjectVersion"));
    }

    [Fact]
    public void A_conflict_always_carries_its_code_and_names_a_colliding_item_in_existing()
    {
        var code = typeof(PushConflict).GetProperty(nameof(PushConflict.Code))!;
        Assert.Equal(NullabilityState.NotNull, new NullabilityInfoContext().Create(code).ReadState);
        var conflict = Json(new PushConflict { Name = "A/X.pou", Code = ConflictCodes.ItemExists, Existing = "B/X.pou", Reason = "r" });
        Assert.Equal("B/X.pou", conflict.GetProperty("existing").GetString());
    }

    [Fact]
    public void The_lease_is_no_conflict_row()
    {
        Assert.Null(typeof(ConflictCodes).GetField("ProjectName"));
        Assert.DoesNotContain(BridgeErrorCodes.StaleProjectVersion, ConflictCodes.Gate);
    }
}
