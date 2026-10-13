using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Repo.Gates;

/// <summary>
/// NO CULTURE-SENSITIVE OPERATION IN PRODUCT CODE (openspec <c>environment-dependency-audit</c> 1.2, requirement "Volt is
/// culture-invariant"). Volt compares, case-folds, parses and formats identifiers, numbers and dates — ST keywords, item
/// names, pids, line numbers, XML attributes — and every one of them is the same text on a Turkish, Russian or German
/// Windows as on an English one. An operation that takes the machine's culture by default answers differently there:
/// under tr-TR <c>"i".ToUpper()</c> is <c>İ</c>, under de-DE <c>1.5.ToString()</c> is <c>1,5</c>, and a culture's own
/// sign symbols reach every <c>int.Parse</c>. The in-process CODESYS bridge runs in the IDE's process, under the
/// customer's culture, which nothing of Volt chooses.
///
/// <para>Three languages ship: the C# toolchain (<c>packages/volt-cli/src</c>), the product TypeScript (the LSP,
/// volt-control, the VS Code extension, the desktop shell) and the Python the CODESYS bridge starts with (IronPython). Each
/// rule names the invariant replacement in its failure. While the sites the 1.2 measurement found stand (red until 2.8),
/// each language's offences are PINNED (<see cref="CSharpCensus"/>, <see cref="TypeScriptCensus"/>): a new site fails
/// now, a fixed one must leave the census — the red marks alone would absorb any number of new ones.</para>
///
/// <para>IronPython's own <c>str</c> case mapping is NOT culture-sensitive: measured 2026-10-13 (review of gate 1) by
/// reflection on CODESYS 3.5.21.40's IronPython 2.7.12 under tr-TR — <c>StringOps.lower(".INI")</c> is <c>.ini</c> with a
/// plain i, <c>upper("ini")</c> is <c>INI</c>, and <c>title</c>/<c>capitalize</c>/<c>swapcase</c> of <c>"iI iI"</c>
/// hold no İ/ı (the reviewer measured <c>lower</c> on 2.7.7 / 3.5.18.30 too); the .NET <c>String.ToLower()</c> in the
/// same process gives <c>ı</c>. So the Python rule is the .NET methods a <c>str</c> also carries (<c>ToUpper()</c>,
/// <c>ToLower()</c>), not Python's.</para>
///
/// <para>A text gate reaches what the TEXT says: a call by name. It cannot type an expression. What it cannot type is
/// split, measured 2026-10-13 on a scratch project (net10.0 and netstandard2.0, <c>AnalysisLevel=latest</c>,
/// <c>AnalysisModeGlobalization=All</c>):
/// <list type="bullet">
/// <item>the globalization analyzers report <c>count.ToString()</c> (CA1305), <c>a.CompareTo(b)</c> and
///   <c>s.IndexOf(variable)</c> on strings (CA1310), <c>char.ToUpper(c)</c> (CA1304) — the compiler's, once
///   <see cref="The_toolchain_build_fails_on_a_culture_typed_call"/> holds (2.8). <c>char.ToUpper</c>/<c>ToLower</c> are
///   also a text rule here, being unambiguous.</item>
/// <item>NOTHING reports a number in an interpolated string (<c>$"v={x}"</c>) or a concatenation (<c>"n=" + n</c>) — CA1305
///   is silent on both, on both targets — nor a sort by the default comparer (<c>OrderBy(s =&gt; s)</c>,
///   <c>list.Sort()</c>), which for strings is the culture's collation. The sorts are a text rule here (every sort states
///   its comparer, as the rest of the toolchain already does — the text cannot tell a string key from a number key, so
///   nobody has to decide); the interpolation and concatenation of numbers is covered by NO gate, and only the 1.1 locale
///   runs (<c>VOLT_TEST_CULTURE</c>) can see one go wrong — for a value no test formats under a switched culture, nothing
///   does.</item>
/// </list>
/// The analyzer in turn does not flag <c>int.TryParse(string, out int)</c> (measured 2026-10-13: none of the 13
/// Parse-family sites of the 0.1 census was reported), which is why the Parse family is a text rule here.</para>
/// </summary>
public class CultureInvariantOperationsTests
{
    private const string Task = "2.8";

    /// <summary>One rule: a call the text names, the condition its argument list must meet, and the replacement.</summary>
    private sealed record Rule(string Name, Regex Call, Func<string, bool> Offends, string Replacement);

    private static bool Lacks(string args, params string[] any) => !any.Any(a => args.Contains(a, StringComparison.Ordinal));

    private static readonly string[] InvariantProvider =
        { "CultureInfo.InvariantCulture", "NumberFormatInfo.InvariantInfo", "DateTimeFormatInfo.InvariantInfo" };

