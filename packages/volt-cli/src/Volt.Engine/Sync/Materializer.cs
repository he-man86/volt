using System;
using System.Collections.Generic;
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
            var build = BuildSource(ide, item, kind);
            var text = StWriter.Write(build);
            RefuseRetiredComment(name, text);
            return new WorkspaceItem(text, FullWireName(name, build.Kind), UnsupportedIn(build));
        }
        return new WorkspaceItem(ide.ReadManifest(item, kind), FullWireName(name, kind),
                                 Array.Empty<UnsupportedBody>());
    }

    /// <summary>A pulled file carries no <c>(* @volt-… *)</c> comment, and the push refuses one naming <c>volt pull</c>
    /// as the fix (<see cref="StReader.Read"/>). That fix is true only while the pull holds up its half: an IDE that
    /// ITSELF holds such a comment — an older Volt pushed its marker into a declaration or a body, which is how the
    /// retired markers were found in the first place — would be pulled verbatim, every push of the file refused, and
    /// every pull would write the same text straight back. So the item is refused here, naming the comment and the
    /// one fix that exists (an edit in the IDE); fetch lists it unreadable and leaves the workspace's file alone.
    /// The same rule as the push's, from the same definition (<see cref="ImplementationMarker.FindRetiredComment"/>).</summary>
    private static void RefuseRetiredComment(string name, string text)
    {
        if (ImplementationMarker.FindRetiredComment(text.Split('\n')) is not { } retired) return;
        throw new BridgeException(BridgeErrorCodes.Unsupported,
            $"'{name}' holds '{retired.Text}' in the IDE, a comment of a Volt from before bodies were stated by an " +
            $"{ImplementationMarker.Keyword} line. A workspace file cannot carry it (a push of one is refused), so " +
            "the item is not pulled until the comment is removed in the IDE.");
    }

    /// <summary>Every body of the item the driver read as <c>IMPLEMENTATION LD|FBD UNSUPPORTED</c>, with its reason —
    /// the one fact about the item its text does not carry, gathered here, where the content is in hand, for the pull
    /// message. A reason on a body that is NOT such a line, or such a line with no reason, is a driver that broke the
    /// pairing (<see cref="ItemContent.Unsupported"/>), and is refused rather than reported half.
    ///
    /// <para>A CFC, SFC or IL body is UNSUPPORTED too, and carries no reason: its line states the language, and "Volt
    /// does not read that language" is the whole reason. Only an LD/FBD body — a language Volt DOES read — needs the
    /// fact network text had no spelling for.</para></summary>
    private static IReadOnlyList<UnsupportedBody> UnsupportedIn(ItemContent content)
    {
        var found = new List<UnsupportedBody>();
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
            if (language is not null) found.Add(new UnsupportedBody { Member = member, Language = language, Reason = reason! });
        }
    }

    /// <summary>The name an item is known by ON THE WIRE — <c>name.ext</c> — from the BARE name the IDE holds.
    /// <b>The one place a full wire name is minted</b>: <c>VersionedItem.Identity</c>, and through it every
    /// <c>refs</c>/<c>fetch</c>/receipt map and every push gate, keys on what this returns.
    ///
    /// <para><b>A DUT is <c>X.dut</c></b>, whatever its shape (openspec <c>push-without-header-check</c> 5.P): the
    /// name is a pure function of the kind for every kind, so nothing here reads the item's text, its subtype or a
    /// vendor parse. A client writes the wire name as the file name.</para>
    ///
    /// <para>PRIVATE, and it stays that way: <see cref="Materialize"/> is the public path and every item goes
    /// through it, so a test has no reason to reach past it. Making this public to test it directly is what
    /// `NoTestOnlyCodeInSrcTests` exists to catch — and it did.</para></summary>
    private static string FullWireName(string bareName, string kind)
    {
        var ext = ItemKind.ExtFor(kind);
        return IsVerbatimKind(bareName, ext) ? bareName : $"{bareName}.{ext}";
    }

    private static bool IsVerbatimKind(string name, string ext) =>
        name.EndsWith("." + ext, StringComparison.OrdinalIgnoreCase);

    public static string Bare(string wireName)
    {
        var dot = wireName.LastIndexOf('.');
        return dot > 0 ? wireName.Substring(0, dot) : wireName;
    }

    /// <summary>An item's content, straight from the driver. <b>The engine no longer knows how it was
    /// obtained.</b>
    /// <para>This method used to be the split that decided it: items with a body or children went through
    /// <c>ReadXml</c> and a PLCopen parse, declaration-only kinds (DUT, GVL) through the declaration aspect.
    /// That split was a VENDOR limit wearing an engine decision — TwinCAT's <c>PlcOpenExport</c> rejects a DUT
    /// or GVL outright (<c>E_FAIL</c> for every one of them, because the export is POU-shaped and a DUT has no
    /// POU to name), so PLCopen could not be the single read transport while TwinCAT was supported. A driver
    /// that knows its own IDE picks per kind without the engine having to encode one vendor's refusal.</para></summary>
    private static ItemContent BuildSource(IIdeDriver ide, ItemRef item, string kind) => ide.ReadContent(item);
}
