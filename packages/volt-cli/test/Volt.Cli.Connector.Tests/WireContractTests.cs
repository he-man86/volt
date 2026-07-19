using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Volt.Cli.Connector;
using Volt.Cli.Core.Wire;
using Xunit;

namespace Volt.Cli.Connector.Tests;

/// <summary>Proves the two halves of the connection wire agree: the bridge PRODUCES a Core
/// <see cref="InstancesResult"/>, and the connector's <see cref="PipeProjectSource"/> CONSUMES that exact
/// serialized shape into <see cref="DetectedProject"/>s. If either side's field names drift, this fails.</summary>
public class WireContractTests
{
    /// <summary>Return the given Core object as the JSON a bridge would put on the wire.</summary>
    private static string Wire(object o) => JsonSerializer.Serialize(o);

    [Fact]
    public async Task Bridge_InstancesResult_deserializes_into_the_connectors_DetectedProjects()
    {
        // What a TwinCAT bridge would return for one XAE with a solution project holding two PLC projects.
        var bridgeResult = new InstancesResult(new List<IdeInstance>
        {
            new IdeInstance("vs-1", "Visual Studio", "17.0", new List<IdeProject>
            {
                new IdeProject("TwinCAT Project1", Dirty: false, new List<string> { "PLC_A", "PLC_B" }),
            }),
        });

        var wire = new FakeBridgeWire().On("instances", Wire(bridgeResult));
        var src = new PipeProjectSource("twincat", "TwinCAT", wire);

        var projects = await src.EnumerateAsync();

        Assert.Equal(new[] { "PLC_A", "PLC_B" }, projects.Select(p => p.DisplayName));
        Assert.Equal(new ProjectRef("vs-1", "TwinCAT Project1", "PLC_A"), projects[0].Attach);
        Assert.All(projects, p => Assert.Equal("twincat", p.Vendor));
    }

    [Fact]
    public async Task Bridge_CODESYS_single_project_deserializes_to_one_entry()
    {
        var bridgeResult = new InstancesResult(new List<IdeInstance>
        {
            new IdeInstance("codesys", "CODESYS", "3.5", new List<IdeProject>
            {
                new IdeProject("MyMachine", Dirty: true, new List<string>()),
            }),
        });

        var wire = new FakeBridgeWire().On("instances", Wire(bridgeResult));
        var src = new PipeProjectSource("codesys", "CODESYS", wire);

        var p = Assert.Single(await src.EnumerateAsync());
        Assert.Equal("MyMachine", p.DisplayName);
        Assert.True(p.Dirty);
        Assert.Equal(new ProjectRef("codesys", "MyMachine", null), p.Attach);
    }

    [Fact]
    public void Connector_select_payload_deserializes_into_the_bridges_SelectRequest()
    {
        // The connector's BindAsync sends { instanceId, project, plcProject }; the bridge reads SelectRequest.
        var connectorBody = JsonSerializer.Serialize(new { instanceId = "vs-1", project = "TwinCAT Project1", plcProject = "PLC_A" });
        var sel = JsonSerializer.Deserialize<SelectRequest>(connectorBody, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

        Assert.NotNull(sel);
        Assert.Equal("vs-1", sel!.InstanceId);
        Assert.Equal("TwinCAT Project1", sel.Project);
        Assert.Equal("PLC_A", sel.PlcProject);
    }
}