    private static readonly Rule[] CSharpRules =
    {
        new("number/date Parse without a culture",
            new(@"\b(int|long|short|byte|sbyte|uint|ulong|ushort|double|float|decimal|Int16|Int32|Int64|UInt16|UInt32|UInt64|Double|Single|Decimal|Byte|SByte|DateTime|DateTimeOffset|TimeSpan)\.(Try)?Parse(Exact)?\(", RegexOptions.CultureInvariant),
            a => Lacks(a, InvariantProvider),
            "int.TryParse(s, NumberStyles.None, CultureInfo.InvariantCulture, out var v) — the style the value allows, the invariant culture"),
        new("Convert.To<number/string> without a culture",
            new(@"\bConvert\.To(String|Int16|Int32|Int64|UInt16|UInt32|UInt64|Double|Single|Decimal|Byte|SByte|DateTime)\(", RegexOptions.CultureInvariant),
            a => Lacks(a, InvariantProvider),
            "Convert.ToString(value, CultureInfo.InvariantCulture)"),
        new("ToUpper()/ToLower() in the current culture",
            new(@"\.To(Upper|Lower)\(\s*\)", RegexOptions.CultureInvariant),
            _ => true,
            "ToUpperInvariant() / ToLowerInvariant() — or, to compare, string.Equals(a, b, StringComparison.OrdinalIgnoreCase)"),
        new("string.Compare without a StringComparison",
            new(@"\b[Ss]tring\.Compare\(", RegexOptions.CultureInvariant),
            a => Lacks(a, "StringComparison."),
            "string.Compare(a, b, StringComparison.Ordinal) (OrdinalIgnoreCase for identifiers)"),
        new("StartsWith/EndsWith(string) without a StringComparison",
            new(@"\.(StartsWith|EndsWith)\(", RegexOptions.CultureInvariant),
            a => Lacks(a, "StringComparison.") && !Regex.IsMatch(a, @"^\(\s*'(\\.|[^'])'\s*\)$", RegexOptions.CultureInvariant),
            "s.StartsWith(\"x\", StringComparison.Ordinal) (OrdinalIgnoreCase for identifiers)"),
        new("IndexOf(string literal) without a StringComparison",
            new(@"\.(Last)?IndexOf\(\s*""", RegexOptions.CultureInvariant),
            a => Lacks(a, "StringComparison."),
            "s.IndexOf(\"x\", StringComparison.Ordinal)"),
        new("string.Format without a culture",
            new(@"\b[Ss]tring\.Format\(", RegexOptions.CultureInvariant),
            a => Lacks(a, InvariantProvider),
            "string.Format(CultureInfo.InvariantCulture, format, args)"),
        // Every format string, whatever it formats: the text cannot tell a Guid's "N" (culture-free) from a number's "N"
        // (group separators), so a format always travels with its provider — cheap, and nobody has to decide.
        new("ToString(format) without a culture",
            new(@"\.ToString\(\s*""", RegexOptions.CultureInvariant),
            a => Lacks(a, InvariantProvider),
            "value.ToString(\"x2\", CultureInfo.InvariantCulture)"),
        new("char.ToUpper/ToLower in the current culture",
            new(@"\b[Cc]har\.To(Upper|Lower)\(", RegexOptions.CultureInvariant),
            a => Lacks(a, "CultureInfo.InvariantCulture"),
            "char.ToUpperInvariant(c) / char.ToLowerInvariant(c)"),
        // The default comparer of a string key is the culture's collation; the text cannot tell a string key from a
        // number key, so every sort states its comparer (the toolchain's own convention — 20 sorts already do).
        new("a sort by the default comparer",
            new(@"\.(OrderBy|OrderByDescending|ThenBy|ThenByDescending)\(", RegexOptions.CultureInvariant),
            a => TopLevelArguments(a) < 2,
            "OrderBy(k => k.Name, StringComparer.Ordinal) for a string key; Comparer<int>.Default for a number key"),
        new("a list sorted by the default comparer",
            new(@"\.Sort\(\s*\)", RegexOptions.CultureInvariant), _ => true,
            "list.Sort(StringComparer.Ordinal)"),
        new("an array sorted by the default comparer",
            new(@"\bArray\.Sort\(", RegexOptions.CultureInvariant),
            a => TopLevelArguments(a) < 2,
            "Array.Sort(names, StringComparer.Ordinal)"),
        new("the current culture named",
            new(@"\b(CultureInfo\.Current(UI)?Culture|StringComparison\.CurrentCulture(IgnoreCase)?|StringComparer\.CurrentCulture(IgnoreCase)?)\b", RegexOptions.CultureInvariant),
            _ => true,
            "CultureInfo.InvariantCulture / StringComparison.Ordinal(IgnoreCase) / StringComparer.Ordinal(IgnoreCase)"),
    };

