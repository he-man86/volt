using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;

namespace Volt.Engine.Format.Network;

/// <summary>What a push does to one network (<see cref="NetworkPairing.Plan(IReadOnlyList{NetworkKey}, IReadOnlyList{NetworkKey})"/>).</summary>
public enum NetworkStep
{
    /// <summary>The live network's text is the pushed one: the vendor object is not touched.</summary>
    Keep,
    /// <summary>A live network rewritten in its own slot from a pushed one: its header, and its trees where they changed.</summary>
    Rebuild,
    /// <summary>A pushed network with no live slot: built and inserted at its position.</summary>
    Insert,
    /// <summary>A live network nothing pushed pairs with: removed (the engineer deleted it).</summary>
    Remove,
}

/// <summary>One step of a push's network plan. <see cref="Live"/> is the network's index in the IDE's list before the
/// push (none for an <see cref="NetworkStep.Insert"/>), <see cref="Pushed"/> its index in the pushed body (none for a
/// <see cref="NetworkStep.Remove"/>).</summary>
public readonly record struct NetworkMove(NetworkStep Step, int? Live, int? Pushed);

/// <summary>A network as the pairing compares it: its whole text (<see cref="Text"/>, header included) and the text of
/// its trees alone (<see cref="Trees"/>, the header blanked). Null where the network has no text — a pushed model the
/// writer cannot spell, which pairs with nothing and is refused by name where it is written. <see cref="Unshown"/>: a
/// LIVE network the pull shows as its <c>UNSUPPORTED</c> line — its header can be edited in place, but it is never
/// rebuilt from other trees, since nothing of it is in the text to rebuild from (gate 1b-4).</summary>
public readonly record struct NetworkKey(string? Text, string? Trees, bool Unshown = false);

/// <summary>
/// THE PUSH'S NETWORK PAIRING (openspec <c>ld-fbd-coverage</c> 1b.4): the live networks and the pushed ones are aligned by
/// their TEXT, in order, never by position — so a network whose text the engineer did not change stays exactly as the IDE
/// holds it, wherever a network was inserted or removed before it, and only a network that changed is rebuilt.
///
/// <para><b>How.</b> Each live network is rendered through the pull path (<see cref="Render"/>, the text the file shows:
/// headers carry no number, so a render is position-free), each pushed one strictly (<see cref="RenderPushed"/>). The two
/// lists are aligned in order, at the least cost of what the push then does: a network whose whole text is equal is KEPT
/// (free); one rewritten in its own slot costs little when only its header changed (a title, a comment, DISABLED — its
/// trees are kept) and a full rebuild otherwise; a removal costs less than a rebuild, an insertion — a network built from
/// nothing — as much. Equal costs take the earliest pairing.</para>
///
/// <para><b>Why a cost and not the longest common subsequence of exact texts</b> (design 1b.4 as first written; measured
/// on the TwinCAT fixture <c>POU_PBD</c>, whose two networks hold the SAME rung, one disabled): flipping DISABLED on both
/// makes network 1's new text network 2's old one, so the plain LCS kept network 2 for network 1 and rebuilt a copy of it
/// from nothing (removing network 1) — where two header edits in place keep both. Every case the design names comes out as
/// the LCS: equal texts are kept, an inserted network is inserted, a removed one removed, and a network whose trees
/// changed is rebuilt in its slot.</para>
///
/// <para><b>Rejected</b> (design 1b.4): positional pairing — an inserted or removed network shifted every later one into
/// "changed", so an untouched network the push cannot build (S4, an N21 comparison) was refused and every shifted one
/// rebuilt, dropping its IDE-held members; a network id spelled in the text — TwinCAT re-mints ids on a rebuild and a
/// copied network duplicates one; pairing by title or label — mostly empty, not unique.</para>
/// </summary>
public static class NetworkPairing
{
    // The costs of what each step makes the push do. Only their ORDER matters: keep < header edit < removal < rebuild =
    // insertion, and a removal plus an insertion (a network moved) costs more than one rebuild in place.
    private const int HeaderEdit = 1, RemoveCost = 5, BuildCost = 15;
    // A live UNSUPPORTED network paired with other trees: dearer than removing it and building the pushed one, so the
    // plan never rewrites it in its slot (that rewrite destroyed what the line stands for, with no refusal on the way —
    // gate 1b-4); the removal plus insertion it plans instead is judged by RefuseUnseenLoss.
    private const int Unpairable = RemoveCost + BuildCost + 1;

