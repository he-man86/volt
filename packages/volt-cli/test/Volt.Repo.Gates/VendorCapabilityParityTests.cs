using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Volt.Repo.Gates;

/// <summary>
/// BOTH VENDORS DO THE SAME THINGS — and where they do not, the build says so out loud.
///
/// <para><b>The repo already gates parity of SHAPE and had nothing for parity of CAPABILITY.</b>
/// <c>VendorParityGuardTests</c> forbids a vendor literal in the engine, <c>EndpointParityTests</c> holds
/// /refs, /fetch and the push receipt to one version map, and the e2e <c>vendor-parity</c> suite drives BOTH
/// bridges and compares what they serve. Not one of them would have failed on the change that prompted this:
/// making `.task` writable on CODESYS alone. A workspace file that is editable on one vendor and read-only on
/// the other passed every gate, because every gate was asking whether the two AGREE about an item, never
/// whether they can both DO the same thing to it.</para>
///
/// <para><b>Why that gap is the bad kind.</b> `docs/ITEM_KINDS.md` already lists eighteen vendor-exclusive
/// rows and they are fine: they say a KIND does not exist on that vendor (TwinCAT has parameter lists, CODESYS
/// has traces), so nothing appears in the workspace and there is nothing to be surprised by. A capability gap
/// is the opposite — the same file, in both workspaces, behaving differently — and it is invisible until an
/// engineer edits one and pushes.</para>
///
/// <para><b>So the table below is the declaration, and this gate is what makes it true.</b> Adding a kind to
/// <c>ItemKind.WritableReferenceKinds</c> without a row here fails the build; a row claiming a vendor supports
/// a write while its driver still refuses fails too. The day TwinCAT's task write lands, this test fails and
/// forces the row updated — which is the point: the gap cannot rot quietly, and closing it cannot go
/// unrecorded.</para>
/// </summary>
public class VendorCapabilityParityTests
{
    /// <summary>Which vendors implement the WRITE for each writable non-source kind.
    ///
    /// <para>Source kinds (POUs, DUTs, GVLs, interfaces) are deliberately absent: both drivers have always
    /// written those, and a gap there would break far louder than a gate. This table is for the descriptor
    /// kinds, where writability is a choice each driver makes.</para></summary>
    private static readonly IReadOnlyDictionary<string, VendorSupport> Writable =
        new Dictionary<string, VendorSupport>(StringComparer.Ordinal)
        {
            // A task's schedule is writable on BOTH, by routes that share nothing below the format: CODESYS
            // sets live properties on `ScriptTaskObject` (DIALECT C19), TwinCAT patches the SYSTEM task its PLC
            // task links to and rebuilds the call children (C19b). This row was one-sided for a day, which is
            // what the gate is for — it made closing the gap a build failure rather than a nice-to-have.
            ["task"] = new(Codesys: true, Twincat: true,
                           Why: "both vendors write a task's schedule and call list (DIALECT C19, C19b)"),
        };

    private sealed record VendorSupport(bool Codesys, bool Twincat, string Why);

    /// <summary>Every writable reference kind is DECLARED above. A new one cannot arrive unnoticed.</summary>
    [Fact]
    public void Every_writable_reference_kind_declares_its_vendor_support()
    {
        var declared = ReadWritableReferenceKinds();
        var missing = declared.Where(k => !Writable.ContainsKey(k)).ToList();
        Assert.True(missing.Count == 0,
            $"ItemKind.WritableReferenceKinds gained {string.Join(", ", missing)} with no row in this table. " +
            "A kind a push can write is a capability, and a capability that exists on one vendor only is the " +
            "kind of gap this gate exists to keep visible — add the row (and say why, if it is one-sided).");

        var stale = Writable.Keys.Where(k => !declared.Contains(k)).ToList();
        Assert.True(stale.Count == 0,
            $"this table declares {string.Join(", ", stale)}, which ItemKind no longer calls writable — " +
            "remove the row so the table keeps describing the code.");
    }