    private static readonly Rule[] TypeScriptRules =
    {
        new("localeCompare (the default locale's collation)",
            new(@"\.localeCompare\(", RegexOptions.CultureInvariant), _ => true,
            "an ordinal compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0)"),
        new("toLocale* (the default locale's case or format)",
            new(@"\.toLocale(UpperCase|LowerCase|String|DateString|TimeString)\(", RegexOptions.CultureInvariant), _ => true,
            "toUpperCase()/toLowerCase() (locale-independent by the spec), String(n), toISOString()"),
        new("an Intl formatter without an explicit locale",
            new(@"\bIntl\.(Collator|NumberFormat|DateTimeFormat|PluralRules|RelativeTimeFormat|ListFormat|Segmenter|DisplayNames)\(", RegexOptions.CultureInvariant),
            a => Regex.IsMatch(a, @"^\(\s*(\)|undefined\b)", RegexOptions.CultureInvariant),
            "new Intl.NumberFormat(\"en-US\", …) — the locale stated"),
    };

    private static readonly Rule[] PythonRules =
    {
        // Python's own str.lower()/upper()/… are invariant in IronPython (measured, see the class doc); a str is a
        // System.String, so the .NET methods are reachable on it too — and those take the IDE's culture.
        new(".NET ToUpper()/ToLower() on a str (the IDE's culture)",
            new(@"\.To(Upper|Lower)\(\s*\)", RegexOptions.CultureInvariant), _ => true,
            "s.lower() / s.upper() (IronPython's are invariant), or s.ToLowerInvariant()"),
        new("the locale module",
            new(@"^\s*(import\s+locale|from\s+locale\s+import)\b", RegexOptions.CultureInvariant | RegexOptions.Multiline), _ => true,
            "no locale-dependent formatting: str(n), '%d' % n"),
    };

    // ── the rules, over the product ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Product_CSharp_uses_no_culture_sensitive_operation() =>
        ExpectRed.Until(Task, $"product C# makes {CSharpCensus.Length} culture-sensitive calls (the census below)",
            () => AssertNone("C#", CSharpRules, CSharpFiles()));

    [Fact]
    public void Product_TypeScript_uses_no_locale_sensitive_operation() =>
        ExpectRed.Until(Task, "product TS sorts with localeCompare (0.1 census: volt-control/src/diagnostics.ts)",
            () => AssertNone("TypeScript", TypeScriptRules, TypeScriptFiles()));

    [Fact]
    public void Shipped_Python_uses_no_culture_sensitive_operation() =>
        AssertNone("Python", PythonRules, ShippedPython());

    // ── the ratchet: while the reds above stand, the sites they hold are PINNED ─────────────────────────────────

