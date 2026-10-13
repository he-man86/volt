using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Xunit;

namespace Volt.Repo.Gates;

/// <summary>
/// EVERY FIELD OF A `.task` FILE REACHES THE VENDOR — or the build says which one does not.
///
/// <para><b>The failure this exists for is silent by construction.</b> <c>TaskSettings</c> is the whole content
/// of a `.task` file, and a driver's task write is a list of assignments. Leave one out and nothing fails:
/// the parse succeeds, the write succeeds, the push reports success, and the task simply keeps whatever the
/// target project had. `EdgePcTask` migrated out of pro2193 as <c>Freewheeling</c> where its file said
/// <c>Cyclic</c> — a task running flat out instead of on a cycle — because <c>kind_of_task</c> was the one
/// member CODESYS's <c>WriteTask</c> never set. No test could have caught it: the engine hands the driver a
/// complete <c>TaskSettings</c> either way, so every offline double sees a correct call.</para>
///
/// <para><b>Which makes this a gate on the SOURCE, deliberately.</b> It cannot be a behaviour test, because the
/// behaviour is only observable against a live IDE — which is exactly the condition under which a field goes
/// missing for months. So it reads the record's own property list and asks each driver's write path to mention
/// every one of them. Adding a field to <c>TaskSettings</c> without teaching both drivers to write it fails
/// here, on a build agent, with the field's name in the message.</para>
///
/// <para><b>What "mention" means, and why that is enough.</b> A name appearing in the write path does not prove
/// it is written correctly — that is what the live e2e suite and the corpus migration are for. It proves the
/// author SAW the field. Every real instance of this bug has been an omission, never a wrong assignment, and a
/// gate that catches omissions cheaply is worth more than one that catches nothing because it was too hard to
/// write. A field a vendor cannot express is declared below rather than ignored.</para>
/// </summary>
public class TaskSettingsAreFullyWrittenTests
{
    /// <summary>Where each vendor turns a <see cref="Volt.Engine.Format.Task.TaskSettings"/> into vendor calls.
    /// These are SOURCE paths, not types: the gate has no ProjectReference, by design (see the project file).</summary>
    /// <summary>Where each vendor turns a <c>TaskSettings</c> into vendor calls, and the METHOD that does it.
    /// A whole file is far too coarse a haystack — "Type" occurs in `GetType`, in `TaskDescriptor`, in a dozen
    /// doc comments — so a file-wide substring search passed happily while `kind_of_task` was missing. The
    /// search is scoped to the named method's body, and looks for the field as a MEMBER ACCESS
    /// (<c>.Priority</c>), which is the only way a write can actually reach it.
    ///
    /// <para>TwinCAT's write is split by the vendor's own shape (DIALECT C19b): the schedule is patched onto
    /// the SYSTEM task by <c>TcTaskSchedule.SysTaskPatch</c>, the call list onto the PLC item by
    /// <c>TcObjectModel.WriteTask</c>. Both bodies are searched as one haystack.</para></summary>
    private static readonly IReadOnlyDictionary<string, (string File, string Method)[]> WritePaths =
        new Dictionary<string, (string, string)[]>(StringComparer.Ordinal)
        {
            ["CODESYS"] = new[] { ("src/Volt.Ide.Codesys/Ide/CodesysObjectModel.Task.cs", "public void WriteTask") },
            ["TwinCAT"] = new[]
            {
                ("src/Volt.Ide.Twincat/Ide/TcTaskSchedule.cs", "public static string SysTaskPatch"),
                ("src/Volt.Ide.Twincat/Ide/TcObjectModel.Task.cs", "public void WriteTask"),
            },
        };

