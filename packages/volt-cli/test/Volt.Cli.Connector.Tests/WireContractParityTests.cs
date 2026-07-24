using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;
using Volt.Cli.Connector;
using Volt.Engine.Wire;
using Xunit;

namespace Volt.Cli.Connector.Tests;

/// <summary>The connector deliberately CANNOT reference Volt.Engine (the parity boundary is the pipe wire), so it
/// hand-mirrors the `health` shape (liveness + the connectable-projects list). Nothing else pins those mirrors to the authoritative
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
    public void The_serving_row_round_trips_into_the_connector_reader()
    {
        // The connector reads the ONE serving row for the bridge's connection state.
        var wire = new HealthResponse
        {
            Projects =
            {
                new ProjectEntry("codesys", "i", "3.5", "Other", "healthy", false, false),   // listed, not served
                new ProjectEntry("codesys", "i", "3.5", "MyProj", "degraded", true, true),  // the served one
            },
        };
        var h = HealthProbe.FromWire(Serialize(wire));
        Assert.Equal(BridgeStatus.Degraded, h.Status);
        Assert.Equal("MyProj", h.ProjectName);
        Assert.True(h.ProjectDirty);
    }

    [Theory]
    [InlineData("healthy", BridgeStatus.Connected)]
    [InlineData("degraded", BridgeStatus.Degraded)]
    [InlineData("something-new", BridgeStatus.Connected)] // a serving row = connected; only "degraded" downgrades
    public void A_serving_rows_status_maps_to_the_bridge_status(string rowStatus, BridgeStatus expected)
    {
        var wire = new HealthResponse { Projects = { new ProjectEntry("codesys", "i", "3.5", "P", rowStatus, true, false) } };
        Assert.Equal(expected, HealthProbe.FromWire(Serialize(wire)).Status);
    }

    [Fact]
    public void No_serving_row_is_Unavailable()
    {
        // Projects listed but none served = the bridge is up, nothing connected.
        var wire = new HealthResponse { Projects = { new ProjectEntry("codesys", "i", "3.5", "P", "healthy", false, false) } };
        Assert.Equal(BridgeStatus.Unavailable, HealthProbe.FromWire(Serialize(wire)).Status);
    }

    [Fact]
    public void Health_projects_round_trip_into_the_connector_flatten()
    {
        var wire = new HealthResponse
        {
            Projects = { new ProjectEntry("codesys", "inst-1", "3.5.19", "MyProj", "healthy", true, true) },
        };
        var projects = WireProjects.Flatten(Serialize(wire), "codesys", "volt.bridge.codesys");
        var p = Assert.Single(projects);
        Assert.Equal("MyProj", p.DisplayName);
        Assert.True(p.Dirty);
        Assert.Equal("inst-1", p.Attach.Instance);
        Assert.Equal("MyProj", p.Attach.Project);
        Assert.Equal("3.5.19", p.IdeVersion);
    }
}