    /// <summary>The C# sites the 1.2 measurement found, as <c>file  [rule] line</c> (no line number: an edit above a site
    /// must not move it out of the census). 2026-10-13: 29 (13 Parse, 10 Convert.To*, 5 ToString(format), 1 StartsWith)
    /// + 10 sorts by the default comparer (review of gate 1: 9 lines, PushService orders twice on one) = 39. 2.8 empties it.</summary>
    private static readonly string[] CSharpCensus =
    {
        "packages/volt-cli/src/Volt.Cli/Interface/ConsoleServer.cs  [number/date Parse without a culture] int.TryParse(Environment.GetEnvironmentVariable(\"VOLT_CONTROL_PORT\"), out var p) && p > 0 ? p : 8550;",
        "packages/volt-cli/src/Volt.Cli/Program.cs  [number/date Parse without a culture] else if (!int.TryParse(requested, out port) || port < 1 || port > 65535)",
        "packages/volt-cli/src/Volt.Cli/Sync/Commands.cs  [ToString(format) without a culture] LinkedAt = DateTime.UtcNow.ToString(\"o\"),",
        "packages/volt-cli/src/Volt.Cli/Sync/Git.cs  [number/date Parse without a culture] Identical: int.TryParse(status.Substring(1), out var pct) && pct >= 100));",
        "packages/volt-cli/src/Volt.Cli/Sync/Git.cs  [number/date Parse without a culture] var size = int.Parse(header.Substring(header.LastIndexOf(' ') + 1));",
        "packages/volt-cli/src/Volt.Connector.Core/ConnectionManager.cs  [ToString(format) without a culture] var id = Guid.NewGuid().ToString(\"N\");",
        "packages/volt-cli/src/Volt.Connector.Core/ControlServer.cs  [number/date Parse without a culture] int.TryParse(Environment.GetEnvironmentVariable(\"VOLT_CONTROL_PORT\"), out var p) && p > 0 ? p : ControlPort;",
        "packages/volt-cli/src/Volt.Connector.Core/TwincatXaeProbe.cs  [number/date Parse without a culture] if (int.TryParse(line.Trim(), out var pid) && pid > 0 && !pids.Contains(pid)) pids.Add(pid);",
        "packages/volt-cli/src/Volt.Connector/LogWindow.cs  [a sort by the default comparer] want.AddRange(rows.Select(r => r.Src).Where(s => s.Length > 0 && s != \"?\").Distinct().OrderBy(s => s));",
        "packages/volt-cli/src/Volt.Connector/StatusWindow.cs  [number/date Parse without a culture] if (parts.Length >= 3 && int.TryParse(parts[^1], out var last) && last >= 1000) return last.ToString();",
        "packages/volt-cli/src/Volt.Connector/StatusWindow.cs  [StartsWith/EndsWith(string) without a StringComparison] var lsp = lspRaw.StartsWith(\"volt-lsp-iec \") ? lspRaw.Substring(\"volt-lsp-iec \".Length).Trim() : lspRaw;",
        "packages/volt-cli/src/Volt.Connector/TrayContext.cs  [a sort by the default comparer] foreach (var p in _conn.Projects.OrderBy(x => x.Vendor).ThenBy(x => x.ProjectName, StringComparer.OrdinalIgnoreCase))",
        "packages/volt-cli/src/Volt.Engine/Format/Network/NetworkSpelling.cs  [a sort by the default comparer] string.Join(\", \", wires.OrderBy(w => w.VarId).Select(w => w.Name + \" : \" + w.Type));",
        "packages/volt-cli/src/Volt.Engine/Format/St/StWriter.cs  [a sort by the default comparer] .OrderBy(c => KindOrder(c.Kind))",
        "packages/volt-cli/src/Volt.Engine/Ide/TreeNav.cs  [a sort by the default comparer] .OrderByDescending(f => FolderPath.Segments(f).Count()))",
        "packages/volt-cli/src/Volt.Engine/Sync/Hasher.cs  [ToString(format) without a culture] foreach (var b in bytes) sb.Append(b.ToString(\"x2\"));",
        "packages/volt-cli/src/Volt.Engine/Sync/PushService.cs  [a sort by the default comparer] .OrderBy(x => position.TryGetValue(x.c.Name, out var at) ? at : int.MaxValue).ThenBy(x => x.k)",
        "packages/volt-cli/src/Volt.Engine/Sync/PushService.cs  [a sort by the default comparer] .OrderBy(x => position.TryGetValue(x.c.Name, out var at) ? at : int.MaxValue).ThenBy(x => x.k)",
        "packages/volt-cli/src/Volt.Engine/Sync/PushService.cs  [a sort by the default comparer] .OrderByDescending(x => x.op is SetItemOp { ToFolder: { } f } ? Depth(f) : 0)",
        "packages/volt-cli/src/Volt.Engine/Sync/PushService.cs  [a sort by the default comparer] .ThenBy(x => x.i)",
        "packages/volt-cli/src/Volt.Ide.Codesys/Ide/CodesysObjectModel.Descriptors.cs  [Convert.To<number/string> without a culture] foreach (var fld in fields) d.Add(fld.Label, System.Convert.ToString(GetMember(f, fld.Prop)));",
        "packages/volt-cli/src/Volt.Ide.Codesys/Ide/CodesysObjectModel.Descriptors.cs  [Convert.To<number/string> without a culture] if (int.TryParse(System.Convert.ToString(id), out var n)) codes.Add(n);",
        "packages/volt-cli/src/Volt.Ide.Codesys/Ide/CodesysObjectModel.Descriptors.cs  [Convert.To<number/string> without a culture] MaxCompilerWarnings: System.Convert.ToString(GetMember(options, \"MaxCompilerWarnings\")),",
        "packages/volt-cli/src/Volt.Ide.Codesys/Ide/CodesysObjectModel.Descriptors.cs  [Convert.To<number/string> without a culture] ProjectDefines: System.Convert.ToString(GetMember(options, \"ProjectDefines\")));",
        "packages/volt-cli/src/Volt.Ide.Codesys/Ide/CodesysObjectModel.Descriptors.cs  [Convert.To<number/string> without a culture] return Descriptor.Flatten(System.Convert.ToString(GetMember(o, name)));",
        "packages/volt-cli/src/Volt.Ide.Codesys/Ide/CodesysObjectModel.Descriptors.cs  [Convert.To<number/string> without a culture] var col = System.Convert.ToString(GetMember(v, \"name\"))?.Trim() ?? \"\";",
        "packages/volt-cli/src/Volt.Ide.Codesys/Ide/CodesysObjectModel.Descriptors.cs  [Convert.To<number/string> without a culture] var name = System.Convert.ToString(GetMember(v, \"variablename\"))?.Trim() ?? \"\";",
        "packages/volt-cli/src/Volt.Ide.Codesys/Ide/CodesysObjectModel.Descriptors.cs  [Convert.To<number/string> without a culture] var type = System.Convert.ToString(GetMember(v, \"type\"))?.Trim() ?? \"\";",
        "packages/volt-cli/src/Volt.Ide.Codesys/Ide/CodesysObjectModel.Descriptors.cs  [number/date Parse without a culture] if (int.TryParse(System.Convert.ToString(id), out var n)) codes.Add(n);",
        "packages/volt-cli/src/Volt.Ide.Codesys/Ide/CodesysObjectModel.Task.cs  [a sort by the default comparer] $\"— it offers: {string.Join(\", \", writeable.GetType().GetMethods(BF).Select(m => m.Name).Distinct().OrderBy(n => n))}\");",
        "packages/volt-cli/src/Volt.Ide.Twincat.Explorer/Program.cs  [number/date Parse without a culture] if (Array.IndexOf(args, \"--serve\") < 0 || !int.TryParse(Arg(args, \"--xae-pid\"), out var pid))",
        "packages/volt-cli/src/Volt.Ide.Twincat/Ide/RotInstances.cs  [Convert.To<number/string> without a culture] long hwnd = Convert.ToInt64(((dynamic)dte).MainWindow.HWnd); // EnvDTE exposes HWND as an int/long",
        "packages/volt-cli/src/Volt.Ide.Twincat/Ide/TcItemArchive.cs  [ToString(format) without a culture] var zip = Path.Combine(Path.GetTempPath(), \"volt_move_\" + Guid.NewGuid().ToString(\"N\") + \".zip\");",
        "packages/volt-cli/src/Volt.Ide.Twincat/Ide/TcObjectModel.Build.cs  [number/date Parse without a culture] if (m.Groups[2].Success) int.TryParse(m.Groups[2].Value, out lineNum);",
        "packages/volt-cli/src/Volt.Ide.Twincat/Ide/TcObjectModel.Build.cs  [number/date Parse without a culture] if (m.Groups[3].Success) int.TryParse(m.Groups[3].Value, out colNum);",
        "packages/volt-cli/src/Volt.Ide.Twincat/Ide/TcObjectModel.cs  [ToString(format) without a culture] var name = \"VoltScratch_\" + Guid.NewGuid().ToString(\"N\").Substring(0, 12);",
        "packages/volt-cli/src/Volt.Ide.Twincat/Ide/TcSolutionExplorer.cs  [Convert.To<number/string> without a culture] private static uint ItemId(object v) => v is int i ? unchecked((uint)i) : Convert.ToUInt32(v);",
        "packages/volt-cli/src/Volt.Ide.Twincat/Program.cs  [number/date Parse without a culture] if (args[i] == WorkerCli.ProbeInProc) int.TryParse(args[i + 1], out pid);",
        "packages/volt-cli/src/Volt.Ide.Twincat/Program.cs  [number/date Parse without a culture] if (args[i] == WorkerCli.XaePid && int.TryParse(args[i + 1], out var p)) xaePid = p;",
    };