    /// <summary>A one-sided capability must be VISIBLE where a reader would look: the kind table names it, and
    /// the refusing driver says why in the refusal itself.
    ///
    /// <para><b>The check is a method, not a loop body, because the loop can legitimately be EMPTY.</b> On
    /// 2026-09-05 `task` went two-sided, every row became symmetric, and this test plus the doc test below went
    /// on passing having executed no assertion at all — the precise "a gate that matches nothing still passes"
    /// failure this file was written to prevent, reproduced inside the file itself. <see
    /// cref="The_one_sided_checks_can_themselves_fail"/> now exercises the logic against a synthetic row, so it
    /// stays honest no matter what the live table holds.</para></summary>
    [Fact]
    public void A_one_sided_capability_is_recorded_where_a_reader_looks()
    {
        foreach (var (kind, support) in OneSided()) AssertRefusalIsVisible(kind, support);
    }

    /// <summary>The one-sided rows, if any. Empty is a legitimate state — it means both vendors do everything.</summary>
    private static IEnumerable<KeyValuePair<string, VendorSupport>> OneSided() =>
        Writable.Where(x => x.Value.Codesys != x.Value.Twincat);

    /// <summary>A one-sided row states its reason, and the driver that lacks the capability REFUSES rather than
    /// silently accepting and doing nothing — the failure mode a capability gap actually produces in the field.</summary>
    private static void AssertRefusalIsVisible(string kind, VendorSupport support)
    {
        Assert.False(string.IsNullOrWhiteSpace(support.Why),
            $"'{kind}' is writable on one vendor only and the table gives no reason.");

        var refusing = support.Codesys ? TwincatDriverDir() : CodesysDriverDir();
        var vendorName = support.Codesys ? "TwinCAT" : "CODESYS";
        var sources = string.Join("\n", Directory.EnumerateFiles(refusing, "*.cs", SearchOption.AllDirectories)
            .Where(NotBuildOutput).Select(File.ReadAllText));
        Assert.True(Regex.IsMatch(sources, @"BridgeErrorCodes\.Unsupported"),
            $"'{kind}' is not supported on {vendorName}, but nothing in its driver refuses with " +
            "BridgeErrorCodes.Unsupported — a capability the driver neither implements nor refuses is one " +
            "that fails somewhere the user cannot read.");
    }

    /// <summary>The one-sided checks can FAIL — proven against synthetic rows, so they keep their teeth on the
    /// days the real table has no asymmetric row to feed them.</summary>
    [Fact]
    public void The_one_sided_checks_can_themselves_fail()
    {
        // A one-sided row with no stated reason is refused.
        Assert.ThrowsAny<Exception>(() =>
            AssertRefusalIsVisible("synthetic", new VendorSupport(Codesys: true, Twincat: false, Why: "   ")));

        // A kind the docs do not mention is refused.
        Assert.ThrowsAny<Exception>(() => AssertKindIsDocumented("a-kind-no-doc-will-ever-name"));

        // ...and the same checks PASS for a well-formed row, so they are not simply always-throwing.
        AssertRefusalIsVisible("synthetic", new VendorSupport(Codesys: true, Twincat: false, Why: "measured; see DIALECT"));
        AssertKindIsDocumented("task");
    }

    /// <summary>A vendor this table says CAN write a kind must actually write it — its driver's `Write&lt;Kind&gt;`
    /// may not be a bare refusal.
    ///
    /// <para>This gate's own summary promised exactly this ("a row claiming a vendor supports a write while its
    /// driver still refuses fails too") and did not enforce it, which mattered the moment a row went two-sided:
    /// every other test here only inspects the REFUSING side, so flipping a flag to `true` was enough to make the
    /// whole file agree that a gap was closed. A claim nothing checks is worse than no claim, because it reads
    /// like one that is checked.</para></summary>
    [Fact]
    public void A_vendor_declared_able_to_write_a_kind_does_not_refuse_it()
    {
        foreach (var (kind, support) in Writable)
        foreach (var (vendor, dir, supported) in new[]
                 {
                     ("CODESYS", CodesysDriverDir(), support.Codesys),
                     ("TwinCAT", TwincatDriverDir(), support.Twincat),
                 })
        {
            if (!supported) continue;
            var method = "Write" + char.ToUpperInvariant(kind[0]) + kind.Substring(1);   // task -> WriteTask
            var body = MethodBody(dir, method)
                ?? throw new Xunit.Sdk.XunitException(
                    $"this table says {vendor} can write '{kind}', but no `{method}(` exists in its driver.");
            Assert.False(body.Contains("BridgeErrorCodes.Unsupported", StringComparison.Ordinal),
                $"this table says {vendor} can write '{kind}', but its `{method}` still refuses with " +
                "BridgeErrorCodes.Unsupported. Flip the row back, or finish the driver.");
        }
    }

