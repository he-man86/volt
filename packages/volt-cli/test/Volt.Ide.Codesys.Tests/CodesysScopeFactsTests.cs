using System;
using Volt.Engine.Format.Network;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Ide.Codesys.Tests;

/// <summary>
/// The name fact CODESYS gives network scope (openspec <c>bridge-refusal-review</c> D4): a variable's declared type is
/// no function block when CODESYS refuses that word as a POU's name — its measured list, not a hand copy of IEC types
/// above the seam (<c>NonBlockTypeWords</c>, deleted).
/// </summary>
public class CodesysScopeFactsTests
{
    /// <summary>The words both vendors refuse (<see cref="Scopes.BothVendorsRefuse"/>, the engine's
    /// <c>BothVendorsRefusedNames</c> — what the CLI and the engine tests ask) are each one this driver refuses, so no
    /// engine test and no CLI comparison passes on a word CODESYS takes.</summary>
    [Fact]
    public void Every_word_both_vendors_refuse_is_one_CODESYS_refuses()
    {
        foreach (var word in Scopes.BothVendorsRefuse)
            Assert.True(CodesysDriver.RefusedPouName(word), $"CODESYS takes '{word}' as a POU name");
    }

    /// <summary>CODESYS refuses <c>LDT</c> as a POU name (TwinCAT takes it), so on CODESYS a variable typed <c>LDT</c>
    /// is no instance: <c>x(…)</c> is a call of that name, as the LSP reads it. <c>WCHAR</c> CODESYS takes (it is no
    /// type on SP21, <c>cc5_reserved_keyword_names</c>), so a variable of it is an instance of the FB a project may
    /// name so — the build judges it.</summary>
    [Theory]
    [InlineData("LDT", null)]
    [InlineData("LDATE_AND_TIME", null)]
    [InlineData("INT", null)]
    [InlineData("WCHAR", "WCHAR")]
    [InlineData("TON", "TON")]
    public void A_type_CODESYS_refuses_as_a_POU_name_is_no_instance(string type, string? expected)
    {
        var scope = NetworkScope.FromDeclarations($"PROGRAM P\nVAR\n    x : {type};\nEND_VAR", _ => null,
            () => Array.Empty<string>(), Scopes.NoItem, CodesysDriver.RefusedPouName);

        Assert.Equal(expected, scope.InstanceType("x"));
    }
}
