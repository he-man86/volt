using System;
using System.IO;
using System.Linq;
using Xunit;
using Volt.Cli.Sync;

namespace Volt.Cli.Tests;

/// <summary>
/// Every git porcelain reader must survive a NON-ASCII path.
///
/// <para><c>core.quotepath</c> is ON by default, and it applies to <c>ls-tree</c>, <c>status --porcelain</c> and
/// <c>diff --name-status</c> alike: a path containing anything outside ASCII comes back as a DOUBLE-QUOTED token
/// with octal escapes — <c>"src/W\303\244rme/FB_X.fb"</c> — not as the path. Volt then treats that token as the
/// path, and the consequences are not cosmetic:</para>
/// <list type="bullet">
///   <item>the item is not carried forward into the new <c>volt/ide</c> tree, so the merge DELETES it;</item>
///   <item>it is re-added under a path containing a literal <c>"</c>, which Windows refuses to check out — the
///         pull dies with <c>invalid path</c> and the workspace can never sync again;</item>
///   <item>on push, the extension parses as <c>.fb"</c>, so the foreign-extension guard rejects the ENTIRE push
///         with "unrecognized file extension … Rename each to its Volt kind extension" — advice that cannot work.</item>
/// </list>
///
/// <para>One German folder name is enough, and folder names are free text. <c>StructuralConflictFiles</c> already
/// passes <c>-z</c> and parses NUL-delimited records; it was the only reader that did.</para>
///
/// <para>These tests drive the readers against a real repository rather than asserting on argument lists —
/// checking that <c>-z</c> is present would pass the moment someone adds the flag and still miss a parser that
/// splits the NUL stream wrongly.</para>
/// </summary>
public class QuotepathTests
{
    /// <summary>A repo with one ASCII and one non-ASCII path committed, with <c>core.quotepath</c> left at its
    /// DEFAULT — setting it false in the fixture would test a configuration no user has.</summary>
    private static string RepoWithUmlautPath()
    {
        Environment.SetEnvironmentVariable("GIT_AUTHOR_NAME", "t");
        Environment.SetEnvironmentVariable("GIT_AUTHOR_EMAIL", "t@t");
        Environment.SetEnvironmentVariable("GIT_COMMITTER_NAME", "t");
        Environment.SetEnvironmentVariable("GIT_COMMITTER_EMAIL", "t@t");
        var root = Directory.CreateTempSubdirectory("volt-quotepath-").FullName;
        Git.GitInit(root);
        foreach (var rel in new[] { "src/Plain/FB_A.fb", "src/Wärme/FB_X.fb" })
        {
            var full = Path.Combine(root, rel.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(full)!);
            File.WriteAllText(full, "FUNCTION_BLOCK X\nEND_FUNCTION_BLOCK\n");
        }
        Git.StageSrc(root);
        Git.CommitAll(root, "seed");
        return root;
    }

    private const string Umlaut = "src/Wärme/FB_X.fb";

    [Fact]
    public void ListTree_returns_the_real_path_not_a_quoted_octal_escape()
    {
        var root = RepoWithUmlautPath();
        try
        {
            var paths = Git.ListTree(Git.ResolveGitDir(root), "HEAD").Select(e => e.Path).ToList();
            Assert.Contains("src/Plain/FB_A.fb", paths);
            Assert.Contains(Umlaut, paths);
            Assert.DoesNotContain(paths, p => p.Contains('"') || p.Contains("\\303"));
        }
        finally { try { Directory.Delete(root, true); } catch { } }
    }

    [Fact]
    public void DiffRefs_reports_the_real_path_for_a_non_ascii_file()
    {
        var root = RepoWithUmlautPath();
        try
        {
            var first = Git.HeadCommit(root)!;
            File.AppendAllText(Path.Combine(root, "src", "Wärme", "FB_X.fb"), "// edit\n");
            Git.StageSrc(root);
            Git.CommitAll(root, "edit");

            var rows = Git.DiffRefs(root, first, Git.HeadCommit(root)!, "src");
            Assert.Contains(rows, r => r.Path == Umlaut);
            Assert.DoesNotContain(rows, r => r.Path.Contains('"') || r.Path.Contains("\\303"));
        }
        finally { try { Directory.Delete(root, true); } catch { } }
    }

    /// <summary>A RENAME survives the -z record shape, with both sides intact.
    /// <para>This branch is the one <c>-z</c> changes most, and it had no test at all. Without <c>-z</c> a rename
    /// is ONE tab-joined line, <c>R100	old	new</c>; with it the status is followed by two separate NUL fields.
    /// A parser that kept the old assumption would read the status, take the next field as the path, and emit a
    /// MODIFY of the old path plus a spurious row from the new one — turning a rename into a delete-and-add at
    /// the layer above, which is how a graphical body gets rebuilt from text instead of moved.</para>
    /// <para>Both an ASCII and a non-ASCII rename, because the failure modes are independent: the record shape
    /// breaks every rename, quotepath breaks only the non-ASCII ones.</para></summary>
    [Theory]
    [InlineData("src/Plain/FB_A.fb", "src/Plain/FB_Renamed.fb")]
    [InlineData("src/Wärme/FB_X.fb", "src/Wärme/FB_Umbenannt.fb")]
    public void DiffRefs_reports_a_rename_with_both_sides(string from, string to)
    {
        var root = RepoWithUmlautPath();
        try
        {
            var first = Git.HeadCommit(root)!;
            var src = Path.Combine(root, from.Replace('/', Path.DirectorySeparatorChar));
            var dst = Path.Combine(root, to.Replace('/', Path.DirectorySeparatorChar));
            File.Move(src, dst);
            Git.StageSrc(root);
            Git.CommitAll(root, "rename");

            var rows = Git.DiffRefs(root, first, Git.HeadCommit(root)!, "src");
            var ren = Assert.Single(rows, r => r.Kind == DiffKinds.Rename);
            Assert.Equal(from, ren.OldPath);
            Assert.Equal(to, ren.NewPath);
            Assert.True(ren.Identical);                 // content untouched, so -M scores it 100%
            Assert.Single(rows);                        // and it is ONE row, not a delete plus an add
        }
        finally { try { Directory.Delete(root, true); } catch { } }
    }

    [Fact]
    public void DiffWorktree_reports_the_real_path_for_a_non_ascii_file()
    {
        var root = RepoWithUmlautPath();
        try
        {
            File.AppendAllText(Path.Combine(root, "src", "Wärme", "FB_X.fb"), "// dirty\n");

            var rows = Git.DiffWorktree(root, Git.HeadCommit(root)!, "src");
            Assert.Contains(rows, r => r.Path == Umlaut);
            Assert.DoesNotContain(rows, r => r.Path.Contains('"') || r.Path.Contains("\\303"));
        }
        finally { try { Directory.Delete(root, true); } catch { } }
    }
}
