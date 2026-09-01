using System;
using System.IO;
using System.Linq;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// THE ONE fixture loader for this suite.
///
/// <para>Six files used to carry their own copy of the same helper — each walking the directory tree upward
/// looking for <c>Volt.sln</c>, then reaching ACROSS suites into
/// <c>test/Volt.Engine.Tests/fixtures/tc-pou/</c>, a directory no engine test ever opened. Four spellings of
/// one idea, all of them load-bearing, none of them named the same thing.</para>
///
/// <para>The fixtures now live in this suite and are copied to the output directory
/// (<c>&lt;None Include="fixtures\**\*"&gt;</c> in the csproj), so the walk-up is gone: a test binary finds its
/// own fixtures beside it. That also means a fixture the csproj forgets to copy fails LOUDLY here, naming the
/// path, rather than being silently searched for somewhere up the tree.</para>
///
/// <para>One of the six was worse than duplicated. <c>TcNetworkWriterTests</c> took its identity oracle from
/// <c>test/TwinCAT Project14/.../POU_PBD.TcPOU</c> — a file inside the LIVE e2e project, which
/// <c>twincat-instances.ps1</c> opens IN PLACE and which TwinCAT itself rewrites on save. An offline test's
/// oracle cannot be a file another tier mutates. The suite's own copy is byte-identical (10,997 bytes, verified
/// at the move), so this changed nothing except who owns the bytes.</para>
/// </summary>
internal static class Fixtures
{
    /// <summary>Absolute path to a fixture, by path segments under <c>fixtures/</c>.</summary>
    public static string Path(params string[] parts)
    {
        var path = System.IO.Path.Combine(
            new[] { AppContext.BaseDirectory, "fixtures" }.Concat(parts).ToArray());
        Assert.True(File.Exists(path),
            $"missing fixture: {path} — is it under test/Volt.Ide.Twincat.Tests/fixtures/, and does the " +
            "csproj still carry <None Include=\"fixtures\\**\\*\" CopyToOutputDirectory=\"PreserveNewest\" />?");
        return path;
    }

    /// <summary>A fixture's text.</summary>
    public static string Text(params string[] parts) => File.ReadAllText(Path(parts));

    /// <summary>A vendor <c>.TcPOU</c>/<c>.TcIO</c> archive fixture, the suite's most-used shape.</summary>
    public static string Pou(string name) => Text("tc-pou", name);
}