    [Fact]
    public void Every_TaskSettings_field_is_named_in_every_vendors_task_write()
    {
        var fields = TaskSettingsFields();
        Assert.True(fields.Count >= 6,
            $"only {fields.Count} field(s) parsed out of the TaskSettings record — the gate has lost its grip " +
            "on the declaration and would pass vacuously");

        var missing = new List<string>();
        foreach (var (vendor, paths) in WritePaths)
        {
            var source = string.Concat(paths.Select(x => MethodBody(RepoFile(x.File), x.Method)));
            foreach (var field in fields)
            {
                if (source.Contains("." + field, StringComparison.Ordinal)) continue;
                missing.Add(
                    $"{vendor}: TaskSettings.{field} is never read in its task write - a `.task` file " +
                    "carrying that field would be accepted and silently ignored. Write it, or REFUSE it by " +
                    "name the way TcTaskSchedule refuses `Type: Freewheeling`.");
            }
        }

        Assert.True(missing.Count == 0, string.Join("\n", missing));
    }

    /// <summary>The positional-record parameter names of <c>TaskSettings</c>, read out of its declaration.
    /// Reading the SOURCE rather than hard-coding the list is the point: a field added tomorrow is covered
    /// without anyone remembering this file exists.</summary>
    private static List<string> TaskSettingsFields()
    {
        var source = File.ReadAllText(RepoFile("src/Volt.Engine/Format/Task/TaskDescriptorFormat.cs"));
        var start = source.IndexOf("record TaskSettings(", StringComparison.Ordinal);
        Assert.True(start >= 0, "TaskSettings is no longer a positional record — this gate needs rewriting");

        var open = source.IndexOf('(', start);
        var depth = 0;
        var end = -1;
        for (var i = open; i < source.Length; i++)
        {
            if (source[i] == '(') depth++;
            else if (source[i] == ')' && --depth == 0) { end = i; break; }
        }
        Assert.True(end > open, "unbalanced parentheses in the TaskSettings declaration");

        // Split the parameter list on top-level commas — `IReadOnlyList<string>` must not be cut in half — and
        // take each parameter's NAME, which is its last whitespace-separated token.
        var names = new List<string>();
        var angle = 0;
        var current = new System.Text.StringBuilder();
        foreach (var c in source.Substring(open + 1, end - open - 1))
        {
            if (c == '<') angle++;
            else if (c == '>') angle--;
            if (c == ',' && angle == 0) { names.Add(NameOf(current.ToString())); current.Clear(); }
            else current.Append(c);
        }
        names.Add(NameOf(current.ToString()));
        return names.Where(n => n.Length > 0).ToList();
    }

    private static string NameOf(string parameter)
    {
        // A parameter with a default (`string? ExternalEvent = null`) is named before its `=`.
        var eq = parameter.IndexOf('=');
        if (eq >= 0) parameter = parameter.Substring(0, eq);
        var tokens = parameter.Split((char[])null, StringSplitOptions.RemoveEmptyEntries);
        return tokens.Length == 0 ? "" : tokens[tokens.Length - 1];
    }

    /// <summary>One method's body, by brace matching from its signature. Scoping the search this tightly is
    /// the difference between a gate and a decoration: with the whole file as the haystack this test passed
    /// while the very bug it exists for was present.</summary>
    private static string MethodBody(string file, string signature)
    {
        var source = File.ReadAllText(file);
        var at = source.IndexOf(signature, StringComparison.Ordinal);
        Assert.True(at >= 0, $"'{signature}' is gone from {file} - this gate is pointing at nothing");

        var open = source.IndexOf('{', at);
        Assert.True(open > 0, $"no body found for '{signature}' in {file}");

        var depth = 0;
        for (var i = open; i < source.Length; i++)
        {
            if (source[i] == '{') depth++;
            else if (source[i] == '}' && --depth == 0) return source.Substring(open, i - open + 1);
        }

        Assert.Fail($"unbalanced braces after '{signature}' in {file}");
        return "";
    }

    private static string RepoFile(string relative) =>
        Path.Combine(PackageRoot(), relative.Replace('/', Path.DirectorySeparatorChar));

    /// <summary>Walk up from the test binary to the `volt-cli` package root.</summary>
    private static string PackageRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !File.Exists(Path.Combine(dir.FullName, "Volt.sln"))) dir = dir.Parent;
        Assert.NotNull(dir);
        return dir!.FullName;
    }
}