    /// <summary>The text of the first `public void &lt;name&gt;(...)` in a driver, up to the end of its
    /// statement — enough to tell an implementation from a refusal, without parsing C#. An expression-bodied
    /// member ends at its `;`, a block member at the first line that closes at method indentation.
    ///
    /// <para>Scoped to the vendor's `Driver/` directory ON PURPOSE. That is where each vendor's
    /// <c>ICodeStore</c>/<c>IProjectTree</c> facets live — the methods the ENGINE actually calls — and it is the
    /// only place a refusal reaches a user. The object models beside them (<c>TcObjectModel</c>,
    /// <c>CodesysObjectModel</c>) carry same-named helpers that legitimately raise Unsupported for a vendor that
    /// declined a write at runtime, and letting the scan reach those would make this gate's verdict depend on
    /// file enumeration order.</para></summary>
    private static string? MethodBody(string vendorDir, string name)
    {
        var driverDir = Path.Combine(vendorDir, "Driver");
        Assert.True(Directory.Exists(driverDir), $"no Driver/ directory under {vendorDir}");
        foreach (var file in Directory.EnumerateFiles(driverDir, "*.cs", SearchOption.AllDirectories).Where(NotBuildOutput))
        {
            var text = File.ReadAllText(file);
            var at = text.IndexOf($"public void {name}(", StringComparison.Ordinal);
            if (at < 0) continue;
            var arrow = text.IndexOf("=>", at, StringComparison.Ordinal);
            var brace = text.IndexOf('{', at);
            // Expression-bodied: everything to the `;`. Block-bodied: to the closing brace at method indent.
            if (arrow >= 0 && (brace < 0 || arrow < brace))
                return text.Substring(at, text.IndexOf(';', arrow) - at + 1);
            var end = text.IndexOf("\n    }", brace, StringComparison.Ordinal);
            return end < 0 ? text.Substring(at) : text.Substring(at, end - at);
        }
        return null;
    }

    /// <summary>The one-sided kinds are named in `docs/ITEM_KINDS.md`, which is where someone asking "can I edit
    /// this file?" actually looks — the gate keeps the prose honest rather than replacing it.</summary>
    [Fact]
    public void The_kind_table_documents_every_one_sided_capability()
    {
        foreach (var (kind, _) in OneSided()) AssertKindIsDocumented(kind);
    }

    private static void AssertKindIsDocumented(string kind)
    {
        var doc = File.ReadAllText(Path.Combine(RepoRoot(), "packages", "volt-cli", "docs", "ITEM_KINDS.md"));
        Assert.True(doc.Contains($"`{kind}`", StringComparison.Ordinal),
            $"docs/ITEM_KINDS.md does not mention the '{kind}' kind, whose write support differs per vendor.");
    }

    // ── reading the declaration out of the engine ────────────────────────────────────────────────────────

