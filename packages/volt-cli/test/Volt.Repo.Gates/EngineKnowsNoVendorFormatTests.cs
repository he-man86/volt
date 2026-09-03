using System;
using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;
using Xunit;

namespace Volt.Repo.Gates;

/// <summary>
/// THE ENGINE DOES NOT KNOW WHAT PLCOPEN IS — a gate, not a convention.
///
/// <para>`pou-transport-per-vendor` §2.2 and §3.3 asked for this and it was the last thing that change was
/// waiting on. The architecture it argued for shipped: <c>ICodeStore</c> speaks <c>ItemContent</c>, each driver
/// reaches its own vendor's form BELOW the seam, and the engine's PLCopen layer is gone. What was missing is the
/// thing that keeps it gone.</para>
///
/// <para><b>Why a gate rather than a note.</b> The engine held a PLCopen layer for most of this project's life,
/// and every data-loss bug the bridge has had lived at that seam — a read-only graphical child flattened, a body
/// spliced into the wrong element, an accessor created as a function block named "Get". Reintroducing it would
/// not look like a mistake while it was happening: it looks like one shared implementation replacing two, which
/// is the argument that put it there the first time. A convention loses that argument. A failing build does not.</para>
///
/// <para>The vendor's own format names are the tell: PLCopen's TC6 namespace and its <c>addData</c> wrapper,
/// Beckhoff's <c>TcPOU</c> archive, CODESYS's <c>NWL</c> object model. Volt's OWN graphical intermediate —
/// network text, <c>NetworkBody</c> — stays in the engine deliberately; it is Volt's format, not a vendor's,
/// and it is what the seam exists to produce.</para>
///
/// <para>Comments are exempt, as in the sibling vendor-parity guard: the engine legitimately EXPLAINS what each
/// vendor does with the neutral model it is handed, and a doc-comment that names PLCopen while describing why
/// the engine no longer carries it is the opposite of the drift this catches.</para>
/// </summary>
public class EngineKnowsNoVendorFormatTests
{
    /// <summary>A vendor's serialization vocabulary. Not an exhaustive list of every possible token — the
    /// specific names that reappear whenever a vendor format is being handled rather than described.</summary>
    private static readonly Regex VendorFormat = new(
        @"\b(PlcOpen|plcopenxml|tc6_020\d|TcPlcObject|addData|NWLObject|InterfaceAsPlainText)\b",
        RegexOptions.IgnoreCase);

    [Fact]
    public void The_engine_carries_no_vendor_serialization_vocabulary()
    {
        var engine = EngineSourceDir();
        var offenders = new List<string>();
        var scanned = 0;

        foreach (var file in Directory.EnumerateFiles(engine, "*.cs", SearchOption.AllDirectories))
        {
            if (file.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}") ||
                file.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}")) continue;

            scanned++;
            var lineNo = 0;
            foreach (var raw in File.ReadLines(file))
            {
                lineNo++;
                // Strip comments — a vendor format named after `//` is documentation, and the engine's comments
                // legitimately explain what each driver does below the seam.
                var slash = raw.IndexOf("//", StringComparison.Ordinal);
                var code = slash >= 0 ? raw.Substring(0, slash) : raw;
                if (code.TrimStart().StartsWith("///", StringComparison.Ordinal)) continue;
                if (VendorFormat.IsMatch(code))
                    offenders.Add($"{Path.GetFileName(file)}:{lineNo}: {raw.Trim()}");
            }
        }

        Assert.True(offenders.Count == 0,
            "Volt.Engine must not know a VENDOR's serialization format. Content crosses the seam as " +
            "`ItemContent`; each driver converts to and from its own vendor's form BELOW it. The engine's own " +
            "graphical form (network text / NetworkBody) is fine — it is Volt's, not a vendor's. Found:\n  " +
            string.Join("\n  ", offenders));

        // A guard that scanned nothing passes for the wrong reason — the same floor its sibling keeps, and for
        // the same reason: a restructure that moves the sources out from under this path would silently turn
        // the gate into a no-op at exactly the moment it is most needed.
        Assert.True(scanned >= 20,
            $"the engine-format guard scanned only {scanned} file(s) under {engine} — it is not looking at the " +
            "engine. Did the sources move?");
    }

    private static string EngineSourceDir()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !File.Exists(Path.Combine(dir.FullName, "Volt.sln"))) dir = dir.Parent;
        Assert.True(dir != null, "could not locate Volt.sln above the test assembly");
        var engine = Path.Combine(dir!.FullName, "src", "Volt.Engine");
        Assert.True(Directory.Exists(engine), $"Volt.Engine source not found at {engine}");
        return engine;
    }
}
