using System;
using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// The parity boundary IS the pipe (ARCHITECTURE.md). Core (<c>Volt.Engine</c>) is vendor-NEUTRAL: it serves both
/// PLC vendors through the one <c>IIdeDriver</c> seam, so any vendor-specific behavior can only live BELOW that seam
/// (in a bridge's driver). This guard fails the build if a vendor string literal — <c>"twincat"</c>,
/// <c>"codesys"</c>, <c>"beckhoff"</c> — appears in Core CODE, turning "don't branch on vendor above the pipe" from
/// a convention a reviewer must remember into a gate the build enforces. Comments are exempt: they legitimately
/// explain how the SHARED transform handles each vendor's PLCopen dialect — only executable code is scanned.
/// </summary>
public class VendorParityGuardTests
{
    private static readonly Regex Vendor = new("\"(twincat|codesys|beckhoff)\"", RegexOptions.IgnoreCase);

    [Fact]
    public void Core_is_vendor_neutral_no_vendor_literal_in_code()
    {
        var engine = FindEngineSourceDir();
        var offenders = new List<string>();

        foreach (var file in Directory.EnumerateFiles(engine, "*.cs", SearchOption.AllDirectories))
        {
            if (file.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}") ||
                file.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}")) continue;

            var lineNo = 0;
            foreach (var raw in File.ReadLines(file))
            {
                lineNo++;
                // Strip line/inline/XML-doc comments (all start with //); a vendor literal after // is documentation.
                var slash = raw.IndexOf("//", StringComparison.Ordinal);
                var code = slash >= 0 ? raw.Substring(0, slash) : raw;
                if (Vendor.IsMatch(code))
                    offenders.Add($"{Path.GetFileName(file)}:{lineNo}: {raw.Trim()}");
            }
        }

        Assert.True(offenders.Count == 0,
            "Core (Volt.Engine) must be vendor-neutral — the parity boundary is the pipe, so vendor-specific behavior " +
            "belongs BELOW the IIdeDriver seam, not in Core. Vendor literal(s) found in Core code:\n  " +
            string.Join("\n  ", offenders));
    }

    // Walk up from the test assembly to the solution, then to src/Volt.Engine — robust to the bin/ depth.
    private static string FindEngineSourceDir()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !File.Exists(Path.Combine(dir.FullName, "Volt.Cli.sln"))) dir = dir.Parent;
        Assert.True(dir != null, "could not locate Volt.Cli.sln above the test assembly");
        var engine = Path.Combine(dir!.FullName, "src", "Volt.Engine");
        Assert.True(Directory.Exists(engine), $"Volt.Engine source not found at {engine}");
        return engine;
    }
}
