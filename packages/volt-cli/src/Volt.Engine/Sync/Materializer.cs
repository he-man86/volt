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
            var build = BuildSource(ide, item, kind);
            RefuseMemberOfAnotherClass(name, build);
            var text = StWriter.Write(build);
            RefuseUnreadableBack(name, build, text);
            LogEndLineFallback(name, build);
            return new WorkspaceItem(text, FullWireName(name, build.Kind), UnsupportedIn(build));
        }
        return new WorkspaceItem(ide.ReadManifest(item, kind), FullWireName(name, kind),
                                 Array.Empty<UnsupportedBody>());
    }

    /// <summary>What a pull writes, a push reads back — WITH THE SAME MEMBERS. The IDE stores each member's text on its
    /// own; the push reads them back out of ONE file through the child splitter, which refuses a text it cannot split
    /// right (an END keyword after code on its line, text after an END keyword, a member keyword inside an open member).
    /// An IDE member whose stored text holds such a shape would be pulled into a file no push accepts, not even
    /// unchanged — and a comment one member leaves open and another closes reads as ONE comment in the file, swallowing
    /// the member between them, which the next push deletes. So the pull reads its own text back through the splitter
    /// (<see cref="StReader.SplitMembers"/> — the split alone, not what a body holds) and refuses the item unless it
    /// gets every member back as itself (kind and name): listed unreadable, the workspace file left alone (openspec
    /// <c>push-without-header-check</c> 5.E.1). 0 such items in the six corpora.</summary>
    private static void RefuseUnreadableBack(string name, ItemContent pulled, string text)
    {
        IReadOnlyList<Member> back;
        try { back = StReader.SplitMembers(text, pulled.Kind, name); }
        catch (BridgeException ex)
        {
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"'{name}': the file a pull would write does not read back on a push ({ex.Message}), so the item is not " +
                "pulled until its text is changed in the IDE.");
        }
        var got = back.Select(Label).ToList();
        foreach (var m in pulled.Members)
        {
            if (got.Remove(Label(m))) continue;
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"'{name}': its {Label(m)} does not read back from the file a pull would write (read back: " +
                $"{(back.Count == 0 ? "no members" : string.Join(", ", back.Select(Label)))}) — a comment " +
                "one member leaves open and another closes is one comment in the file. A push of it would delete that " +
                "member, so the item is not pulled until its text is changed in the IDE.");
        }
        if (got.Count > 0)
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"'{name}': the file a pull would write reads back with {string.Join(", ", got)}, which the IDE does not " +
                "hold, so the item is not pulled until its text is changed in the IDE.");

        static string Label(Member m) => $"{m.Kind.Replace('_', ' ')} '{m.Name}'";
    }

    /// <summary>A member's KIND is its CLASS — the driver reports it from the IDE object (a method, a property, an
    /// action), never from its text — and the file must say the same, because the push reads a member's kind from the
    /// keyword that opens its block (<see cref="StReader.MemberHeaderKeyword"/>). CODESYS stores whatever text a method
    /// is given and keeps it a method (DIALECT C2l): one holding <c>PROPERTY</c> text pulled verbatim would come back on
    /// the next push as a property — the method deleted and a property created (<c>PushService.ReconcileMembers</c>,
    /// a member whose kind changed), under a push that changed nothing. So the item is refused here, as
    /// <see cref="RefuseUnreadableBack"/> refuses a text no push can split back: listed unreadable, the workspace file left
    /// alone, the reason naming the member, its class and the keyword its text opens with (openspec
    /// <c>push-without-header-check</c> 5.Q.5, M-a). An action carries no declaration of its own (its <c>ACTION</c> line
    /// is written from its class), and a declaration with no code opens with no keyword to disagree.</summary>
    private static void RefuseMemberOfAnotherClass(string name, ItemContent content)
    {
        foreach (var m in content.Members)
        {
            var expected = StReader.MemberKeywordFor(m.Kind);
            if (expected is null || StReader.MemberHeaderKeyword(m.Declaration) is not { } opens || opens == expected) continue;
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"'{name}': its {m.Kind.Replace('_', ' ')} '{m.Name}' holds text that opens with '{opens}', not {expected}. " +
                $"A member's kind is its class in the IDE, and a file opening the member with '{opens}' would be read back " +
                $"by a push as another kind of member (the {m.Kind.Replace('_', ' ')} deleted and another created), so the " +
                $"item is not pulled until the member's text opens with {expected} in the IDE.");
        }
    }

    /// <summary>Count the ONE END-line fallback (<see cref="StWriter.FallbackPouHeader"/>): a POU whose declaration
    /// opens with no PROGRAM / FUNCTION_BLOCK / FUNCTION was closed with <c>END_FUNCTION_BLOCK</c>. Logged per item,
    /// so the fallback is never silent; it fires for no POU a vendor compiles.</summary>
    private static void LogEndLineFallback(string name, ItemContent content)
    {
        if (content.Kind != ItemKind.Kinds.Pou || StReader.PouHeaderKeyword(content.Declaration) is not null) return;
        VoltLog.Info($"pull: '{name}' — its declaration opens with no PROGRAM / FUNCTION_BLOCK / FUNCTION, so its file " +
                     $"closes with the fallback END_{StWriter.FallbackPouHeader} (counted fallback, push-without-header-check 5.Q.3)");
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
