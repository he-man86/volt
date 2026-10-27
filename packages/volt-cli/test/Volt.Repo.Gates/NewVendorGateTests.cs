using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Volt.Repo.Gates;

/// <summary>
/// THE NEW-VENDOR GATE (openspec <c>volt-cli-rework</c> 1.3, design step 2): a vendor outside the CODESYS family is ONE
/// IDE host, so nothing above the <c>Ide/</c> contract may learn a vendor's name — and, because the CODESYS family enters
/// the Engine mostly WITHOUT a name (<c>input/vendor-neutrality.md</c> D), nothing in the contract or in <c>Sync/</c> may
/// speak its numeric kind codes or its NWL network model either. Both assertions, as the design asks.
///
/// <para><b>A ratchet, not a wall.</b> Both are red today by design: the counts below ARE the work list of the rework's
/// steps 3–7, pinned per file at the commit this gate landed on. A file may only go down; the step that removes a site
/// lowers its pin in the same commit, and the gate is done when both tables are empty.</para>
/// </summary>
public class NewVendorGateTests
{
    /// <summary>A vendor's or the CODESYS family's NAME in an identifier or a string the code holds, case as written —
    /// the spellings <c>vendor-neutrality.md</c> D counted (<c>NwlMembers</c>, <c>Vendors.Codesys</c>, <c>"NWL"</c>).
    /// Prose ("the CODESYS build") is upper case and not a symbol; comments are not code.</summary>
    private static readonly Regex VendorSymbol = new(@"\w*(Codesys|Twincat|TwinCat|Beckhoff|Nwl|NWL)\w*",
        RegexOptions.CultureInvariant);

    /// <summary>The projects above the contract: the Engine (its <c>Ide/</c> contract included — it holds none, and must
    /// not start), the Engine's host, the wire's contracts and the CLI.</summary>
    private static readonly string[] AboveTheContract = { "Volt.Engine", "Volt.Engine.Host", "Volt.Contracts", "Volt.Cli" };

    [Fact]
    public void No_vendor_or_NWL_symbol_above_the_Ide_contract_ratchet()
    {
        var actual = new SortedDictionary<string, int>(StringComparer.Ordinal);
        foreach (var project in AboveTheContract)
            foreach (var (file, count) in SourceScan.CountPerFile(SourceScan.Lines(project), VendorSymbol))
                actual[file] = count;

        Ratchet.Hold(
            "A Codesys/Twincat/Beckhoff/Nwl symbol above the Ide/ contract (Volt.Engine, Volt.Engine.Host, Volt.Contracts, Volt.Cli).",
            VendorSymbolPins, actual,
            "A new vendor must be one host: its name, and the CODESYS family's NWL, live below Ide/ — in Volt.Ide.<Vendor>. " +
            "Ask the driver, or move the fact into the host.");
    }

    /// <summary>The CODESYS family's numeric kind codes — the TwinCAT <c>TREEITEMTYPE</c> table and the CODESYS
    /// synthetic container codes behind <c>ItemKind</c>'s int constants, and the <c>KindCode</c> they travel as — and the
    /// NWL network model, inside the contract's interfaces and the Sync services.</summary>
    private static readonly Regex FamilyCode = new(
        @"\bItemKind\.(Plc\w+|Application|PlcLogic|Device|TaskConfig|GenericContainer|Unknown|Skip)\b" +
        @"|\b[Kk]indCode\b" +
        @"|\b(PushedNetworkBody|NetworkBody|NetworkScope|NetworkModel|NwlMembers)\b",
        RegexOptions.CultureInvariant);

    /// <summary>Any contract interface left in <c>Ide/I&lt;Name&gt;.cs</c> (none since volt-cli-rework step 7: the contract is
    /// <c>Seam/</c>, pinned at zero by its own gate) and every Sync service.</summary>
    private static bool ContractOrSync(string rel) =>
        rel.StartsWith("Volt.Engine/Sync/", StringComparison.Ordinal)
        || Regex.IsMatch(rel, @"^Volt\.Engine/Ide/I[A-Z]\w*\.cs$", RegexOptions.CultureInvariant);

