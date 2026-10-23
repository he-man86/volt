using System.Text.Json;
using Volt.Contracts;
using Xunit;

namespace Volt.Contracts.Tests;

/// <summary>
/// A NULL WHERE THE SCHEMA TAKES A VALUE IS THE REQUEST'S ERROR (volt-cli-rework 2.4, the public-API lens). The strict
/// request reader (<see cref="WireJson.Request"/>) refuses it, as it refuses a member the type does not have: a push op
/// whose <c>name</c> is null, an <c>ops</c> list holding a null, a grep <c>paths</c> entry that is null. Read leniently,
/// each reached the engine as a null and the client was answered INTERNAL_ERROR — a request answered as a Volt bug — or,
/// for the read ops, answered as if the entry were absent. A member the wire marks optional (<c>ifVersion</c>, <c>to</c>,
/// <c>project</c>) stays nullable: null there is absent.
/// </summary>
public class RequestNullTests
{
    [Theory]
    [InlineData(typeof(PushRequest), @"{""ops"":[null]}", "ops")]
    [InlineData(typeof(PushRequest), @"{""ops"":[{""op"":""set"",""name"":null}]}", "name")]
    [InlineData(typeof(PushRequest), @"{""ops"":[{""op"":""deleteItem"",""name"":null}]}", "name")]
    [InlineData(typeof(PushRequest), @"{""ops"":null}", "ops")]
    [InlineData(typeof(GrepRequest), @"{""pattern"":""x"",""paths"":[null]}", "paths")]
    [InlineData(typeof(GrepRequest), @"{""pattern"":null}", "pattern")]
    [InlineData(typeof(FetchRequest), @"{""knownItems"":{},""onlyItems"":[null]}", "onlyItems")]
    [InlineData(typeof(FetchRequest), @"{""knownItems"":{""A/X.pou"":null}}", "knownItems")]
    [InlineData(typeof(FetchRequest), @"{""knownItems"":{},""knownApplications"":[null]}", "knownApplications")]
    [InlineData(typeof(RefsRequest), @"{""knownItems"":{""A/X.pou"":null}}", "knownItems")]
    [InlineData(typeof(RefsRequest), @"{""knownApplications"":[null]}", "knownApplications")]
    [InlineData(typeof(BuildRequest), @"{""applications"":[null]}", "applications")]
    public void A_null_where_the_wire_takes_a_value_is_refused_naming_the_member(System.Type type, string body, string member)
    {
        var ex = Assert.Throws<JsonException>(() => JsonSerializer.Deserialize(body, type, WireJson.Request));
        Assert.Contains(member, ex.Message + " " + ex.Path);
    }

    /// <summary>A refusal inside a list entry names the ENTRY: the op that broke the rule is found from the message. Reading
    /// each entry with a nested deserialize started a fresh path at the entry, so <c>$.ops[1].bogus</c> was reported as
    /// <c>$.bogus</c> (volt-cli-rework 2.4 gate).</summary>
    [Theory]
    [InlineData(@"{""ops"":[{""op"":""set"",""name"":""A/X.pou""},{""op"":""set"",""name"":""A/Y.pou"",""bogus"":1}]}", "$.ops[1].bogus")]
    [InlineData(@"{""ops"":[{""op"":""set"",""name"":""A/X.pou""},{""op"":""set"",""name"":null}]}", "$.ops[1].name")]
    [InlineData(@"{""ops"":[{""op"":""set"",""name"":""A/X.pou""},null]}", "`ops[1]`")]   // at $.ops: the member that holds it
    public void A_refusal_inside_a_list_entry_names_the_entry(string body, string path)
    {
        var ex = Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<PushRequest>(body, WireJson.Request));
        Assert.Contains(path, ex.Message + " (at " + ex.Path + ")");
    }

    [Theory]
    [InlineData(typeof(PushRequest), @"{""ops"":[{""op"":""set"",""name"":""A/X.pou"",""ifVersion"":null,""to"":null,""sourceText"":null}],""expectedProjectVersion"":null}")]
    [InlineData(typeof(ConnectRequest), @"{""project"":null}")]
    [InlineData(typeof(FetchRequest), @"{""knownItems"":null,""onlyItems"":null,""expectedPlatform"":null}")]
    [InlineData(typeof(GrepRequest), @"{""pattern"":""x"",""paths"":null,""limit"":null}")]
    [InlineData(typeof(BuildRequest), @"{""applications"":null}")]
    public void A_null_for_an_optional_member_is_that_member_absent(System.Type type, string body) =>
        Assert.NotNull(JsonSerializer.Deserialize(body, type, WireJson.Request));
}
