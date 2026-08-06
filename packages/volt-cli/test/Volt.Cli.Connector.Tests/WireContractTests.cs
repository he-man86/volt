using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Volt.Cli.Connector;
using Volt.Cli.Transport.Wire; // the health row (ProjectEntry/HealthResponse)
using Volt.Engine.Wire;        // ConnectRequest — deliberately NOT moved down with the row
using Xunit;

namespace Volt.Cli.Connector.Tests;

/// <summary>Proves the two halves of the connection wire agree: the bridge PRODUCES the connectable-projects list on
/// its <see cref="HealthResponse"/> (<c>health.projects</c>), and the connector's <see cref="PerPipeProjectSource"/>
/// CONSUMES that exact serialized shape into <see cref="DetectedProject"/>s. If either side's field names drift, this
/// fails. (Discovery folded into <c>health</c> — there is no separate <c>instances</c> op.)</summary>
public class WireContractTests
{
    /// <summary>Return the given Core object as the JSON a bridge would put on the wire.</summary>
    private static string Wire(object o) => JsonSerializer.Serialize(o);

    [Fact]
    public async Task Bridge_health_instances_deserializes_into_the_connectors_DetectedProjects()
    {
        // What a TwinCAT bridge returns for one XAE with an open project (identity only — no PLC-app breakdown).
        var health = new HealthResponse
        {
            Projects = new List<ProjectEntry>
            {
                new ProjectEntry("twincat", "17.0", "TwinCAT Project1", "idle", false),
            },
        };

        var wire = new FakeBridgeWire().On("health", Wire(health));
        var src = new PerPipeProjectSource("twincat", "TwinCAT", () => new[] { "volt.bridge.twincat.1" }, _ => wire);

        var projects = (await src.ScanAsync()).Projects;

        var p = Assert.Single(projects);
        Assert.Equal("TwinCAT Project1", p.DisplayName);
        Assert.Equal(new ProjectRef("TwinCAT Project1"), p.Attach);
        Assert.All(projects, p => Assert.Equal("twincat", p.Vendor));
    }

    [Fact]
    public async Task Bridge_CODESYS_single_project_deserializes_to_one_entry()
    {
        var health = new HealthResponse
        {
            Projects = new List<ProjectEntry>
            {
                new ProjectEntry("codesys", "3.5", "MyMachine", "healthy", true),
            },
        };

        var wire = new FakeBridgeWire().On("health", Wire(health));
        var src = new PerPipeProjectSource("codesys", "CODESYS", () => new[] { "volt.bridge.codesys.1" }, _ => wire);

        var p = Assert.Single((await src.ScanAsync()).Projects);
        Assert.Equal("MyMachine", p.DisplayName);
        Assert.True(p.Dirty);
        Assert.Equal(new ProjectRef("MyMachine"), p.Attach);
    }

    [Fact]
    public void Connector_connect_payload_deserializes_into_the_bridges_ConnectRequest()
    {
        // The connector's BindAsync sends { project } (identity is the name); the bridge reads ConnectRequest.
        var connectorBody = JsonSerializer.Serialize(new { project = "TwinCAT Project1" });
        var sel = JsonSerializer.Deserialize<ConnectRequest>(connectorBody, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

        Assert.NotNull(sel);
        Assert.Equal("TwinCAT Project1", sel!.Project);
    }
}