    /// <summary>The plan for the live networks and the pushed ones, by text (see the class summary).</summary>
    public static IReadOnlyList<NetworkMove> Plan(IReadOnlyList<Network> live, IReadOnlyList<Network> pushed,
                                                  BodyLanguage language, NetworkScope scope) =>
        Plan(live.Select(n => new NetworkKey(Render(n, language, scope), Render(Headless(n), language, scope),
                                             ShownAs(n, language, scope) is not null)).ToList(),
             pushed.Select(n => KeyOfPushed(n, language, scope)).ToList());

    /// <summary>The plan, in the pushed body's order: each pushed network is one <see cref="NetworkStep.Keep"/>,
    /// <see cref="NetworkStep.Rebuild"/> or <see cref="NetworkStep.Insert"/>, and every live network not kept or rebuilt
    /// is one <see cref="NetworkStep.Remove"/>, listed where it stood.</summary>
    public static IReadOnlyList<NetworkMove> Plan(IReadOnlyList<NetworkKey> live, IReadOnlyList<NetworkKey> pushed)
    {
        if (live is null) throw new ArgumentNullException(nameof(live));
        if (pushed is null) throw new ArgumentNullException(nameof(pushed));
        int n = live.Count, m = pushed.Count;

        // cost[i, j]: the least cost of aligning live[i..] with pushed[j..].
        var cost = new int[n + 1, m + 1];
        for (var i = n; i >= 0; i--)
            for (var j = m; j >= 0; j--)
            {
                if (i == n && j == m) continue;
                var best = int.MaxValue;
                if (i < n && j < m) best = Math.Min(best, Pair(live[i], pushed[j]) + cost[i + 1, j + 1]);
                if (i < n) best = Math.Min(best, RemoveCost + cost[i + 1, j]);
                if (j < m) best = Math.Min(best, BuildCost + cost[i, j + 1]);
                cost[i, j] = best;
            }

        // Forward, taking the earliest step that keeps the least cost: a pairing first, then a removal, then an insertion.
        var plan = new List<NetworkMove>();
        {
            int i = 0, j = 0;
            while (i < n || j < m)
            {
                if (i < n && j < m && cost[i, j] == Pair(live[i], pushed[j]) + cost[i + 1, j + 1])
                {
                    plan.Add(new NetworkMove(Same(live[i].Text, pushed[j].Text) ? NetworkStep.Keep : NetworkStep.Rebuild, i, j));
                    i++; j++;
                }
                else if (i < n && cost[i, j] == RemoveCost + cost[i + 1, j]) { plan.Add(new NetworkMove(NetworkStep.Remove, i, null)); i++; }
                else { plan.Add(new NetworkMove(NetworkStep.Insert, null, j)); j++; }
            }
        }
        return plan;
    }

    private static int Pair(NetworkKey live, NetworkKey pushed) =>
        Same(live.Text, pushed.Text) ? 0 : Same(live.Trees, pushed.Trees) ? HeaderEdit : live.Unshown ? Unpairable : BuildCost;

    private static bool Same(string? a, string? b) => a is not null && b is not null && string.Equals(a, b, StringComparison.Ordinal);

