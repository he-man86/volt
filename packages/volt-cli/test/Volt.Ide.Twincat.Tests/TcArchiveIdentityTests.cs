using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// THE IDENTITY GATE (openspec twincat-inproc-host 2.1): <see cref="TcArchiveWriter"/> reproduces every archive TwinCAT
/// wrote, byte for byte, before it is allowed to write one Volt built. A mismatch is a serializer rule still to learn —
/// never a tolerance.
///
/// <para>The sweep is every <c>&lt;XmlArchive&gt;</c> under <c>packages/volt-cli/test</c> (the vendor fixtures, the
/// TwinCAT e2e projects, the NWL corpus and its recorded imports, the generated native corpus) and the change's own
/// evidence. <c>VOLT_TC_ARCHIVE_DIRS</c> (<c>;</c>-separated) adds directories on the machine — the TwinCAT samples the
/// research used — read-only.</para>
///
/// <para>Archives a HUMAN or VOLT wrote are named below and must NOT reproduce: the gate has to be able to tell.</para>
/// </summary>
public sealed class TcArchiveIdentityTests(Xunit.Abstractions.ITestOutputHelper output)
{
    /// <summary>Not written by TwinCAT — each must fail the gate, which is how the gate shows it can tell.</summary>
    private static readonly Dictionary<string, string> NotVendorWritten = new(StringComparer.OrdinalIgnoreCase)
    {
        ["attempt1-unloadable.xml"] = "hand-built 2026-10-16, attempt 1 (a cet on a mixed list); compact one-line members",
        ["attempt2-loads.xml"] = "hand-built 2026-10-16, attempt 2; compact one-line members",
        ["MultiOutput.derived.TcPOU"] = "hand-derived fixture; a second output pin pasted at the wrong indentation",
        ["VOLT_FBD_G.TcPOU"] = "written by an earlier Volt archive builder (DIALECT N4); compact one-line members",
        // Volt's text edit, stored verbatim: DropImporterBoxOutputs removed an element and left its line and the cet.
        ["VipWire2.ide-written.xml"] = "a Volt create (import + DropImporterBoxOutputs), saved by the IDE verbatim",
        ["importer-max.TcPOU"] = "a Volt create (import + DropImporterBoxOutputs), saved by the IDE verbatim",
        ["importer-unwired.TcPOU"] = "a Volt create (import + DropImporterBoxOutputs), saved by the IDE verbatim",
    };

    public sealed record Archive(string File, string Object, IReadOnlyList<(string Name, string Guid)> Types, bool BodyForm, string Whole)
    {
        public string Root => Regex.Match(Object, "t=\"(\\w+)\"").Groups[1].Value;
        public override string ToString() => $"{Path.GetFileName(File)} [{Root}]";
    }

    private static readonly Regex TypeEntry = new("<Type n=\"(\\w+)\">([^<]*)</Type>", RegexOptions.CultureInvariant);

