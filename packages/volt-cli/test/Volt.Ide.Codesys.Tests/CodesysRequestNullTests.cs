using System.Text.Json;
using Volt.Contracts;
using Xunit;

namespace Volt.Ide.Codesys.Tests;

/// <summary>
/// The strict request reader refuses a null the schema does not allow ON THE RUNTIME THE CODESYS HOST RUNS — .NET
/// Framework, where the serializer reads nullability through its own shim (volt-cli-rework 2.4; the cases themselves are
/// <c>Volt.Contracts.Tests.RequestNullTests</c>). Without this the in-proc bridge could answer a null op name as a Volt
/// bug while the TwinCAT worker refuses it.
/// </summary>
public class CodesysRequestNullTests
{
    [Theory]
    [InlineData(typeof(PushRequest), @"{""ops"":[null]}")]
    [InlineData(typeof(PushRequest), @"{""ops"":[{""op"":""set"",""name"":null}]}")]
    [InlineData(typeof(GrepRequest), @"{""pattern"":""x"",""paths"":[null]}")]
    [InlineData(typeof(FetchRequest), @"{""knownItems"":{""A/X.pou"":null}}")]
    public void A_null_where_the_wire_takes_a_value_is_refused(System.Type type, string body) =>
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize(body, type, WireJson.Request));

    [Fact]
    public void A_null_for_an_optional_member_is_that_member_absent()
    {
        var push = (PushRequest)JsonSerializer.Deserialize(
            @"{""ops"":[{""op"":""set"",""name"":""A/X.pou"",""ifVersion"":null}]}", typeof(PushRequest), WireJson.Request)!;
        Assert.Null(Assert.Single(push.Ops).IfVersion);
    }
}
