using System;
using Volt.Engine.Format.Network;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// The name fact TwinCAT gives network scope (openspec <c>bridge-refusal-review</c> D4): a variable's declared type is
/// no function block when TwinCAT refuses that word as a POU's name — its measured list, not a hand copy of IEC types
/// above the seam (<c>NonBlockTypeWords</c>, deleted, which held five words TwinCAT measurably takes).
/// </summary>
public class TcScopeFactsTests
{
    /// <summary>The words both vendors refuse (<see cref="Scopes.BothVendorsRefuse"/>, the engine's
    /// <c>BothVendorsRefusedNames</c> — what the CLI and the engine tests ask) are each one this driver refuses, so no
    /// engine test and no CLI comparison passes on a word TwinCAT takes.</summary>
    [Fact]
    public void Every_word_both_vendors_refuse_is_one_TwinCAT_refuses()
    {
        foreach (var word in Scopes.BothVendorsRefuse)
            Assert.True(BeckhoffDriver.RefusedPouName(word), $"TwinCAT takes '{word}' as a POU name");
    }

    /// <summary>TwinCAT TAKES <c>LDT</c>, <c>LDATE</c>, <c>LTOD</c>, <c>LTIME_OF_DAY</c> and <c>LDATE_AND_TIME</c> as POU
    /// names (<c>tc-refusal-measure-names.log</c>; CODESYS refuses them), so a project or library may hold an FB of that
    /// name and a variable of it is its instance — the build judges it. <c>INT</c> it refuses.</summary>
    [Theory]
    [InlineData("LDT", "LDT")]
    [InlineData("LDATE", "LDATE")]
    [InlineData("LTOD", "LTOD")]
    [InlineData("LTIME_OF_DAY", "LTIME_OF_DAY")]
    [InlineData("LDATE_AND_TIME", "LDATE_AND_TIME")]
    [InlineData("INT", null)]
    public void A_type_TwinCAT_refuses_as_a_POU_name_is_no_instance(string type, string? expected)
    {
        var scope = NetworkScope.FromDeclarations($"PROGRAM P\nVAR\n    x : {type};\nEND_VAR", _ => null,
            () => Array.Empty<string>(), Scopes.NoItem, BeckhoffDriver.RefusedPouName);

        Assert.Equal(expected, scope.InstanceType("x"));
    }
}
