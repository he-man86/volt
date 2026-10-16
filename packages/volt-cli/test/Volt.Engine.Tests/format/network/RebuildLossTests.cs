using System.Linq;
using Volt.Engine.Format.Network;
using Xunit;
using Held = Volt.Engine.Format.Network.RebuildLoss.Held;

namespace Volt.Engine.Tests;

/// <summary>
/// openspec <c>ld-fbd-coverage</c> 2.2, design "The interim loss window, made visible": a rebuilt network that does not
/// hold a value the live network stored, of a member the text does not carry, is named in one warning, with each member
/// and its count; a network whose rebuild gives every stored value back is silent. Measured against the REBUILT network,
/// owner by owner (gate 2-2): the fresh value is the vendor's — TwinCAT's import answers <c>Fixed = true</c> on every
/// operand and <c>false</c> on every item — so no one "default" may stand for it. The decision is the engine's, so both
/// drivers count alike.
/// </summary>
public class RebuildLossTests
{
    static Held Op(string member, string? value) => new(member, "Operand", value);
    static Held Box(string member, string? value) => new(member, "BoxTreeBox", value);

    [Fact]
    public void Each_candidate_is_counted_by_the_stored_values_the_rebuilt_network_does_not_hold()
    {
        var held = new[]
        {
            Op("Flags.Fixed", "true"), Op("Flags.Fixed", "false"), Box("Flags.Fixed", "true"),
            Op("Operand.Boolean", "true"), Op("Operand.Boolean", "false"),
            Op("Operand.Address", RebuildLoss.AddressSentinel), Op("Operand.Address", ""),
            // Not a candidate, not counted: the Id is an IDE allocator (vendor-facts nwl-item-id, DIALECT N29).
            Op("Id", "7"),
        };
        var rebuilt = new[]
        {
            Op("Flags.Fixed", "true"), Op("Flags.Fixed", "false"), Box("Flags.Fixed", "false"),
            Op("Operand.Boolean", "false"), Op("Operand.Boolean", "false"),
            Op("Operand.Address", ""), Op("Operand.Address", ""),
            Op("Id", "2"),
        };

        var counts = RebuildLoss.Count(held, rebuilt).ToDictionary(x => x.Candidate.Member, x => x.Count);

        Assert.Equal(1, counts["Flags.Fixed"]);
        Assert.Equal(1, counts["Operand.Boolean"]);
        Assert.Equal(1, counts["Operand.Address"]);
        Assert.Equal(3, counts.Count);
    }

    /// <summary>2R.3 B7 (design "2R.3, as built"; 2R.2 Open item 5): the text carries no member, so every value design
    /// 2R.2 files as L — a call's stored output list and its types (a TON's unwired <c>ET</c>), a bit operator's stored
    /// slot <c>['']</c>, a box type's stored spelling, <c>Instance.Type</c>, <c>Operand.Type</c>, the <c>EN</c>/<c>ENO</c>
    /// bools, the input names and types, <c>CallType</c>, <c>InputFlags</c> — is LOST ON REBUILD, "named by
    /// <c>RebuildLoss</c>, never guessed". Each is counted like the 2.2 window's members; a value the rebuild gives back
    /// (the input names the text spells) is not.</summary>
    [Fact]
    public void Every_member_the_text_does_not_carry_is_named_when_the_rebuild_does_not_hold_it()
    {
        var held = new[]
        {
            Box("OutputParam.Names", RebuildLoss.List(new[] { "Q", "ET" })),
            Box("OutputParam.Types", RebuildLoss.List(new[] { "BOOL", "TIME" })),
            Box("OutputParam.Names", RebuildLoss.List(new[] { "" })),
            Box("InputParam.Names", RebuildLoss.List(new[] { "IN", "PT" })),
            Box("InputParam.Types", RebuildLoss.List(new[] { "BOOL", "TIME" })),
            Box("BoxType", "ton"), Box("Instance.Type", "TON"), Op("Operand.Type", "BOOL"),
            Box("EN", "false"), Box("ENO", "false"), Box("CallType", "FunctionBlock"), Box("InputFlags", "2 sets"),
        };
        var rebuilt = new[]
        {
            Box("OutputParam.Names", RebuildLoss.List(new[] { "Q" })),
            Box("OutputParam.Types", RebuildLoss.List(new[] { "" })),
            Box("OutputParam.Names", RebuildLoss.List(System.Array.Empty<string>())),
            Box("InputParam.Names", RebuildLoss.List(new[] { "IN", "PT" })),
            Box("InputParam.Types", RebuildLoss.List(new[] { "", "" })),
            Box("BoxType", "TON"), Box("Instance.Type", ""), Op("Operand.Type", ""),
            Box("EN", null), Box("ENO", null), Box("CallType", "None"), Box("InputFlags", null),
        };

        var counts = RebuildLoss.Count(held, rebuilt).ToDictionary(x => x.Candidate.Member, x => x.Count);

        Assert.Equal(2, counts["OutputParam.Names"]);
        Assert.Equal(1, counts["OutputParam.Types"]);
        Assert.Equal(1, counts["InputParam.Types"]);
        Assert.False(counts.ContainsKey("InputParam.Names"));
        foreach (var m in new[] { "BoxType", "Instance.Type", "Operand.Type", "EN", "ENO", "CallType", "InputFlags" })
            Assert.Equal(1, counts[m]);
        var w = RebuildLoss.Warning("CODESYS", 0, held, rebuilt)!;
        Assert.Contains("OutputParam.Names ×2 (vendor-facts row nwl-output-param-names)", w);
        Assert.Contains("OutputParam.Types ×1 (vendor-facts row nwl-param-types)", w);
        Assert.Contains("EN ×1 (vendor-facts row nwl-box-en-eno)", w);
        Assert.Contains("BoxType ×1 (no vendor-facts row yet; design 2R.2 L)", w);
    }

