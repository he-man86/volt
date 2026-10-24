using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests.OneToOne;

/// <summary>
/// The shared steps of the bridge-one-to-one red tests (openspec <c>bridge-one-to-one</c> §2.2, the FakeIde layer): a
/// pull of one item as the shipped <c>fetch</c> answers it, a push through the shipped <c>PushService</c> (an update with
/// its <c>ifVersion</c>, or a create), and the property-line expectations every finding shares.
///
/// <para><b>The expected texts are the design's (§1.2)</b>, not the code's: <c>%CLASS</c> first, then <c>%FOLDER</c> (a
/// member's), then the keys in the grammar's order; directly under the object's <c>IMPLEMENTATION</c> line where it has
/// one, else closing its declaration.</para>
/// </summary>
internal static class OneToOneSteps
{
    /// <summary>The item's text as <c>volt pull</c> writes it (a directed fetch).</summary>
    public static string Pulled(FakeIde ide, string wire) =>
        FetchService.Handle(ide, new FetchRequest { OnlyItems = new() { wire } }).Changed.Single(i => i.Name == wire).SourceText;

    /// <summary>The pull's READ of one item, raising what the driver or the engine raises — a pull refusal names its item
    /// and reason here (the wire carries the name only, in <c>unreadable</c>).</summary>
    public static string Read(FakeIde ide, string bareName, string kind) =>
        Materializer.Materialize(ide, bareName, kind, new ItemRef(bareName)).Text;

    /// <summary>An update of <paramref name="wire"/> with <paramref name="text"/>, against the live version.</summary>
    public static PushResponse Update(FakeIde ide, string wire, string text)
    {
        var refs = RefsService.Handle(ide);
        ide.Recorded.Clear();
        return BoundWrite.Push(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new() { new SetItemOp { Name = wire, SourceText = text, IfVersion = refs.Items[wire] } },
        });
    }

    /// <summary>A create of <paramref name="wire"/> (absent from the project) with <paramref name="text"/>.</summary>
    public static PushResponse Create(FakeIde ide, string wire, string text, string folder = "")
    {
        var refs = RefsService.Handle(ide);
        ide.Recorded.Clear();
        return BoundWrite.Push(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new() { new SetItemOp { Name = folder.Length == 0 ? wire : $"{folder}/{wire}", SourceText = text, IfVersion = null } },
        });
    }

    public static string Why(PushResponse r) =>
        r.Conflicts is null ? "(no conflict)" : string.Join(" | ", r.Conflicts.Select(c => c.Reason));

    /// <summary>The push was REFUSED, and its reason names every one of <paramref name="names"/> — a refusal by name.</summary>
    public static void RefusedNaming(PushResponse r, params string[] names)
    {
        Assert.True(r.Refused().Count > 0, "the push was accepted; it must be refused by name");
        var why = Why(r);
        foreach (var n in names) Assert.Contains(n, why);
    }

    public static void AcceptedOk(PushResponse r) => Assert.True(r.Landed(), Why(r));

    /// <summary>The lines of <paramref name="text"/>, one per <c>\n</c>.</summary>
    public static string[] Lines(string text) => text.Replace("\r", "").Split('\n');

    /// <summary>The lines that directly follow the first line equal to <paramref name="anchor"/> (trimmed of trailing
    /// whitespace), as many as <paramref name="count"/>.</summary>
    public static string[] After(string text, string anchor, int count)
    {
        var lines = Lines(text);
        var at = Array.FindIndex(lines, l => l.TrimEnd() == anchor);
        Assert.True(at >= 0, $"no line '{anchor}' in:\n{text}");
        return lines.Skip(at + 1).Take(count).ToArray();
    }

    /// <summary>The lines that directly follow the LAST line equal to <paramref name="anchor"/>.</summary>
    public static string[] AfterLast(string text, string anchor, int count)
    {
        var lines = Lines(text);
        var at = Array.FindLastIndex(lines, l => l.TrimEnd() == anchor);
        Assert.True(at >= 0, $"no line '{anchor}' in:\n{text}");
        return lines.Skip(at + 1).Take(count).ToArray();
    }

    /// <summary>No line of <paramref name="text"/> opens with a property key — the stored declaration and body hold
    /// code only; a property line written INTO them would be compiled (or refused) by the IDE as code.</summary>
    public static void HoldsNoPropertyLine(string? text)
    {
        foreach (var l in Lines(text ?? ""))
            Assert.False(PropertyKeys.Any(k => l.StartsWith("%" + k, StringComparison.Ordinal)),
                $"a property line reached the IDE's text: '{l}'");
    }

    /// <summary>The closed key list of §1.2 (and FOLDER).</summary>
    public static readonly string[] PropertyKeys =
    {
        "CLASS", "FOLDER", "EXCLUDE_FROM_BUILD", "LINK_ALWAYS", "EXTERNAL", "ENABLE_SYSTEM_CALL", "ONLINE_CHANGE_RESERVE",
        "COMPILER_DEFINES", "UNDEFINE", "COMMENT", "PARAMETER_LIST", "NETVAR", "FILE_LINK",
    };

    /// <summary>Object properties with only the fields named set.</summary>
    public static ObjectProperties Props(
        ObjectClass? cls = null, bool exclude = false, bool linkAlways = false, bool external = false,
        bool systemCall = false, int reserve = 0, string? defines = null, string[]? undefines = null,
        string? comment = null, bool parameterList = false, NetVarSetting[]? netVar = null, FileLink? fileLink = null) =>
        new(cls, exclude, linkAlways, external, systemCall, reserve, defines, undefines ?? Array.Empty<string>(),
            comment, parameterList, netVar ?? Array.Empty<NetVarSetting>(), fileLink);
}
