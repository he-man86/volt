using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Ide;
using Volt.Engine.Library;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.St;

namespace Volt.Engine.Sync;

public static class Materializer
{
    public static WorkspaceItem Materialize(IIdeDriver ide, string name, string kind, ItemRef item)
    {
        if (ItemKind.IsSourceKind(kind))
        {
            // Folded (openspec `abstract-member-parity`, `AbstractMemberFold`): an ABSTRACT member with no code reads
            // `IMPLEMENTATION NONE` on both vendors whoever made the object, so the fetched text, the refs walk and every
            // version hash it feeds are one text for one declaration.
            var build = AbstractMemberFold.Apply(ide.ReadContent(item));
            // The file is the IEC layout's (IecFormat), which refuses what a pull must not write, naming the item.
            var text = IecFormat.Instance.Write(FamilyContent.ToContent(build), name);
            return new WorkspaceItem(text, FullWireName(name, build.Kind), HiddenIn(build));
        }
        return new WorkspaceItem(ide.ReadManifest(item, kind), FullWireName(name, kind), Array.Empty<HiddenBody>());
    }

    /// <summary>Every body of the item the driver read as <c>IMPLEMENTATION &lt;LANG&gt; UNSUPPORTED</c>, with its reason
    /// for an LD/FBD one — the one fact about the item its text does not carry in full, gathered here, where the content
    /// is in hand, for the pull message and for <c>grep</c>'s <c>notSearched</c>. A reason on a body that is NOT such an
    /// LD/FBD line, or such a line with no reason, is a driver that broke the pairing (<see cref="ItemContent.Unsupported"/>),
    /// and is refused rather than reported half.
    ///
    /// <para>A CFC, SFC or IL body carries no reason: its line states the language, and "Volt does not read that
    /// language" is the whole reason. Only an LD/FBD body — a language Volt DOES read — needs the fact network text had
    /// no spelling for.</para></summary>
    private static IReadOnlyList<HiddenBody> HiddenIn(ItemContent content)
    {
        var found = new List<HiddenBody>();
        Add(null, content.Body, content.Unsupported);
        foreach (var m in content.Members)
        {
            Add(m.Name, m.Body, m.Unsupported);
            Add($"{m.Name} GET", m.Getter?.Body, m.Getter?.Unsupported);
            Add($"{m.Name} SET", m.Setter?.Body, m.Setter?.Unsupported);
        }
        return found;

        void Add(string? member, string? body, string? reason)
        {
            var hidden = ImplementationMarker.UnsupportedLanguageOf(body);
            var language = hidden is not null && Languages.IsNetwork(hidden) ? hidden : null;
            if ((language is null) != (reason is null))
                throw new InvalidOperationException(
                    $"the driver read {(member is null ? "the item's body" : $"'{member}'")} as '{body?.Trim()}' with " +
                    $"{(reason is null ? "no reason" : $"the reason '{reason}'")} — an UNSUPPORTED body and its reason come together");
            if (hidden is not null) found.Add(new HiddenBody(member, hidden, reason));
        }
    }

    /// <summary>The name an item is known by ON THE WIRE — <c>name.ext</c> — from the BARE name the IDE holds.
    /// <b>The one place a full wire name is minted</b>: <c>Versioning.PathOf</c> builds every item path from it, and
    /// through it every <c>refs</c>/<c>fetch</c>/receipt map, every <c>unreadable</c> entry and every push gate keys on
    /// what this returns.
    ///
    /// <para><b>A DUT is <c>X.dut</c></b>, whatever its shape (openspec <c>push-without-header-check</c> 5.P): the
    /// name is a pure function of the kind for every kind, so nothing here reads the item's text, its subtype or a
    /// vendor parse. A client writes the wire name as the file name.</para>
    ///
    /// <para>Internal, never public: <c>Versioning.PathOf</c> is the one caller, and a test reaches it through the read
    /// ops (`NoTestOnlyCodeInSrcTests`).</para></summary>
    internal static string FullWireName(string bareName, string kind)
    {
        var ext = ItemKind.ExtFor(kind);
        return IsVerbatimKind(bareName, ext) ? bareName : $"{bareName}.{ext}";
    }

    /// <summary>The IDE's name already ends in the kind's extension, so it is the wire name as is: TwinCAT names the
    /// module description by its file (<c>Untitled2.tmc</c>, measured — <c>TcSolutionExplorer</c>), and a library ref
    /// spelled <c>Foo.library</c> is not doubled (<c>WireIdentityTests</c>).</summary>
    private static bool IsVerbatimKind(string name, string ext) =>
        name.EndsWith("." + ext, StringComparison.OrdinalIgnoreCase);

    public static string Bare(string wireName)
    {
        var dot = wireName.LastIndexOf('.');
        return dot > 0 ? wireName.Substring(0, dot) : wireName;
    }
}
