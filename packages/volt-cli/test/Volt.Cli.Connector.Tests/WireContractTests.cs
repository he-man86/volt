using System.Text.Json;
using Volt.Engine.Wire; // ConnectRequest — the bridge's deserialization target, deliberately NOT moved down
using Xunit;

namespace Volt.Cli.Connector.Tests;

/// <summary>The `connect` body is still declared TWICE: the connector writes an anonymous
/// <c>new { project }</c> (<see cref="PerPipeProjectSource.BindAsync"/>) and the bridge reads it into
/// <see cref="ConnectRequest"/>, which lives in <c>Volt.Engine.Wire</c> — a project the connector deliberately
/// cannot reference. This test is the only pin between them: rename or re-key that field and the tray would bind a
/// key the host ignores, leaving the row marked connected while the bridge serves something else.
/// <para>The health-row half of this file is gone: <c>ProjectEntry</c>/<c>HealthResponse</c> now live in
/// <c>Volt.Cli.Transport.Wire</c>, which both sides reference, so there is one declaration and nothing left to pin.
/// The row-level BEHAVIOUR those tests also carried moved into <c>PerPipeProjectSourceTests</c>.</para></summary>
public class WireContractTests
{
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
