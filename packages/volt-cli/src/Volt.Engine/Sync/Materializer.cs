using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Ide;
using Volt.Engine.Library;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.St;
using Volt.Engine.Seam;

namespace Volt.Engine.Sync;

public static class Materializer
{
    /// <summary>An item as its workspace file: a SOURCE kind's content written by the format its row names (which refuses
    /// what a pull must not write, naming the item), any other kind's manifest as the host renders it.</summary>
    public static WorkspaceItem Materialize(HostLink link, string name, string kind, ItemRef item)
    {
        var kinds = link.Catalog.Kinds;
        if (kinds.Find(kind) is { Role: KindRole.Source, Format: { } format })
        {
            var content = link.Driver.Read(item);
            return new WorkspaceItem(format.Write(content, name), FullWireName(name, content.Kind, kinds), HiddenIn(link, content));
        }
        return new WorkspaceItem(link.Driver.ReadManifest(item, kind), FullWireName(name, kind, kinds), Array.Empty<HiddenBody>());
    }

    /// <summary>Every body of the item the host read as HIDDEN (<c>%LANGUAGE &lt;LANG&gt; UNSUPPORTED</c>), with its
    /// reason for one in a language this host SHOWS — the one fact about the item its text does not carry in full,
    /// gathered here, where the content is in hand, for the pull message and for <c>grep</c>'s <c>notSearched</c>. A
    /// hidden body of a shown language with no reason, or one of another language with one, is a host that broke the
    /// pairing (<see cref="BodyText.Why"/>), and is refused rather than reported half.
    ///
    /// <para>A body in a language the host never shows (CFC, SFC, IL) carries no reason: its line states the language, and
    /// "Volt does not read that language" is the whole reason. Only a body in a language Volt DOES read needs the fact its
    /// reader had no spelling for.</para></summary>
    private static IReadOnlyList<HiddenBody> HiddenIn(HostLink link, Content content)
    {
        var found = new List<HiddenBody>();
        Add(null, content.Body);
        foreach (var m in content.Members)
        {
            Add(m.Name, m.Body);
            Add($"{m.Name} GET", m.Get?.Body);
            Add($"{m.Name} SET", m.Set?.Body);
        }
        return found;

        void Add(string? member, BodyText? body)
        {
            if (body is not { Form: BodyForm.Hidden } hidden) return;
            var reason = string.IsNullOrEmpty(hidden.Why) ? null : hidden.Why;
            if (link.Catalog.Languages.IsShown(hidden.Language, link.Driver.Vendor) != (reason is not null))
                throw new VoltInvariantException(
                    $"the driver read {(member is null ? "the item's body" : $"'{member}'")} as '{LanguageLine.For(hidden)}' with " +
                    $"{(reason is null ? "no reason" : $"the reason '{reason}'")} — an UNSUPPORTED body and its reason come together");
            found.Add(new HiddenBody(member, hidden.Language, reason));
        }
    }

    /// <summary>The name an item is known by ON THE WIRE — <c>name.ext</c> — from the BARE name the IDE holds.
    /// <b>The one place a full wire name is minted</b>: <c>Versioning.PathOf</c> builds every item path from it, and
    /// through it every <c>refs</c>/<c>fetch</c>/receipt map, every <c>unreadable</c> entry and every push gate keys on
    /// what this returns.
    ///
    /// <para>The wire name is the IDE's name plus its kind's extension, kept as is when the IDE's name already ends in
    /// exactly that extension (<see cref="IsVerbatimKind"/>). <b>A DUT is <c>X.dut</c></b>, whatever its shape (openspec
    /// <c>push-without-header-check</c> 5.P): the extension is a pure function of the kind, so nothing here reads the
    /// item's text, its subtype or a vendor parse. A client writes the wire name as the file name; the push's lookup
    /// (<c>TreeLookup</c>, through <c>Versioning.FileOf</c>) is this function's inverse.</para>
    ///
    /// <para>Internal, never public: <c>Versioning</c> is the one caller, and a test reaches it through the read
    /// ops (`NoTestOnlyCodeInSrcTests`).</para></summary>
    internal static string FullWireName(string bareName, string kind, KindRegistry kinds) =>
        WithExtension(bareName, kinds.ExtensionOf(kind));

    private static string WithExtension(string bareName, string ext) =>
        IsVerbatimKind(bareName, ext) ? bareName : $"{bareName}.{ext}";

    /// <summary>The IDE's name already ends in the kind's extension, so it is the wire name as is: TwinCAT names the
    /// module description by its file (<c>Untitled2.tmc</c>, measured — <c>TcSolutionExplorer</c>), and a library ref
    /// spelled <c>Foo.library</c> is not doubled (<c>WireIdentityTests</c>). Ordinal: the extension is read back to its
    /// kind case-sensitively, so only the kind's own spelling is kept (<c>Std.LIBRARY</c> is <c>Std.LIBRARY.library</c>).</summary>
    private static bool IsVerbatimKind(string name, string ext) =>
        name.EndsWith("." + ext, StringComparison.Ordinal);

    public static string Bare(string wireName)
    {
        var dot = wireName.LastIndexOf('.');
        return dot > 0 ? wireName.Substring(0, dot) : wireName;
    }
}