    internal static string RepoDir()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir != null; dir = dir.Parent)
            if (File.Exists(Path.Combine(dir.FullName, "Volt.sln"))) return dir.FullName;
        throw new InvalidOperationException("Volt.sln not found above the test binary");
    }

    private static IEnumerable<string> Sources()
    {
        var cli = RepoDir();
        var roots = new List<string>
        {
            Path.Combine(cli, "test"),
            Path.GetFullPath(Path.Combine(cli, "..", "..", "openspec", "changes", "twincat-inproc-host", "evidence")),
        };
        roots.AddRange((Environment.GetEnvironmentVariable("VOLT_TC_ARCHIVE_DIRS") ?? "")
                       .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
        var ext = new[] { ".tcpou", ".tcio", ".tcdut", ".tcgvl", ".tcvis", ".xml" };
        foreach (var root in roots.Where(Directory.Exists))
            foreach (var f in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories))
            {
                var sep = Path.DirectorySeparatorChar;
                if (f.Contains($"{sep}bin{sep}") || f.Contains($"{sep}obj{sep}") || f.Contains($"{sep}node_modules{sep}")) continue;
                if (ext.Contains(Path.GetExtension(f).ToLowerInvariant())) yield return f;
            }
    }

    /// <summary>Every archive object in <paramref name="file"/>'s text — the <c>xml:space="preserve"</c> object
    /// verbatim, and the <c>TypeList</c> entries beside it.</summary>
    internal static IEnumerable<Archive> ArchivesIn(string file, string text)
    {
        var body = text.TrimStart('\uFEFF').StartsWith("<NWL><XmlArchive>", StringComparison.Ordinal);
        for (var at = text.IndexOf("<XmlArchive>", StringComparison.Ordinal); at >= 0;
             at = text.IndexOf("<XmlArchive>", at + 1, StringComparison.Ordinal))
        {
            // A mention of the element that opens no archive (a comment, a string) is not one.
            var data = text.IndexOf("<Data>", at, StringComparison.Ordinal);
            if (data < 0) continue;
            var dataEnd = text.IndexOf("</Data>", data, StringComparison.Ordinal);
            var start = text.IndexOf("<o xml:space=\"preserve\"", data, StringComparison.Ordinal);
            if (dataEnd < 0 || start < 0 || start > dataEnd) continue;
            var end = text.LastIndexOf("</o>", dataEnd, StringComparison.Ordinal) + "</o>".Length;
            var listStart = text.IndexOf("<TypeList>", dataEnd, StringComparison.Ordinal);
            var listEnd = listStart < 0 ? -1 : text.IndexOf("</TypeList>", listStart, StringComparison.Ordinal);
            if (listEnd < 0) continue;
            var types = TypeEntry.Matches(text.Substring(listStart, listEnd - listStart))
                                 .Select(m => (m.Groups[1].Value, m.Groups[2].Value)).ToList();
            yield return new Archive(file, text.Substring(start, end - start), types, body, text);
        }
    }

    public static IReadOnlyList<Archive> All() =>
        Sources().SelectMany(f => ArchivesIn(f, File.ReadAllText(f))).ToList();

    /// <summary>What the writer answers for one archive, or why not — null when byte identical.</summary>
    internal static string? Mismatch(Archive a)
    {
        try
        {
            var newline = a.Object.Contains("\r\n", StringComparison.Ordinal) ? "\r\n" : "\n";
            var first = Regex.Match(a.Object, ">\\r?\\n( *)<");
            var indent = first.Groups[1].Value.Length - 2;
            var graph = TcArchiveWriter.ParseObject(a.Object);

            var written = TcArchiveWriter.WriteObject(graph, indent, newline);
            if (written != a.Object) return Diff("object", a.Object, written);

            var names = TcArchiveWriter.TypeNames(graph);
            var listed = a.Types.Select(t => t.Name).ToList();
            if (!names.SequenceEqual(listed))
                return $"TypeList: listed [{string.Join(",", listed)}], derived [{string.Join(",", names)}]";

            if (a.Root == "NWLImplementationObject")
            {
                foreach (var (name, guid) in a.Types)
                    if (!TcArchiveWriter.NwlTypes.TryGetValue(name, out var known) || known != guid)
                        return $"TypeList: {name} = {guid}, the writer knows {known ?? "nothing"}";
                if (a.BodyForm && TcArchiveWriter.WriteBody(graph, indent, newline) != a.Whole.TrimStart('\uFEFF'))
                    return Diff("body", a.Whole.TrimStart('\uFEFF'), TcArchiveWriter.WriteBody(graph, indent, newline));
            }
            return null;
        }
        catch (Exception ex) when (ex is NotSupportedException or System.Xml.XmlException)
        {
            return ex.GetType().Name + ": " + ex.Message;
        }
    }

    private static string Diff(string what, string want, string got)
    {
        var i = 0;
        while (i < want.Length && i < got.Length && want[i] == got[i]) i++;
        string At(string s) => s.Substring(Math.Max(0, i - 80), Math.Min(s.Length - Math.Max(0, i - 80), 160)).Replace("\r", "\\r").Replace("\n", "\\n");
        return $"{what} differs at {i}:\n  vendor: {At(want)}\n  writer: {At(got)}";
    }

    [Fact]
    public void Every_vendor_archive_is_reproduced_byte_for_byte()
    {
        var all = All();
        var vendor = all.Where(a => !NotVendorWritten.ContainsKey(Path.GetFileName(a.File))).ToList();
        Assert.True(vendor.Count >= 30, $"the sweep found only {vendor.Count} vendor archives — is the fixture tree there?");

        var failures = vendor.Select(a => (a, why: Mismatch(a))).Where(x => x.why != null)
                             .Select(x => $"{x.a.File} [{x.a.Root}]: {x.why}").ToList();
        output.WriteLine($"{vendor.Count} vendor archives in {vendor.Select(a => a.File).Distinct().Count()} files, " +
                         $"{vendor.Count(a => a.Root == "NWLImplementationObject")} of them NWL; {failures.Count} not reproduced");
        Assert.True(failures.Count == 0, $"{failures.Count} of {vendor.Count} vendor archives are not reproduced:\n" +
                                         string.Join("\n", failures.Take(10)));
    }

    [Fact]
    public void An_archive_a_human_or_Volt_wrote_is_told_apart()
    {
        var hand = All().Where(a => NotVendorWritten.ContainsKey(Path.GetFileName(a.File))).ToList();
        Assert.NotEmpty(hand);
        foreach (var a in hand)
            Assert.True(Mismatch(a) != null, $"{a}: reproduced, but it is not vendor-written ({NotVendorWritten[Path.GetFileName(a.File)]})");
    }

    /// <summary>A shape TwinCAT never writes (rule 6: a blank line; text where only members are) is refused CODED, as the
    /// writer's own rule-6 refusals are — UNSUPPORTED, never an uncoded <c>FormatException</c> that a client would read as
    /// a Volt bug (gate 3c review, finding 3).</summary>
    [Theory]
    [InlineData("<o xml:space=\"preserve\" t=\"Network\">\r\n\r\n  <v n=\"A\">1</v>\r\n</o>", "blank line")]
    [InlineData("<o xml:space=\"preserve\" t=\"Network\">\r\n  stray\r\n  <v n=\"A\">1</v>\r\n</o>", "stray")]
    public void A_shape_TwinCAT_never_writes_is_refused_UNSUPPORTED(string archive, string named)
    {
        var ex = Assert.Throws<Volt.Engine.UnsupportedException>(() => TcArchiveWriter.ParseObject(archive));
        Assert.Equal(Volt.Contracts.BridgeErrorCodes.Unsupported, ex.ErrorCode);
        Assert.Contains(named, ex.Message);
    }
}
