using System;
using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Model;
using Volt.Engine.Vocabulary;

namespace Volt.Engine.Document
{
    /// <summary>The capability gate over a STORED graphical body: may this <c>&lt;FBD&gt;</c>/<c>&lt;LD&gt;</c>
    /// element be replaced at all, or does it carry something the network-text editor cannot reproduce?
    ///
    /// <para>It answers one question, for one caller — <c>BodyCodec.NetworkCodec.Encode</c> — and it is the only
    /// thing that stands between a regenerating write and a silent loss.</para>
    ///
    /// <para>This file used to be <c>GraphSplice</c>, and it used to contain a splice: <c>FindFbdLdBody</c>,
    /// <c>SpliceFbdLdBody</c>, <c>InlineInsert</c> and <c>FindFbdLd</c> — about 97 lines implementing a SECOND
    /// graphical write path, by the same means as the live one (<c>existing.ReplaceWith(newBody)</c> against
    /// <c>BodyCodec.cs</c>'s <c>existing.ReplaceWith(replacement)</c>) and with a weaker element scan
    /// (direct-children-only, where <c>BodyElement</c> is nested-aware — and <c>BodyElement.cs</c> records that a
    /// non-shared scan is exactly how a diagram gets destroyed). It had <b>zero production callers</b>; only tests
    /// reached it. It is deleted, and the tests that needed "replace this element" now build it locally, in the
    /// test project, where a test helper belongs.</para>
    ///
    /// <para>The old name and its doc-comment claimed this "belongs with the graph, not with the document" while
    /// the file sat in <c>Document/</c>. The gate reads a stored document element and is called by the document's
    /// body codec, so it belongs exactly where it is; the name now says what it does.</para>
    /// </summary>
    public static class BodySpliceGuard
    {
        /// <summary>Validate an existing body before replacing it: no element the network text editor cannot
        /// reproduce is silently dropped, no disabled/hidden network is lost, and no block structure
        /// the editor cannot round-trip is overwritten. These checks run ONLY on the existing-body path
        /// — a first write has nothing to lose, so validation is skipped.</summary>
        /// <summary>The capability gate as the codec calls it: refuse to overwrite a stored body carrying
        /// elements network text cannot represent. `doc` is only used for the error message's item name, so the
        /// codec — which holds the body, not the document — passes none.</summary>
        internal static void RequireReplaceable(XElement existing) => ValidateExisting(null, existing);

