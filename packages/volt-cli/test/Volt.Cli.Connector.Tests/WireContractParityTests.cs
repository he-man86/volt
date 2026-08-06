using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;
using Volt.Cli.Connector;
using Volt.Cli.Transport.Wire;
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
    public void The_serving_and_status_bits_round_trip_onto_each_connector_row()
    {
        // The connector reads serving/status/dirty PER ROW now (no separate probe): the served row must arrive
        // serving=true with its degraded status, and a listed-but-not-served row serving=false.
        var wire = new HealthResponse
        {
            Projects =
            {
                new ProjectEntry("codesys", "3.5", "Other", "idle", false),       // listed, not served
                new ProjectEntry("codesys", "3.5", "MyProj", "degraded", true),  // the served one
            },
        };
        var rows = WireProjects.Flatten(Serialize(wire), "codesys", "volt.bridge.codesys");
        var other = Assert.Single(rows, r => r.DisplayName == "Other");
        Assert.False(other.Serving);
        var served = Assert.Single(rows, r => r.DisplayName == "MyProj");
        Assert.True(served.Serving);
        Assert.Equal("degraded", served.Status);
        Assert.True(served.Dirty);
    }

    [Theory]
    [InlineData("healthy")]
    [InlineData("degraded")]
    [InlineData("something-new")] // the raw status rides through verbatim; Aggregate maps it to the tray colour
    public void A_rows_status_string_rides_through_verbatim(string rowStatus)
    {
        var wire = new HealthResponse { Projects = { new ProjectEntry("codesys", "3.5", "P", rowStatus, false) } };
        Assert.Equal(rowStatus, Assert.Single(WireProjects.Flatten(Serialize(wire), "codesys", null)).Status);
    }

    [Fact]
    public void Health_projects_round_trip_into_the_connector_flatten()
    {
        var wire = new HealthResponse
        {
            Projects = { new ProjectEntry("codesys", "3.5.19", "MyProj", "healthy", true) },
        };
        var projects = WireProjects.Flatten(Serialize(wire), "codesys", "volt.bridge.codesys");
        var p = Assert.Single(projects);
        Assert.Equal("MyProj", p.DisplayName);
        Assert.True(p.Dirty);
        Assert.Equal("MyProj", p.Attach.Project);
        Assert.Equal("3.5.19", p.IdeVersion);
    }
}