    /// <summary>A list's notation tells the empty list, a list of one empty name and no list at all apart.</summary>
    [Fact]
    public void A_list_notation_keeps_empty_and_absent_apart()
    {
        Assert.Equal("[]", RebuildLoss.List(System.Array.Empty<string>()));
        Assert.Equal("['']", RebuildLoss.List(new[] { "" }));
        Assert.Equal("['Q', 'ET']", RebuildLoss.List(new[] { "Q", "ET" }));
        Assert.Null(RebuildLoss.List(null));
    }

    /// <summary>The TwinCAT import's answer (vendor-facts nwl-flags-fixed, nwl@built): <c>Fixed = true</c> on every
    /// operand. A stored <c>true</c> it gives back is no loss; a stored <c>false</c> it turns <c>true</c> is one.</summary>
    [Fact]
    public void A_value_the_rebuild_gives_back_is_no_loss_and_one_it_changes_is()
    {
        Assert.Null(RebuildLoss.Warning("TwinCAT", 0,
            new[] { Op("Flags.Fixed", "true"), Op("Flags.Fixed", "true") },
            new[] { Op("Flags.Fixed", "true"), Op("Flags.Fixed", "true") }));

        var w = RebuildLoss.Warning("TwinCAT", 0,
            new[] { Op("Flags.Fixed", "false"), Op("Flags.Fixed", "true") },
            new[] { Op("Flags.Fixed", "true"), Op("Flags.Fixed", "true") });
        Assert.NotNull(w);
        Assert.Contains("Flags.Fixed ×1 (vendor-facts row nwl-flags-fixed)", w);
    }

    /// <summary>An operand's <c>true</c> does not stand in for a box's: the owner is part of what is given back — or an
    /// import that adds an operand would hide a box flag it reset.</summary>
    [Fact]
    public void A_value_given_back_on_another_owner_is_still_a_loss()
    {
        var w = RebuildLoss.Warning("TwinCAT", 0,
            new[] { Box("Flags.Fixed", "true"), Op("Flags.Fixed", "true") },
            new[] { Box("Flags.Fixed", "false"), Op("Flags.Fixed", "true"), Op("Flags.Fixed", "true") });
        Assert.NotNull(w);
        Assert.Contains("Flags.Fixed ×1 (vendor-facts row nwl-flags-fixed)", w);
    }

    [Fact]
    public void The_warning_names_the_network_each_member_its_count_and_its_row()
    {
        var w = RebuildLoss.Warning("CODESYS", 2,
            new[] { Box("Flags.Fixed", "true"), Op("Operand.Boolean", "true"), Op("Operand.Boolean", "true") },
            new[] { Box("Flags.Fixed", "false"), Op("Operand.Boolean", "false"), Op("Operand.Boolean", "false") });

        Assert.NotNull(w);
        Assert.StartsWith("CODESYS: network 3 is rebuilt from its text", w);
        Assert.Contains("Flags.Fixed ×1 (vendor-facts row nwl-flags-fixed)", w);
        Assert.Contains("Operand.Boolean ×2 (vendor-facts row nwl-operand-boolean)", w);
        Assert.DoesNotContain("Address", w);
    }

    [Fact]
    public void A_network_whose_rebuild_holds_every_stored_value_is_silent()
    {
        var same = new[] { Op("Flags.Fixed", "false"), Op("Operand.Boolean", "false"), Op("Operand.Address", ""), Op("Id", "12") };
        Assert.Null(RebuildLoss.Warning("TwinCAT", 0, same, same.Select(h => h.Member == "Id" ? h with { Value = "3" } : h)));
    }
}