    private static NetworkKey KeyOfPushed(Network n, BodyLanguage language, NetworkScope scope)
    {
        // A pushed model the writer cannot spell came from no text; it pairs with nothing, and its write refuses it by name.
        try { return new NetworkKey(RenderPushed(n, language, scope), RenderPushed(Headless(n), language, scope)); }
        catch (NetworkUnrepresentableException) { return new NetworkKey(null, null); }
    }

    /// <summary>The shape a LIVE network is shown as on pull (<c>UNSUPPORTED "&lt;shape&gt;"</c>), or null when the text
    /// spells its trees: a reader's refusal (<see cref="Network.Unsupported"/>) or the strict writer's.</summary>
    private static string? ShownAs(Network live, BodyLanguage language, NetworkScope scope)
    {
        if (live.Unsupported is { } read) return read;
        try { RenderPushed(live, language, scope); return null; }
        catch (NetworkUnrepresentableException e) { return e.Reason; }
    }

    /// <summary>
    /// NO PUSH ERASES WHAT THE TEXT DOES NOT SHOW (gate 1b-4) — the one rule both drivers apply to a plan before the list
    /// changes. A live network holds content the text does not show when the pull shows it as its <c>UNSUPPORTED</c> line,
    /// or when an operand of it holds a symbol comment (<see cref="NetworkText.SymbolCommentOperands"/>). Such a network
    /// may be kept, its header edited, rebuilt in its slot (the driver's own refusals judge that) or DELETED — the diff
    /// shows a deletion. Refused, by name:
    /// <list type="bullet">
    /// <item>its removal in a push that also INSERTS a network: pairing by text cannot tell a deleted network from one
    /// moved, or one whose <c>UNSUPPORTED</c> line was replaced under the same header, and the inserted network, built
    /// from the text, would not carry what the live one held (a move was two positional rebuilds before 1b.4, which the
    /// symbol-comment refusal caught);</item>
    /// <item>its removal while another live network that stays shows the SAME text: which of the two the engineer
    /// deleted is not in the text, and the equal-cost tie-break would guess.</item>
    /// </list>
    /// </summary>
    public static void RefuseUnseenLoss(string vendor, IReadOnlyList<Network> live, IReadOnlyList<NetworkMove> plan,
                                        BodyLanguage language, NetworkScope scope)
    {
        if (live is null) throw new ArgumentNullException(nameof(live));
        if (plan is null) throw new ArgumentNullException(nameof(plan));
        var removed = plan.Where(m => m.Step == NetworkStep.Remove).Select(m => m.Live!.Value).OrderBy(i => i, Comparer<int>.Default).ToList();
        if (removed.Count == 0) return;
        var unseen = live.Select(n => Unseen(n, language, scope)).ToList();
        var inserts = plan.Any(m => m.Step == NetworkStep.Insert);
        var texts = live.Select(n => Render(n, language, scope)).ToList();
        foreach (var r in removed)
        {
            if (inserts && unseen[r] is { } held)
                throw new NetworkTextException(
                    $"{vendor}: network {r + 1} holds what the text does not show ({held}), and this push removes it while " +
                    "it inserts another network. Volt pairs networks by their text, so it cannot tell a deleted network " +
                    "from one that was moved or rewritten, and a network built from the text would not carry what this " +
                    "one holds. Delete this network in a push of its own, or move or edit it in the IDE.",
                    ConflictCodes.NetworkUnsupported);
            for (var k = 0; k < live.Count; k++)
            {
                if (k == r || removed.Contains(k) || !string.Equals(texts[k], texts[r], StringComparison.Ordinal)) continue;
                if ((unseen[r] ?? unseen[k]) is not { } twin) continue;
                throw new NetworkTextException(
                    $"{vendor}: networks {Math.Min(r, k) + 1} and {Math.Max(r, k) + 1} show the same text, and one of them " +
                    $"holds what the text does not show ({twin}); this push deletes one of the two, and which one is not " +
                    "in the text. Delete it in the IDE.",
                    ConflictCodes.NetworkUnsupported);
            }
        }
    }