    private static readonly string[] TypeScriptCensus =
    {
        "packages/volt-control/src/diagnostics.ts  [localeCompare (the default locale's collation)] files.sort((a, b) => b.errors - a.errors || b.warnings - a.warnings || a.path.localeCompare(b.path))",
    };

    [Fact]
    public void No_new_culture_sensitive_CSharp_call() => AssertCensus("C#", CSharpRules, CSharpFiles(), CSharpCensus);

    [Fact]
    public void No_new_locale_sensitive_TypeScript_call() => AssertCensus("TypeScript", TypeScriptRules, TypeScriptFiles(), TypeScriptCensus);

    private static void AssertCensus(string language, Rule[] rules, IReadOnlyList<string> files, string[] census)
    {
        var root = NoCodeCheckLeftTests.RepoRoot();
        var found = files.SelectMany(f => Offences(rules, Path.GetRelativePath(root, f).Replace('\\', '/'), File.ReadAllText(f))).ToList();
        var pinned = census.ToList();
        var added = new List<Offence>();
        foreach (var o in found)
            if (!pinned.Remove(o.Key)) added.Add(o);
        Assert.True(added.Count == 0,
            $"{added.Count} NEW culture-sensitive {language} operation(s) — the census only shrinks; use the replacement:\n  "
            + string.Join("\n  ", added.Select(o => o.Display))
            + "\n(census form:)\n" + string.Join("\n", added.Select(o => $"        \"{Escape(o.Key)}\",")));
        Assert.True(pinned.Count == 0,
            $"{pinned.Count} pinned {language} site(s) no longer offend — fixed (2.8): take them out of the census:\n  " + string.Join("\n  ", pinned));
    }

