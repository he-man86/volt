using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace Volt.Engine.PlcOpen
{
    /// <summary>
    /// Carry every network the engineer did NOT touch across from the stored body, verbatim.
    ///
    /// <para>A push regenerates a graphical body from network text, and regeneration is lossy — measured over
    /// every recorded vendor export, the `fbdattributes` vendorElement, every comment box, an LD contact's
    /// power-rail wire and all the localIds are gone. Editing one network of five destroyed the other four.</para>
    ///
    /// <para><b>The identity channel is the BASELINE RENDER, not the text.</b> At push time the stored body is in
    /// hand, and rendering it back to network text reproduces byte-for-byte what a pull wrote into the repo. Diff
    /// that against what was pushed, per network, and whatever did not change keeps its stored XML.</para>
    ///
    /// <para>That is why this needs no matching key, and why wrong-carry is impossible by construction: carrying
    /// requires byte EQUALITY of a whole network's text. A reordered, renumbered or edited network simply fails
    /// the comparison and is regenerated exactly as before. There is no partial match, no nearest match and no
    /// fallback — the alternative designs (matching nodes by localId, by content, by neighbourhood) were measured
    /// and none is reliable: 15 of 99 nodes agree on localId at ZERO edits, 57% of model nodes have no statement
    /// of their own, and 8% have no stored element at all.</para>
    /// </summary>
    /// <summary>
    /// Why the granularity is the NETWORK, and not the statement or the node — the measured verdict, written
    /// down so it is not re-litigated.
    ///
    /// <para><b>Node matching is not viable.</b> Measured over the recorded corpus: at ZERO edits only 15 of 99
    /// model nodes land under a localId denoting the same node on both sides, and for every LD fixture the
    /// overlap is 0 because the reader re-mints ladder ids at read time. A content key `(kind, text)` is 1:1 on
    /// 68 of 86, and the failures concentrate where the design FORCES them: `inVariable` literals collide 12 times
    /// in 21 because the leaf fan-out guard requires every read of a value to have its own leaf (DIALECT C4). A
    /// richer neighbourhood fingerprint is WORSE, 54 of 86 — it reads a lossy projection, so more of it is not
    /// more signal. And 57% of model nodes have no statement of their own at all (they are tokens inside one
    /// parenthesised expression), while 8% have no stored element to match to (embedded outputs and the `AND`
    /// blocks LD lowering synthesizes).</para>
    ///
    /// <para><b>Statement granularity is the natural next stage and needs two things this code does not have:</b>
    /// (a) `NetworkTextWriter` emitting a side-channel from each rendered statement to the localIds it consumed —
    /// it knows that as it renders and discards it; (b) `GraphReader.LowerLadder` recording which stored
    /// contact/coil/block each lowered node came from, where today the ids are synthetic.
    /// [UNMEASURED: U17 — whether each lowered LD node traces to exactly ONE stored element. The two synthesized
    ///  `AND` blocks suggest some are many-to-one. If it is not 1:1, statement granularity is FBD-only, and that
    ///  should be said rather than discovered.]
    /// [UNMEASURED: U16 — how the collision rates scale. The largest network in the corpus has 10 node-elements
    ///  and the median 4; literal collisions grow superlinearly with size, so 57.1% is a FLOOR, not a figure.]</para>
    ///
    /// <para><b>A text-format anchor is refused, and the condition to revisit it is named.</b> A per-statement
    /// `// @n` is buildable — the writer mints it, the reader carries it, `NETWORK_NOT_CANONICAL` is made
    /// anchor-preserving, a duplicate-anchor refusal joins the existing ones — and it buys nothing the baseline
    /// render does not already give, at the cost of readability. A per-NODE anchor
    /// (`((FALSE@1 AND TRUE@2)@3 AND FALSE@4)@5`) is refused outright: it destroys the readability that is the
    /// text form's whole justification. Revisit ONLY if the stored XML stops being reliably in hand at push time.
    /// It is in hand today — `BodyCodec` holds it — so this is a named condition, not a plan.</para>
    /// </summary>
    internal static class NetworkSplice
    {
        // U6's second half — does a vendor's importer NORMALIZE what was carried? — is ANSWERED for TwinCAT,
        // and the answer is yes, non-trivially. Measured 2026-08-27 on an export->import round trip with NO edit
        // between the two: the importer reordered `<LineIds>`, re-indented the implementation, ZEROED the POU's
        // `Id` while keeping the GUIDs supplied for members, and REGENERATED the declaration from the typed
        // `<interface>` — turning `x : INT;` into `x: INT;`, `yLonger   : BOOL;` into `yLonger: BOOL;`, and
        // dropping a blank line before `END_VAR`.
        //
        // That is why the declaration no longer travels this document at all
        // (`openspec/changes/declaration-from-the-aspect`). For the GRAPHICAL body the question is narrower and
        // still open: a text-preserving normalization that rewrote ids or dropped the vendor addData would look
        // identical from the wire, which serves network TEXT rather than XML.
        // [UNMEASURED: whether the id rewriting above touches FBD/LD element localIds specifically. Close it with
        //  a bridge-side XML dump, or an IDE export taken after a spliced push.]

        /// <summary>`NETWORK &lt;index&gt;` — the header that opens a network in the text form. The index is the
        /// engineer's, preserved verbatim through the reader, so it is the one key measured to be stable.</summary>
        private static readonly Regex Header = new(@"^NETWORK[ \t]+(\d+)\b", RegexOptions.Multiline);

        /// <summary>Replace, inside <paramref name="regenerated"/>, every network whose text is unchanged with the
        /// elements the vendor stored. Returns how many were carried.
        ///
        /// <para><paramref name="stored"/> is the body element as the IDE has it; <paramref name="baseline"/> is
        /// its render (what a pull produced); <paramref name="pushed"/> is what the engineer sent back.</para>
        ///
        /// <para>Returns the INDICES actually carried, not a count, because the caller needs to know WHICH: the
        /// capability gate is scoped to the networks that are being discarded, and a network declined below (id
        /// collision) is discarded like any other. A count would have let the gate skip one it should refuse.</para></summary>
        public static HashSet<int> Carry(XElement stored, XElement regenerated, string baseline, string pushed)
        {
            var before = SplitText(baseline);
            var after = SplitText(pushed);

            var storedGroups = GraphReader.SplitNetworks(stored.Elements().ToList())
                .ToDictionary(g => g.Index, g => g.Els);
            var regenGroups = GraphReader.SplitNetworks(regenerated.Elements().ToList())
                .ToDictionary(g => g.Index, g => g.Els);

            var carried = new HashSet<int>();
            foreach (var index in after.Keys.OrderBy(i => i))
            {
                if (!before.TryGetValue(index, out var was) || was != after[index]) continue;   // edited or new
                if (!storedGroups.TryGetValue(index, out var keep)) continue;                   // nothing to carry
                if (!regenGroups.TryGetValue(index, out var drop)) continue;

                // The one case that is NOT safe, and it is a real one. Ids are normally strided per network
                // (`index * NetworkStride`), so a carried network's ids and a regenerated network's cannot meet.
                // TwinCAT's LD export does NOT stride — it delimits with a networktitle marker and shares one
                // pair of power rails, so every network's ids sit in the low band. Carrying network 1 from such a
                // body while regenerating network 0 can then produce two elements with one localId, which is a
                // document neither importer can read.
                //
                // So the carry is DECLINED for that network rather than attempted and repaired. Declining leaves
                // exactly today's behaviour for that one network — it is regenerated, as it always was — which is
                // why this is a narrowing and not a fallback: nothing is guessed, and nothing is worse than
                // before. Renumbering the carried elements would mean rewriting every connection that refers to
                // them, which is regeneration wearing a different hat.
                if (WouldCollide(keep, regenerated, drop)) continue;

                var anchor = drop[0];
                foreach (var e in keep) anchor.AddBeforeSelf(e);
                foreach (var e in drop) e.Remove();
                carried.Add(index);
            }
            return carried;
        }

        /// <summary>Network index → that network's text, header included, exactly as rendered.</summary>
        private static Dictionary<int, string> SplitText(string text)
        {
            var starts = Header.Matches(text).Cast<Match>().ToList();
            var byIndex = new Dictionary<int, string>();
            for (var i = 0; i < starts.Count; i++)
            {
                var from = starts[i].Index;
                var to = i + 1 < starts.Count ? starts[i + 1].Index : text.Length;
                // Last-one-wins would be silent; a duplicate index is refused by NetworkTextReader upstream, so
                // reaching here with one means the two disagree — worth failing over rather than picking.
                var index = int.Parse(starts[i].Groups[1].Value);
                if (byIndex.ContainsKey(index))
                    throw new InvalidOperationException(
                        $"network index {index} appears more than once in one body — cannot key a carry on it");
                byIndex[index] = text.Substring(from, to - from);
            }
            return byIndex;
        }

        /// <summary>Would carrying <paramref name="keep"/> put two elements in the body under one localId?
        /// Compared against everything in the regenerated body EXCEPT the group being replaced.</summary>
        private static bool WouldCollide(List<XElement> keep, XElement regenerated, List<XElement> drop)
        {
            var dropping = new HashSet<XElement>(drop);
            var occupied = new HashSet<long>(
                regenerated.Elements().Where(e => !dropping.Contains(e))
                    .SelectMany(e => e.DescendantsAndSelf())
                    .Select(LocalId).Where(id => id.HasValue).Select(id => id!.Value));

            return keep.SelectMany(e => e.DescendantsAndSelf())
                       .Select(LocalId).Where(id => id.HasValue)
                       .Any(id => occupied.Contains(id!.Value));
        }

        private static long? LocalId(XElement e) =>
            long.TryParse((string?)e.Attribute("localId"), out var v) ? v : null;
    }
}