    /// <summary>The kinds `ItemKind.WritableReferenceKinds` lists, read from source. This gate holds no project
    /// reference (it gates the REPO), so the declaration is read the way the sibling gates read theirs.</summary>
    private static IReadOnlyCollection<string> ReadWritableReferenceKinds()
    {
        var itemKind = File.ReadAllText(Path.Combine(
            RepoRoot(), "packages", "volt-cli", "src", "Volt.Engine", "Item", "ItemKind.cs"));

        var decl = Regex.Match(itemKind, @"WritableReferenceKinds\s*=\s*new\[\]\s*\{([^}]*)\}");
        Assert.True(decl.Success,
            "could not find `WritableReferenceKinds = new[] { … }` in ItemKind.cs — this gate reads it as text, " +
            "so a change to its shape has to be reflected here.");

        // `Kinds.Task` → the kind's own string constant, which is the extension-shaped lowercase name.
        var kinds = Regex.Matches(decl.Groups[1].Value, @"Kinds\.(\w+)").Select(m => m.Groups[1].Value).ToList();
        Assert.NotEmpty(kinds);
        return kinds.Select(k => KindConstantValue(itemKind, k)).ToList();
    }

    /// <summary>`Kinds.Task` → "task": the literal the constant is declared with, so the table is keyed by the
    /// name that appears on the wire and in the workspace rather than by a C# identifier.</summary>
    private static string KindConstantValue(string itemKindSource, string constant)
    {
        var m = Regex.Match(itemKindSource, $@"\b{Regex.Escape(constant)}\s*=\s*""([^""]+)""");
        Assert.True(m.Success, $"ItemKind.Kinds.{constant} has no string literal this gate could read");
        return m.Groups[1].Value;
    }

    /// <summary>A BODY NEITHER VENDOR CAN REPRESENT MUST BECOME A MARKER ON BOTH — never a missing POU.
    ///
    /// <para>A reader that cannot represent a body throws <c>UnrepresentableBodyException</c>. Unguarded, that
    /// throw reaches <c>Versioning.SafeVersion</c>, which isolates it by stamping the item UNREADABLE, and
    /// <c>FetchService</c> then drops the POU from <c>changed</c>, <c>items</c> AND <c>folders</c> — so the
    /// engineer's file disappears from the workspace and from git on every pull, declaration and every sibling
    /// method with it, leaving only a count in an "N unreadable" tally.</para>
    ///
    /// <para><b>This was one-sided and nothing could see it.</b> TwinCAT pre-empted the refusal with an archive
    /// pre-scan and returned the marker; CODESYS reads LIVE objects, has no equivalent pre-scan, and let the
    /// throw out. The same Execute box therefore gave a TwinCAT engineer a POU that says what it holds and a
    /// CODESYS engineer no POU at all — two different answers to one body, which is exactly what the
    /// byte-identical-response rule forbids. Found by the vendor differential map, 2026-09-22.</para>
    ///
    /// <para>The gate is structural on purpose. The CODESYS driver arm needs LIVE vendor objects to exercise,
    /// so no offline test can reach it; what CAN be held is that neither driver ever stops answering.</para>
    /// </summary>
    [Theory]
    [InlineData("Volt.Ide.Codesys")]
    [InlineData("Volt.Ide.Twincat")]
    public void Every_driver_answers_an_unrepresentable_body_with_a_marker(string vendor)
        {
        var dir = Path.Combine(RepoRoot(), "packages", "volt-cli", "src", vendor);
        var driver = Directory.EnumerateFiles(dir, "*.cs", SearchOption.AllDirectories)
            .Where(NotBuildOutput)
            .Select(File.ReadAllText)
            .ToList();

        Assert.True(
            driver.Any(t => t.Contains("catch (UnrepresentableBodyException")),
            vendor + " never catches UnrepresentableBodyException, so a body its reader cannot represent " +
            "removes the whole POU from the workspace and from git instead of materializing as a marker. " +
            "Catch it where the body is read and return BodyMarker.For(ex.Marker).");
        }

    private static bool NotBuildOutput(string file) =>
        !file.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}") &&
        !file.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}");

    private static string TwincatDriverDir() =>
        Path.Combine(RepoRoot(), "packages", "volt-cli", "src", "Volt.Ide.Twincat");

    private static string CodesysDriverDir() =>
        Path.Combine(RepoRoot(), "packages", "volt-cli", "src", "Volt.Ide.Codesys");

    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !File.Exists(Path.Combine(dir.FullName, "packages", "volt-cli", "Volt.sln")))
            dir = dir.Parent;
        Assert.NotNull(dir);
        return dir!.FullName;
    }
}
