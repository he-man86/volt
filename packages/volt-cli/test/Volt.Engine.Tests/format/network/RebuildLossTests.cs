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
            // Not candidates, not counted: the Id is an IDE allocator (vendor-facts nwl-item-id, DIALECT N29), the Type
            // an R member a rebuild drops but no loss candidate of the design's window.
            Op("Id", "7"), Op("Operand.Type", "BOOL"),
        };
        var rebuilt = new[]
        {
            Op("Flags.Fixed", "true"), Op("Flags.Fixed", "false"), Box("Flags.Fixed", "false"),
            Op("Operand.Boolean", "false"), Op("Operand.Boolean", "false"),
            Op("Operand.Address", ""), Op("Operand.Address", ""),
            Op("Id", "2"), Op("Operand.Type", ""),
        };

        var counts = RebuildLoss.Count(held, rebuilt).ToDictionary(x => x.Candidate.Member, x => x.Count);

        Assert.Equal(1, counts["Flags.Fixed"]);
        Assert.Equal(1, counts["Operand.Boolean"]);
        Assert.Equal(1, counts["Operand.Address"]);
        Assert.Equal(3, counts.Count);
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