    [Fact]
    public void No_family_kind_code_or_NWL_type_in_the_contract_or_Sync_ratchet()
    {
        var actual = SourceScan.CountPerFile(SourceScan.Lines("Volt.Engine", ContractOrSync), FamilyCode);
        Ratchet.Hold(
            "An ItemKind.Plc*/container code, a [Kk]indCode or an NWL network type in Ide/I*.cs or Sync/.",
            FamilyCodePins, actual,
            "The contract speaks vendor-neutral kinds (a registry string) and bodies keyed by language; the codes and the NWL " +
            "model stay below it, in the hosts (design steps 3 and 5).");
    }

    /// <summary>THE NEW CONTRACT HOLDS NONE OF IT (design step 3, "New Ide/ contract"): <c>Volt.Engine/Seam/</c> — the
    /// interfaces, the four registries, the content model — names no vendor and no NWL, and speaks no family kind code, no
    /// <c>KindCode</c> and no NWL network type. An EXACT zero, not a ratchet: the contract is written new, so there is no
    /// debt to pin, and a vendor fact that slips in is a design defect.</summary>
    [Fact]
    public void The_new_contract_names_no_vendor_no_NWL_and_no_family_code()
    {
        var lines = SourceScan.Lines("Volt.Engine", rel => rel.StartsWith("Volt.Engine/Seam/", StringComparison.Ordinal)).ToList();
        Assert.True(lines.Select(l => l.File).Distinct().Count() >= 8, "Volt.Engine/Seam/ holds almost no source — did it move?");

        var hits = lines.Where(l => VendorSymbol.IsMatch(l.Code) || FamilyCode.IsMatch(l.Code))
            .Select(l => $"{l.File}:{l.Line}: {l.Code.Trim()}").ToList();
        Assert.True(hits.Count == 0,
            "The new contract (Volt.Engine/Seam/) must name no vendor, no NWL and no family kind code — the host states its " +
            "kinds, languages and keys through the registries:\n  " + string.Join("\n  ", hits));
    }

    /// <summary>The scan sees the sources it claims to (a gate over moved files passes for the wrong reason).</summary>
    [Fact]
    public void The_scans_read_the_projects()
    {
        foreach (var project in AboveTheContract)
            Assert.True(SourceScan.Lines(project).Select(l => l.File).Distinct().Count() >= 1, $"src/{project} holds almost no source — did it move?");
        Assert.True(SourceScan.Lines("Volt.Engine", ContractOrSync).Select(l => l.File).Distinct().Count() >= 15,
            "Ide/I*.cs + Sync/ hold almost no source — did they move?");
    }

    // ── the pins (2026-10-22, at the commit this gate landed on). Lower a pin in the commit that removes a site. ──

    /// <summary>Baseline: <c>input/vendor-neutrality.md</c> D measured 17 (Engine) + 11 (Contracts) + 5 (Cli) at 62451aa676;
    /// these are the same spellings counted per occurrence at this commit.</summary>
    private static readonly Dictionary<string, int> VendorSymbolPins = new(StringComparer.Ordinal)
    {
        // The NWL-shaped network model (E3): NwlMembers, the "NWL" view word.
        ["Volt.Engine/Format/Network/NetworkDerivation.cs"] = 1,
        ["Volt.Engine/Format/Network/NetworkMembers.cs"] = 13,
        ["Volt.Engine/Format/Network/NetworkModel.cs"] = 1,
        ["Volt.Engine/Format/Network/NetworkText.cs"] = 1,
        ["Volt.Engine/Format/Network/NetworkTextReader.cs"] = 1,
        // openspec network-text-st 1.3: a plain-ST read states the toolbox element an AND/OR is (contact vs drawn box) as
        // the stored OutputParam.Names, in the E3 NWL-shaped member bag — the same debt as NetworkMembers.cs, one new site.
        ["Volt.Engine/Format/Network/StNetworkWriter.cs"] = 2,
    };

    /// <summary>Baseline: <c>input/vendor-neutrality.md</c> C1/C6 (the old contract's <c>int KindCode</c>/<c>kindCode</c>,
    /// <c>PushedNetworkBody</c>/<c>NetworkScope</c>: gone with it in step 7) and the Sync services that branch on codes.</summary>
    private static readonly Dictionary<string, int> FamilyCodePins = new(StringComparer.Ordinal)
    {
        ["Volt.Engine/Sync/PushedText.cs"] = 1,
    };
}
