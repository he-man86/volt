using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace Volt.Engine.Source.Body.Network
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
    internal static class NetworkSplice
    {
        // [UNMEASURED: U6's second half — whether a vendor's importer NORMALIZES what was carried. The first half
        //  IS measured: `test/e2e/graphical/splice.test.ts` pushes a part-vendor, part-Volt document to live
        //  CODESYS and it imports, compiles and is a fixed point. But the wire serves network TEXT, not XML, so a
        //  normalization that preserved the text while rewriting the ids or dropping the vendor addData would look
        //  identical from there — which is exactly the blind spot this whole change exists to close, reappearing
        //  one layer out. Closing it needs the exported document: a bridge-side XML dump, or an export from the
        //  IDE after a spliced push. TwinCAT is entirely unmeasured, and DIALECT D4d matters there — its import
        //  invalidates every handle to the replaced item.]

        /// <summary>`NETWORK &lt;index&gt;` — the header that opens a network in the text form. The index is the
        /// engineer's, preserved verbatim through the reader, so it is the one key measured to be stable.</summary>
        private static readonly Regex Header = new(@"^NETWORK[ \t]+(\d+)\b", RegexOptions.Multiline);

        /// <summary>Replace, inside <paramref name="regenerated"/>, every network whose text is unchanged with the
        /// elements the vendor stored. Returns how many were carried.
        ///
        /// <para><paramref name="stored"/> is the body element as the IDE has it; <paramref name="baseline"/> is
        /// its render (what a pull produced); <paramref name="pushed"/> is what the engineer sent back.</para></summary>
        public static int Carry(XElement stored, XElement regenerated, string baseline, string pushed)
        {
            var before = SplitText(baseline);
            var after = SplitText(pushed);

            var storedGroups = GraphReader.SplitNetworks(stored.Elements().ToList())
                .ToDictionary(g => g.Index, g => g.Els);
            var regenGroups = GraphReader.SplitNetworks(regenerated.Elements().ToList())
                .ToDictionary(g => g.Index, g => g.Els);

            var carried = 0;
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
                carried++;
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