        private static void ValidateExisting(XDocument? doc, XElement existing)
        {
            var lost = existing.Elements()
                .Select(e => e.Name.LocalName)
                .Where(n => !SafeToDrop.Contains(n))
                .Distinct()
                .ToList();
            if (lost.Count > 0)
                throw new InvalidOperationException(
                    "refusing to write this graphical body: it contains element(s) the network text editor cannot " +
                    "represent yet (" + string.Join(", ", lost) + "). Edit this POU in the IDE instead.");

            var indices = existing.Elements()
                .Select(e => (long?)e.Attribute("localId"))
                .Where(id => id.HasValue)
                .Select(id => id!.Value / GraphConstants.NetworkStride)
                .Distinct()
                .OrderBy(i => i)
                .ToList();
            if (indices.Count > 1 && indices[indices.Count - 1] - indices[0] + 1 != indices.Count)
                throw new InvalidOperationException(
                    "refusing to write this graphical body: there is a gap in the network numbering, " +
                    "which means a disabled or hidden network would be lost. " +
                    "Edit this POU in the IDE instead.");

            var ns = existing.Name.Namespace;
            var blind = new List<string>();
            if (existing.Descendants(ns + "inOutVariables").Any(io => io.Elements(ns + "variable").Any()))
                blind.Add("a block in-out pin (<inOutVariables>)");
            // executionOrderId is EXECUTION SEMANTICS, and a rewrite silently zeroes it. `GraphReader` reads it
            // and `GraphWriter` writes it, but all 15 node constructions in `NetworkTextReader` pass null and the
            // text format has no spelling for it — so it cannot survive a regeneration, ever.
            //
            // It is not a CFC-only attribute: the TC6 schema declares it on the shared block / inVariable /
            // outVariable / inOutVariable / label / jump / return elements FBD and LD bodies are built from, and
            // the CODESYS reference calls it execution semantics — two coils on the same variable are
            // last-write-wins, and "the order is determined by executionOrderId of the coils, not by their
            // visual position".
            //
            // So this refuses rather than silently reordering someone's program. Until a splice can CARRY it
            // (openspec `splice-graphical-body` §3), fail loud is the only honest answer: the repo's rule
            // everywhere else, and the difference between a push that stops and a plant that runs its outputs in
            // a different order.
            //
            // [UNMEASURED: U1 — whether either vendor EMITS executionOrderId on an FBD/LD element. Zero of the 9
            //  recorded exports carry one, so this guard has never fired on real vendor output. If it turns out
            //  they never emit it, this is dead weight and should go; if they do, it has been silently destroying
            //  execution order. Close it by building an FBD network with two coils on one variable in each IDE,
            //  reordering them, and exporting.]
            if (existing.Descendants().Any(e => e.Attribute("executionOrderId") is not null))
                throw new InvalidOperationException(
                    "this body carries executionOrderId, which network text cannot represent — a rewrite would " +
                    "silently reset the execution order. Edit it in the IDE.");

            if (existing.Descendants(ns + "outputVariables").Elements(ns + "variable").Any(HasPinMod))
                blind.Add("a modifier on a block output pin (negated/edge/storage)");
            // A pin with several connections is an invalid multi-source pin in FBD — but in LD it's an OR
            // convergence (parallel branches), which the reader lowers and the writer regenerates. Only guard FBD.
            if (existing.Name.LocalName != "LD"
                && existing.Descendants(ns + "connectionPointIn").Any(c => c.Elements(ns + "connection").Count() > 1))
                blind.Add("a pin wired from multiple sources");
            // A stateless block with >1 output can't be represented — UNLESS it's an EN/ENO box: it has an EN
            // input and two outputs (its value + the enable echo), and we represent that as the IF guard. The
            // enable echo is named inconsistently across TwinCAT builds (ENO / Out1), so key off the EN INPUT,
            // which is always "EN", not the output name.
            if (existing.Descendants(ns + "block").Any(b => (string?)b.Attribute("instanceName") == null
                    && !(b.Element(ns + "inputVariables")?.Elements(ns + "variable")
                          .Any(v => (string?)v.Attribute("formalParameter") == "EN") ?? false)
                    && (b.Element(ns + "outputVariables")?.Elements(ns + "variable").Count() ?? 0) > 1))
                blind.Add("a stateless function with multiple outputs");
            if (blind.Count > 0)
                throw new InvalidOperationException(
                    "refusing to write this graphical body: it has structure the network text editor cannot " +
                    "represent yet (" + string.Join("; ", blind.Distinct()) + "). Edit this POU in the IDE instead.");
        }

        private static readonly HashSet<string> SafeToDrop =
            new() { "inVariable", "outVariable", "block", "label", "jump", "return", "comment", "vendorElement",
                    "leftPowerRail", "rightPowerRail", "contact", "coil" };

        /// <summary>A pin <c>&lt;variable&gt;</c> carries a modifier network text can't reproduce on an output
        /// (negation / edge / set-reset storage). "none"/absent = no modifier.</summary>
        private static bool HasPinMod(XElement v)
        {
            if ((string?)v.Attribute("negated") == "true") return true;
            if ((string?)v.Attribute("edge") is { } e && e is not ("" or "none")) return true;
            if ((string?)v.Attribute("storage") is { } s && s is not ("" or "none")) return true;
            return false;
        }
    }
}
