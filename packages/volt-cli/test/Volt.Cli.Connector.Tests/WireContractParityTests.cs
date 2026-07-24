using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;
using Volt.Cli.Connector;
using Volt.Engine.Wire;
using Xunit;

namespace Volt.Cli.Connector.Tests;

/// <summary>The connector deliberately CANNOT reference Volt.Engine (the parity boundary is the pipe wire), so it
/// hand-mirrors the `instances` and `health` shapes. Nothing else pins those mirrors to the authoritative
/// <c>Volt.Engine.Wire</c> DTOs — a bridge-side rename would silently degrade the tray while the CLI keeps working.
/// These tests are that pin: the bridge serializes the real DTO (camelCase, as the pipe does), the connector's
/// parser reads it, and every field the connector relies on must survive. Red the moment the shapes drift.</summary>
public class WireContractParityTests
{
    // Mimic the pipe: camelCase + omit nulls (the bridge's server option — a null projectDirty is ABSENT on the wire,
    // not `null`, which is what the connector's reader expects). HealthResponse's [JsonPropertyName] wins regardless.
    private static readonly JsonSerializerOptions Wire = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private static JsonElement Serialize<T>(T value) => JsonDocument.Parse(JsonSerializer.Serialize(value, Wire)).RootElement;

    [Fact]
    public void Health_response_round_trips_into_the_connector_reader()
    {
        var wire = new HealthResponse { Status = "degraded", Connected = true, ProjectName = "MyProj", ProjectDirty = true, ActiveOp = "push" };
        var h = HealthProbe.FromWire(Serialize(wire));
        Assert.Equal(BridgeStatus.Degraded, h.Status);
        Assert.Equal("MyProj", h.ProjectName);
        Assert.True(h.ProjectDirty);
        Assert.Equal("push", h.ActiveOp);
    }

    [Theory]
    [InlineData("healthy", BridgeStatus.Connected)]
    [InlineData("degraded", BridgeStatus.Degraded)]
    [InlineData("unavailable", BridgeStatus.Unavailable)]
    [InlineData("something-new", BridgeStatus.Unknown)] // an unmodeled word must degrade to Unknown, not throw
    public void Health_status_vocabulary_matches_the_bridge(string wireStatus, BridgeStatus expected)
    {
        Assert.Equal(expected, HealthProbe.FromWire(Serialize(new HealthResponse { Status = wireStatus })).Status);
    }

    [Fact]
    public void Instances_result_round_trips_into_the_connector_flatten()
    {
        var wire = new InstancesResult(new List<IdeInstance>
        {
            new("inst-1", "XAE", "3.5.19", new List<IdeProject> { new("MyProj", true) }),
        });
        var projects = WireProjects.Flatten(Serialize(wire), "codesys", "volt.bridge.codesys");
        var p = Assert.Single(projects);
        Assert.Equal("MyProj", p.DisplayName);
        Assert.True(p.Dirty);
        Assert.Equal("inst-1", p.Attach.Instance);
        Assert.Equal("MyProj", p.Attach.Project);
        Assert.Equal("3.5.19", p.IdeVersion);
    }
}