    private static string Escape(string s) => s.Replace("\\", "\\\\").Replace("\"", "\\\"");

    /// <summary>What the text cannot type is the compiler's: every shipped C# project is built with the globalization
    /// rules that name a culture-typed call — CA1304/CA1311 (ToUpper/ToLower without a culture), CA1305 (no
    /// IFormatProvider: <c>int.ToString()</c>, <c>Convert.ToUInt32(object)</c>), CA1309/CA1310 (a culture
    /// StringComparison) — as ERRORS. Measured 2026-10-13 with <c>-p:AnalysisLevel=latest -p:AnalysisModeGlobalization=All</c>:
    /// 28 CA1305 + 1 CA1310 in src (Connector 1+1, Engine 2, Ide.Codesys 8, Ide.Twincat 17), none of which the text rules see
    /// as typed calls. A rule the build only warns about is a rule nobody reads, so the gate asks for the error form:
    /// <c>dotnet_diagnostic.CA1305.severity = error</c> in a config the projects read, or the id in
    /// <c>WarningsAsErrors</c>.</summary>
    [Fact]
    public void The_toolchain_build_fails_on_a_culture_typed_call() =>
        ExpectRed.Until(Task, "no shipped project builds with the globalization analyzers as errors",
            () =>
            {
                var pkg = Path.Combine(NoCodeCheckLeftTests.RepoRoot(), "packages", "volt-cli");
                var config = string.Join("\n", new[] { Path.Combine(pkg, "Directory.Build.props"), Path.Combine(pkg, "src", "Directory.Build.props") }
                    .Concat(Directory.EnumerateFiles(Path.Combine(pkg, "src"), "*.globalconfig", SearchOption.AllDirectories))
                    .Concat(new[] { Path.Combine(pkg, ".globalconfig"), Path.Combine(pkg, "src", ".editorconfig") })
                    .Where(File.Exists).Select(File.ReadAllText));
                var missing = new[] { "CA1304", "CA1305", "CA1309", "CA1310", "CA1311" }
                    .Where(id => !Regex.IsMatch(config, $@"dotnet_diagnostic\.{id}\.severity\s*=\s*error|<WarningsAsErrors>[^<]*\b{id}\b", RegexOptions.CultureInvariant))
                    .ToList();
                Assert.True(missing.Count == 0,
                    "the shipped C# projects do not build these globalization rules as errors: " + string.Join(", ", missing));
            });

    // ── the gate fires (the scanner is tested on text, so a rule that matches nothing cannot pass for a clean tree) ──

    [Theory]
    [InlineData("var n = int.Parse(s);")]
    [InlineData("if (int.TryParse(\n    s, out var n)) {}")]
    [InlineData("var t = Convert.ToString(o);")]
    [InlineData("var u = name.ToUpper();")]
    [InlineData("if (string.Compare(a, b) == 0) {}")]
    [InlineData("if (line.StartsWith(\"VAR\")) {}")]
    [InlineData("if (line.EndsWith(suffix)) {}")]
    [InlineData("var i = s.IndexOf(\"::\");")]
    [InlineData("var m = string.Format(\"{0}\", n);")]
    [InlineData("var h = b.ToString(\"x2\");")]
    [InlineData("var c = CultureInfo.CurrentCulture;")]
    [InlineData("var k = char.ToUpper(c);")]
    [InlineData("var rows = names.OrderBy(s => s);")]
    [InlineData("var rows = ps.OrderBy(x => x.Vendor).ThenBy(x => x.Name, StringComparer.Ordinal);")]
    [InlineData("var rows = ps.OrderBy(x => position.TryGetValue(x.Name, out var at) ? at : int.MaxValue);")]
    [InlineData("names.Sort();")]
    [InlineData("Array.Sort(names);")]
    public void A_culture_sensitive_CSharp_call_is_named(string code) =>
        Assert.Single(Offences(CSharpRules, "X.cs", code));