    /// <summary>What a live network holds that its text does not show, in words, or null.</summary>
    private static string? Unseen(Network live, BodyLanguage language, NetworkScope scope)
    {
        if (ShownAs(live, language, scope) is { } shape) return $"it is shown as `UNSUPPORTED \"{shape}\"`";
        var comments = NetworkText.SymbolCommentOperands(live);
        return comments.Count == 0 ? null : $"a symbol comment on {string.Join(", ", comments)}";
    }

    private static Network Headless(Network n) => n with { Title = null, Label = null, Comment = null, Disabled = false };

    /// <summary>A network's text as a pull shows it, without its position: what <see cref="Plan(IReadOnlyList{Network}, IReadOnlyList{Network}, BodyLanguage, NetworkScope)"/>
    /// pairs a LIVE network by. One the text cannot spell renders as its <c>UNSUPPORTED</c> line
    /// (<see cref="NetworkTextWriter.WritePulled"/>), so it pairs with that line pushed back unchanged and with nothing
    /// else. Throws what the pull would: a network whose header the text cannot carry hides the whole body on pull, so no
    /// pushed text can be its pair.</summary>
    public static string Render(Network network, BodyLanguage language, NetworkScope scope) =>
        NetworkTextWriter.WritePulled(new NetworkBody(language, new[] { network with { Order = 0 } }), scope);

    /// <summary>A PUSHED network's text, without its position — STRICT (<see cref="NetworkTextWriter.Write"/>): the model
    /// came from the engineer's text through the push gate, so the writer spells every fact of it, and one it would not
    /// is refused by name rather than rendered as an UNSUPPORTED line it never was (and then built without the fact).</summary>
    public static string RenderPushed(Network network, BodyLanguage language, NetworkScope scope) =>
        NetworkTextWriter.Write(new NetworkBody(language, new[] { network with { Order = 0 } }), scope);

    /// <summary>
    /// THE REFUSAL OF A PUSHED <c>UNSUPPORTED</c> LINE THAT PAIRS WITH NO LIVE NETWORK — the one rule both drivers apply
    /// before they build a network (a rebuild or an insertion). The line stands for content Volt cannot show; it can be
    /// kept where the IDE holds it (pushed back unchanged, <see cref="NetworkStep.Keep"/>, its header editable) or deleted
    /// with its network, but it cannot be BUILT: there is nothing in it to build from. An edited, moved-into-another-network
    /// or copied line is that.
    /// </summary>
    public static void RefuseUnpairedUnsupported(string vendor, Network pushed)
    {
        if (pushed.Unsupported is not { } shape) return;
        throw new NetworkTextException(
            $"{vendor}: network {pushed.Order + 1} is the line `UNSUPPORTED \"{shape}\"`, and no network the IDE holds is " +
            "that network with that text, so there is nothing to keep — and the line holds nothing to build the network " +
            "from. Push the network's line unchanged where it stands (it is kept as the IDE holds it), delete the whole " +
            "network, or edit it in the IDE.",
            ConflictCodes.NetworkUnsupported);
    }

    /// <summary>The boxes of <paramref name="network"/> read through a named FB output whose SLOT no one has stated
    /// (<see cref="Box.MainOutputName"/> with no <see cref="Box.ConnectedSlot"/>): a text read names the output, and the slot
    /// is the FB's declaration's — derived on push where the declarations state it (<see cref="NetworkDerivation"/>). A box
    /// left without one cannot be built: the consumer would read another output than the text names.</summary>
    public static IEnumerable<(Box Box, string Output)> NamedMainOutputs(Network network) =>
        network.Trees.SelectMany(Walk).OfType<Box>()
            .Where(b => b.MainOutputName is not null && b.ConnectedSlot is null)
            .Select(b => (b, b.MainOutputName!));

    private static IEnumerable<Node> Walk(Node n) => new[] { n }.Concat(n.Children().SelectMany(Walk));
}