    [Theory]
    [InlineData("var n = int.Parse(s, NumberStyles.None, CultureInfo.InvariantCulture);")]
    [InlineData("if (int.TryParse(\n    s, NumberStyles.None, CultureInfo.InvariantCulture, out var n)) {}")]
    [InlineData("var t = Convert.ToString(o, CultureInfo.InvariantCulture);")]
    [InlineData("var u = name.ToUpperInvariant();")]
    [InlineData("if (string.Compare(a, b, StringComparison.Ordinal) == 0) {}")]
    [InlineData("if (line.StartsWith(\"VAR\", StringComparison.Ordinal)) {}")]
    [InlineData("if (line.StartsWith('V')) {}")]
    [InlineData("var i = s.IndexOf(':');")]
    [InlineData("var h = b.ToString(\"x2\", CultureInfo.InvariantCulture);")]
    [InlineData("// int.Parse(s) in a comment")]
    [InlineData("/// <c>s.ToUpper()</c> in a doc comment")]
    [InlineData("var b = Convert.ToBase64String(bytes);")]
    [InlineData("if (!rest.EndsWith(\")\", StringComparison.Ordinal)) {}")]
    [InlineData("var close = s.IndexOf(\"*)\", StringComparison.Ordinal);")]
    [InlineData("var k = char.ToUpperInvariant(c);")]
    [InlineData("var rows = names.OrderBy(s => s, StringComparer.Ordinal);")]
    [InlineData("names.Sort(StringComparer.Ordinal);")]
    [InlineData("var rows = xs.OrderBy(x => x.Line, Comparer<int>.Default);")]
    public void An_invariant_CSharp_call_passes(string code) =>
        Assert.Empty(Offences(CSharpRules, "X.cs", code));

    [Theory]
    [InlineData("files.sort((a, b) => a.path.localeCompare(b.path))", 1)]
    [InlineData("const s = n.toLocaleString()", 1)]
    [InlineData("const f = new Intl.NumberFormat()", 1)]
    [InlineData("const f = new Intl.NumberFormat(\"en-US\")", 0)]
    [InlineData("const u = s.toUpperCase()", 0)]
    public void The_TypeScript_rules_fire(string code, int expected) =>
        Assert.Equal(expected, Offences(TypeScriptRules, "x.ts", code).Count);

    [Theory]
    [InlineData("    if n.ToLower() == '.json':", 1)]
    [InlineData("    if os.path.splitext(n)[1].lower() == '.json':", 0)]   // IronPython's str.lower is invariant (measured)
    [InlineData("    s = name.upper().title()", 0)]
    [InlineData("import locale", 1)]
    [InlineData("    # name.lower() in a comment", 0)]
    [InlineData("    if System.String.Equals(a, b, System.StringComparison.OrdinalIgnoreCase):", 0)]
    public void The_Python_rules_fire(string code, int expected) =>
        Assert.Equal(expected, Offences(PythonRules, "x.py", code).Count);

    // ── the scanner ──────────────────────────────────────────────────────────────────────────────────────────────

    private static void AssertNone(string language, Rule[] rules, IReadOnlyList<string> files)
    {
        Assert.True(files.Count > 0, $"no {language} product file found — the gate is not reading the sources");
        var root = NoCodeCheckLeftTests.RepoRoot();
        var offences = files.SelectMany(f => Offences(rules, Path.GetRelativePath(root, f).Replace('\\', '/'), File.ReadAllText(f))).ToList();
        Assert.True(offences.Count == 0,
            $"{offences.Count} culture-sensitive {language} operation(s) in product code — each answers differently on a Turkish, " +
            "Russian or German machine:\n  " + string.Join("\n  ", offences.Select(o => o.Display)));
    }

    /// <summary>One site: its census key (<c>file  [rule] line text</c> — no line number, so an edit above it does not
    /// move it) and what a failure shows (with the line number and the replacement).</summary>
    private sealed record Offence(string Key, string Display);

    private static List<Offence> Offences(Rule[] rules, string file, string text)
    {
        var lineStarts = new List<int> { 0 };
        for (var i = 0; i < text.Length; i++) if (text[i] == '\n') lineStarts.Add(i + 1);
        var python = file.EndsWith(".py", StringComparison.Ordinal);
        var found = new List<Offence>();
        foreach (var rule in rules)
            foreach (Match m in rule.Call.Matches(text))
            {
                var line = lineStarts.FindLastIndex(s => s <= m.Index);
                var prefix = text.Substring(lineStarts[line], m.Index - lineStarts[line]);
                if (InComment(prefix, python)) continue;
                if (!rule.Offends(Arguments(text, m))) continue;
                var source = text.Substring(lineStarts[line]).Split('\n')[0].Trim();
                found.Add(new($"{file}  [{rule.Name}] {source}", $"{file}:{line + 1}  [{rule.Name}] {source}\n      → {rule.Replacement}"));
            }
        return found;
    }

    /// <summary>How many arguments an argument list (parentheses included) holds: its commas at depth one, outside a
    /// literal, plus one — zero for <c>()</c>.</summary>
    private static int TopLevelArguments(string args)
    {
        if (args.Length < 2) return 0;
        var inner = args.Substring(1, args.Length - 2);
        if (inner.Trim().Length == 0) return 0;
        int depth = 0, count = 1;
        for (var i = 0; i < inner.Length; i++)
        {
            var c = inner[i];
            if (c == '"' || c == '\'')
            {
                for (i++; i < inner.Length && inner[i] != c; i++)
                    if (inner[i] == '\\') i++;
                continue;
            }
            if (c is '(' or '[' or '{') depth++;
            else if (c is ')' or ']' or '}') depth--;
            else if (c == ',' && depth == 0) count++;
        }
        return count;
    }

    /// <summary>The match sits in a comment: a <c>//</c> (C#/TS) or <c>#</c> (Python) before it on its line, outside a
    /// string, or a line inside a block/doc comment.</summary>
    private static bool InComment(string prefix, bool python)
    {
        var trimmed = prefix.TrimStart();
        if (trimmed.StartsWith("*", StringComparison.Ordinal) || trimmed.StartsWith("/*", StringComparison.Ordinal)) return true;
        var marker = python ? "#" : "//";
        var inString = false;
        for (var i = 0; i < prefix.Length; i++)
        {
            if (prefix[i] == '"' || (python && prefix[i] == '\'')) inString = !inString;
            else if (!inString && string.CompareOrdinal(prefix, i, marker, 0, marker.Length) == 0) return true;
        }
        return false;
    }

    /// <summary>The call's argument list, parentheses included, balanced across lines (capped, so a stray paren in a
    /// string cannot run to the end of the file). A rule with no call parenthesis (a name) gets the empty string.</summary>
    private static string Arguments(string text, Match m)
    {
        var open = m.Value.EndsWith("(", StringComparison.Ordinal) ? m.Index + m.Length - 1
                 : m.Value.Contains('(') ? m.Index + m.Value.IndexOf('(') : -1;
        if (open < 0) return "";
        var depth = 0;
        for (var i = open; i < text.Length && i < open + 800; i++)
        {
            var c = text[i];
            if (c == '"' || c == '\'')   // a literal's parentheses are not the call's: `EndsWith(")", …)`
            {
                for (i++; i < text.Length && text[i] != c && text[i] != '\n'; i++)
                    if (text[i] == '\\') i++;
                continue;
            }
            if (c == '(') depth++;
            else if (c == ')' && --depth == 0) return text.Substring(open, i - open + 1);
        }
        return text.Substring(open, Math.Min(800, text.Length - open));
    }

    // ── what ships ───────────────────────────────────────────────────────────────────────────────────────────────

    private static bool Built(string f) =>
        f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.Ordinal)
        || f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.Ordinal)
        || f.Contains($"{Path.DirectorySeparatorChar}node_modules{Path.DirectorySeparatorChar}", StringComparison.Ordinal)
        || f.Contains($"{Path.DirectorySeparatorChar}dist{Path.DirectorySeparatorChar}", StringComparison.Ordinal);

    private static IReadOnlyList<string> CSharpFiles() =>
        Directory.EnumerateFiles(Path.Combine(NoCodeCheckLeftTests.RepoRoot(), "packages", "volt-cli", "src"), "*.cs", SearchOption.AllDirectories)
            .Where(f => !Built(f)).ToList();

    /// <summary>The product TypeScript: the source of every package that ships code a customer runs, tests excluded.</summary>
    private static IReadOnlyList<string> TypeScriptFiles() =>
        new[] { "volt-lsp-iec", "volt-control", "volt-vscode", "volt-desktop" }
            .Select(p => Path.Combine(NoCodeCheckLeftTests.RepoRoot(), "packages", p, "src"))
            .Where(Directory.Exists)
            .SelectMany(d => Directory.EnumerateFiles(d, "*.*", SearchOption.AllDirectories))
            .Where(f => (f.EndsWith(".ts", StringComparison.Ordinal) || f.EndsWith(".tsx", StringComparison.Ordinal))
                     && !f.EndsWith(".test.ts", StringComparison.Ordinal) && !f.EndsWith(".d.ts", StringComparison.Ordinal) && !Built(f))
            .ToList();

    /// <summary>The Python that ships: what <c>build-cli.ps1</c> copies out of <c>scripts\</c> into the payload, read from
    /// the script itself so a new shipped script is covered without an edit here.</summary>
    private static IReadOnlyList<string> ShippedPython()
    {
        var pkg = Path.Combine(NoCodeCheckLeftTests.RepoRoot(), "packages", "volt-cli");
        var buildCli = File.ReadAllText(Path.Combine(pkg, "scripts", "build-cli.ps1"));
        var names = Regex.Matches(buildCli, @"\\scripts\\([A-Za-z0-9_]+\.py)", RegexOptions.CultureInvariant)
            .Select(m => m.Groups[1].Value).Distinct(StringComparer.Ordinal).ToList();
        Assert.True(names.Count > 0, "build-cli.ps1 copies no .py out of scripts\\ — the gate no longer finds the shipped Python");
        return names.Select(n => Path.Combine(pkg, "scripts", n)).ToList();
    }
}
