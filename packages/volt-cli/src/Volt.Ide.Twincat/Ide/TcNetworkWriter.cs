using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Format.Network;
// `Parallel` is also System.Threading.Tasks.Parallel; this file means the LD branch.
using Parallel = Volt.Engine.Format.Network.Parallel;

namespace Volt.Ide.Twincat;

/// <summary>
/// Writes a <see cref="NetworkBody"/> back into a TwinCAT <c>&lt;NWL&gt;</c> archive.
///
/// <para><b>This writer creates nothing.</b> Not an element, not a member, not a list entry. It walks the
/// vendor's own document alongside the pushed model and assigns to members that are ALREADY THERE; anything
/// else is refused. That one rule is the whole design, and it is here because the version that built elements
/// from a template wrote twenty <c>.TcPOU</c> files TwinCAT could not open
/// (<c>Value cannot be null. Parameter name: iILStatement</c>).</para>
///
/// <para><b>Why building cannot work here.</b> The archive is a strict typed object-graph serialization: the
/// reader consumes members in order for the type it was told to expect, so a member set that is close but not
/// exact makes it mis-assign everything after the discrepancy. And the contract is deep — a real
/// <c>BoxTreeBox</c> carries <c>InputParam</c>, <c>OutputParam</c>, <c>CallType</c>, <c>EN</c>, <c>ENO</c>,
/// <c>STSnippet</c>, <c>ContainsExtensibleInputs</c>, <c>ProvidesSTSnippet</c> and an <c>Id</c>, most of which
/// are results of the IDE RESOLVING the call. Volt does not resolve calls; the IDE does. Synthesizing those
/// members means guessing at a compiler's output, which is the class of guess that produced unopenable files.
/// </para>
///
/// <para>So the capability is deliberately narrow and provable: <b>edit the VALUES of an existing graphical
/// body</b> — rename an operand, retype it, change a comment or a title, negate a contact, disable a network.
/// Adding or removing a rung, a box or an input is done in the IDE and pulled. Each refusal below names the
/// exact shape change it saw.</para>
/// </summary>
internal static class TcNetworkWriter
{
    /// <summary>Apply the model to the archive and return the new <c>&lt;NWL&gt;</c> body XML, or null when
    /// nothing changed.
    /// <para>The parse keeps whitespace and the serialization adds none, so an untouched document comes back
    /// byte-identical — and an unchanged model does not come back at all. Those two together are what make a
    /// push non-destructive: every id, every <c>Fixed</c>, every <c>ILLines</c> entry and every member Volt
    /// does not model survives exactly as the IDE wrote it.</para></summary>
    public static string? Apply(string? bodyXml, NetworkBody body) => Apply(bodyXml, body, resolve: null);

    /// <summary>The same, with a way OUT of a refusal: <paramref name="resolve"/> is handed a network whose
    /// shape the archive cannot be edited into, and returns that network rebuilt by the IDE.
    ///
    /// <para><b>This is what makes a structural edit possible without a second write path.</b> Retyping a box —
    /// `OR` to `AND` — changes members only the IDE can resolve (`CallType`, `InputParam`, `Id`), so editing in
    /// place is refused and always will be. Re-resolving the WHOLE body would work but discards the ids of
    /// every network the engineer did not touch. Re-resolving just the network that changed does neither: the
    /// rest of the archive is untouched, byte for byte.</para>
    ///
    /// <para><b>It is sound only because of a measured rule</b> (DIALECT D25, gated by
    /// `test/e2e/graphical/grouping.test.ts`): the importer emits ONE NETWORK PER CONNECTED COMPONENT. A
    /// network that is one component comes back as one network and can be swapped in; a network holding
    /// several independent rungs would come back as several, renumbering everything after it, so it is refused
    /// instead. That check happens HERE, from the model, before the IDE is touched.</para></summary>
    public static string? Apply(string? bodyXml, NetworkBody body, Func<Network, XElement>? resolve)
    {
        // No archive to edit means there is nothing to edit IN, and creating one is the construction this
        // writer does not do. A newly created POU arrives here with an empty implementation, so this is the
        // path a push of a brand-new graphical body takes - it has to say that, not throw an XML parse error.
        if (string.IsNullOrWhiteSpace(bodyXml))
            throw Refuse("creates a graphical body where the IDE has none");

        XElement doc;
        try { doc = XElement.Parse(bodyXml, LoadOptions.PreserveWhitespace); }
        catch (System.Xml.XmlException) { throw Refuse("replaces a textual body with a graphical one"); }

        var impl = doc.Descendants("o").FirstOrDefault(o => (string?)o.Attribute("t") == "NWLImplementationObject")
            ?? throw Refuse("replaces a " + doc.Name.LocalName + " body with a graphical one");

        // THE VIEW CANNOT BE CHANGED BY A PUSH — the same rule CODESYS states, from its own accessor.
        // Network text prints FBD or LD on every header, so it invites an edit nothing applies: only the
        // CREATE route writes `DefaultViewMode` (`TcArchive.WithViewMode`), and `Unchanged` below compares
        // both sides with the language neutralised — so a header-only edit wrote nothing, reported
        // success, and was reverted by the next pull.
        NetworkText.RefuseViewModeChange(BeckhoffDriver.ViewModeOf(impl), body.Language);

        var networks = TcArchive.List(impl, "NetworkList");
        if (networks.Count != body.Networks.Count)
            throw Refuse($"the number of networks changes ({networks.Count} -> {body.Networks.Count})");

        bool changed = false;
        for (int i = 0; i < networks.Count; i++)
        {
            var model = body.Networks[i];
            try
            {
                changed |= WriteNetwork(networks[i], model);
                continue;
            }
            catch (NotSupportedException) when (resolve != null)
            {
                // Fall through: this network's SHAPE changed, so the IDE has to rebuild it.
            }

            // Only a single-component network can be swapped in without renumbering the ones after it.
            var parts = Unhoist(model.Trees).Count;
            if (parts != 1)
                throw Refuse($"changes the shape of network {model.Order + 1}, which holds {parts} independent " +
                             "rungs - the IDE rebuilds one network per connected rung, so re-creating it would " +
                             $"split it into {parts} networks and renumber every network after it");

            var rebuilt = resolve!(model);
            networks[i].ReplaceWith(rebuilt);
            WriteNetwork(rebuilt, model);      // stamp the values the rebuild could not carry
            changed = true;
        }

        return changed ? doc.ToString(SaveOptions.DisableFormatting) : null;
    }

    /// <summary>Does the live network already say exactly what is being pushed?
    ///
    /// <para>Rendered through <see cref="TcNetworkReader"/> and <c>NetworkTextWriter</c> — the pull path — so
    /// "the same" means the same file, which is the only definition that matters to an engineer. A reader that
    /// REFUSES the live network (an Execute box is the measured case) answers "not unchanged" rather than
    /// throwing, because the caller's structural walk is then the right place for that refusal to surface, with
    /// its own message.</para></summary>
    private static bool Unchanged(XElement net, Network model)
    {
        try
        {
            var live = TcNetworkReader.ReadNetworkFor(net, model.Order);
            var one = new NetworkBody(BodyLanguage.Fbd, new[] { live });
            var other = new NetworkBody(BodyLanguage.Fbd, new[] { model });
            return NetworkTextWriter.Write(one) == NetworkTextWriter.Write(other);
        }
        catch (NotSupportedException) { return false; }
    }

    private static NotSupportedException Refuse(string what) =>
        new NotSupportedException(
            $"TwinCAT: this push {what}, which Volt cannot do through the archive. It edits the VALUES of an " +
            "existing graphical body - operands, types, comments, titles, flags - and never builds archive " +
            "elements, because the IDE's own reader depends on a member contract only the IDE produces. " +
            "Make this change in the IDE and pull it.");

    // -- networks ----------------------------------------------------------------------------------

    private static bool WriteNetwork(XElement net, Network model)
    {
        // THE CHANGE GATE, FIRST. If the live network already renders to exactly the text being pushed, there is
        // nothing to write and nothing to refuse — return before the structural walk below can do either.
        //
        // Without it, "unchanged" was decided STRUCTURALLY, item by item, and a shape this writer cannot edit in
        // place threw `Refuse` even when the body was identical. On the push path that refusal is caught and the
        // whole network is handed to the IDE to REBUILD (see Apply's `resolve` hatch), which re-mints every id
        // and every member Volt does not model — for a network nobody touched. A parallel branch was the measured
        // case: pulled, pushed straight back, and redrawn.
        //
        // Compared as TEXT, through the same reader and writer a pull uses, because two bodies are equal exactly
        // when they materialize to the same file. This is the rule CODESYS's writer already follows, so it is
        // also the two vendors agreeing on when a push is a no-op.
        if (Unchanged(net, model)) return false;

        // Title/Label/Comment compare with TRAILING WHITESPACE IGNORED. The IDE keeps the newline the engineer
        // typed after them and the model holds them trimmed (TcNetworkReader.Trimmed), so a plain compare would
        // rewrite a title nobody had touched on every push — and a push that changes nothing must change nothing.
        bool changed = SetText(net, "Title", model.Title)
                     | SetText(net, "Label", model.Label)
                     | SetText(net, "Comment", model.Comment)
                     | SetBool(net, "OutCommented", model.Disabled);

        // A MULTI-OUTPUT ASSIGNMENT IS ONE ITEM, however the text spells it. Network text cannot repeat a
        // producer without duplicating its box, so `NetworkTextWriter` hoists N>1 targets into a named wire -
        // `LET g1 := (a OR b); out1 := g1; out2 := g1;` - which reparses as a Demux definition plus one
        // assignment each. One archive item becomes three model trees, and comparing raw counts refused a body
        // NOBODY had changed. The surveyed real project has 258 of these.
        var items = TcArchive.List(net, "NetworkItems");
        var trees = Unhoist(model.Trees);
        if (items.Count != trees.Count)
            throw Refuse($"network {model.Order + 1} changes from {items.Count} to {trees.Count} item(s)");

        for (int i = 0; i < items.Count; i++)
            changed |= WriteNode(items[i], trees[i]);
        return changed;
    }

    /// <summary>Fold the text's hoisted-wire spelling back into the ONE item the archive holds.
    ///
    /// <para>`LET g1 := &lt;producer&gt;; out1 := g1; out2 := g1;` is how network text says "one value, several
    /// l-values" - it cannot repeat the producer inline without duplicating its box. The archive says the same
    /// thing as a single item with several outputs, so the two must be compared in the same shape.</para></summary>
    private static IReadOnlyList<Node> Unhoist(IReadOnlyList<Node> trees)
    {
        var wires = trees.OfType<Demux>().Where(d => d.Input is not null)
                         .ToDictionary(d => d.VarId, d => d.Input!);
        if (wires.Count == 0) return trees;

        var folded = new List<Node>();
        var consumed = new Dictionary<int, List<Operand>>();
        foreach (var t in trees)
        {
            if (t is Demux) continue;                                   // the wire's definition
            if (t is Assign a && a.Value is Demux use && use.Input is null && wires.ContainsKey(use.VarId))
            {
                if (!consumed.TryGetValue(use.VarId, out var targets))
                    consumed[use.VarId] = targets = new List<Operand>();
                targets.AddRange(a.Targets);
                continue;
            }
            folded.Add(t);
        }

        // Rebuild each wire as the single multi-target assignment the archive holds.
        foreach (var kv in consumed)
            folded.Add(new Assign(wires[kv.Key], kv.Value, Flags.None));
        return folded.Count == 0 ? trees : folded;
    }

    // -- the tree ----------------------------------------------------------------------------------

    /// <summary>Walk one archive item against one model node. The node KIND must still match what the IDE
    /// wrote — a leaf that became a box is a different object with a different member set, not an edit.</summary>
    private static bool WriteNode(XElement e, Node n)
    {
        var type = TcArchive.TypeOf(e);

        // A `BoxTreeOperand` carries NO Flags member (DIALECT N4) - a leaf's modifiers live on the `Operand` it
        // holds, and the Leaf arm below writes them there. Calling WriteFlags at ITEM level for a leaf therefore
        // found no holder and REFUSED, which became a live failure the moment the reader started surfacing
        // those flags: every negated contact, SET coil and edge contact made its POU unpushable, on a body
        // nobody had edited. The surveyed real project carries 846 negations and 246 sets.
        var changed = type == "BoxTreeOperand" ? false : WriteFlags(e, n.Flags);

        switch (n)
        {
            // A `BoxTreeOperand` carries NO Flags member of its own (DIALECT N4) - an operand's modifiers live
            // on the `Operand` it holds. So the LEAF's flags are written there, mirroring the read.
            case Leaf l when type == "BoxTreeOperand":
                return changed
                     | WriteOperand(e, "Operand", l.Operand with { Flags = l.Flags });

            case Assign a when type == "BoxTreeAssign":
            {
                // COIL STORAGE GOES BACK WHERE THE ARCHIVE KEEPS IT — on the TARGET — having been read onto the
                // value (see TcNetworkReader). It is written from the value and STRIPPED from the value, so the
                // source operand does not also come out latched: `out := a SET;` is a set COIL, not a set input.

                // A JUMP OR RETURN HAS NO OUTPUTS, and its `Targets` are not outputs either — a jump's
                // single target is its LABEL (the destination network's name) and a return has none at all.
                // Comparing them against the archive's `OutputItems` therefore compared two unrelated
                // things: TwinCAT's imported return item carries one output slot holding an empty operand,
                // the model carries zero, and the push was refused with "an item changes from 1 to 0
                // output(s)" — a body the IDE had just built from Volt's own import could be pulled and
                // never pushed back.
                //
                // This is the same mistake the box arm below documents at length (a text-derived model can
                // never carry `Box.Outputs`, so comparing them refused every resolved box), in the one
                // other place the model and the archive disagree about what an "output" is.
                // ONLY A RETURN SKIPS THE OUTPUT WRITE, and narrowing this from "either" is the fix.
                //
                // The measurement behind the skip (D31c) is about RETURN: the model carries zero targets
                // while TwinCAT's imported return item holds one output slot, so comparing the counts
                // refused a body the IDE had just built. A JUMP is not that shape — its single target is the
                // destination label and the archive has one slot for it, so the counts agree and the write
                // works. Folding the two together was a generalization, not a measurement, and it cost the
                // edit path: retargeting `JMP Done` to `JMP Other` left RValue unchanged, skipped the
                // outputs and found no storage change, so `changed` stayed false, `Apply` returned null and
                // the driver wrote nothing at all. The push reported success, the PLC still jumped to `Done`,
                // and the next pull reverted the engineer's file.
                return changed
                     | WriteChild(e, "RValue", a.Value)
                     | (a.Flags.Return ? false : WriteOutputs(e, a.Targets))
                     | WriteJump(e, a.Flags.Jump)
                     | (a.Flags.Return ? false : WriteCoilBits(e, a.Targets));
            }

            case Box b when type == "BoxTreeBox":
            {
                // The box TYPE is not an editable value: it is what the IDE resolved `CallType`, `InputParam`
                // and `OutputParam` from, and changing it without redoing that resolution leaves an archive
                // describing one call with another call's signature.
                // A FUNCTION-BLOCK CALL IS NAMED BY ITS INSTANCE IN TEXT, NOT BY ITS TYPE. Network text writes
                // `fbTimer(IN := x)`, so the reader rebuilds `Box(Type: "fbTimer")` while the archive holds
                // `BoxType = "TON"` - and comparing those two refused a body NOBODY HAD CHANGED, making every
                // POU with a TON, an R_TRIG or any user FB permanently unpushable.
                //
                // This one is mine too: the refusal was added for parity with CODESYS, which REBUILDS the box
                // and genuinely cannot know the type from the text. This writer edits IN PLACE and has both
                // values in front of it - the archive's BoxType and its Instance - so it can simply check the
                // right one. A retype is still refused; being called by its instance name is not a retype.
                // CASE-INSENSITIVELY, because these are IEC IDENTIFIERS and IEC 61131-3 says case does not
                // distinguish them. This was the last Ordinal identity compare on the wire — the same mistake
                // `BeckhoffDriver.WriteContent` fixed for member names, where `METHOD Calc` renamed to
                // `METHOD calc` passed every gate above and then threw NOT_FOUND. Here the cost was a refusal
                // of a body nobody retyped, which on the push path discards the network to `RebuildNetwork` and
                // regenerates the exact ids this writer exists to preserve.
                var was = TcArchive.Str(e, "BoxType") ?? "";
                var instance = TcArchive.Str(TcArchive.Obj(e, "Instance"), "Operand");
                var namesThisBox = string.Equals(was, b.Type, StringComparison.OrdinalIgnoreCase)
                                   || (instance != null && string.Equals(instance, b.Type, StringComparison.OrdinalIgnoreCase));
                if (!namesThisBox)
                    throw Refuse($"a box changes from '{was}' to '{b.Type}'");

                changed |= WriteOperand(e, "Instance", b.Instance);

                // A BOX'S OWN OUTPUT PINS ARE WRITTEN NOW, matched to their SLOTS BY NAME.
                //
                // This used to skip them entirely, and the reason was sound at the time: "network text has no
                // syntax for them at all, so a text-derived model's `Box.Outputs` is ALWAYS empty, and
                // comparing it against the archive was comparing against information the model can never
                // carry". The format spells them today (`ET => elapsed`, and the unnamed result pin as the
                // call's assignment), so the model DOES carry them and skipping is no longer neutral: it makes
                // an engineer's edit to an output pin a silent no-op, the push reporting success while the
                // archive keeps the old variable.
                //
                // The COUNT is still not compared, for the original measured reason: the archive holds one slot
                // per declared pin whether or not it is wired, plus an ENO slot, and the model carries only the
                // wired ones. Matching by name is what lets the two disagree in length without either lying.
                // THE ENABLE IS INPUT SLOT 0, and it is not the `EN` member.
                //
                // This wrote `b.Enable` into `EN`, which was the reader's mistake in mirror image: the member
                // is the "EN/ENO is shown on this box" flag, not the wire. Both halves agreed, so the pair
                // no-opped together and nothing showed it. With the read corrected, the enable is a real input
                // item again — and the count check below has to know that, or every ladder box would refuse
                // ("changes from 2 to 1 input(s)") on a push that changed nothing.
                var inputs = TcArchive.List(e, "InputItems");
                var pinNames = TcArchive.Strings(TcArchive.Obj(e, "InputParam"), "Names");
                var enSlot = Box.HasEnableSlot(pinNames) && inputs.Count > 0 ? 1 : 0;
                if (enSlot == 1 && b.Enable is null)
                    throw Refuse($"box '{b.Type}' drops its EN input, which network text cannot express");
                if (enSlot == 0 && b.Enable is not null)
                    throw Refuse($"box '{b.Type}' gains an EN input, which this in-place write cannot add");
                if (inputs.Count - enSlot != b.Inputs.Count)
                    throw Refuse($"box '{b.Type}' changes from {inputs.Count - enSlot} to {b.Inputs.Count} input(s)");
                if (enSlot == 1) changed |= WriteNode(inputs[0], b.Enable!);
                for (int i = 0; i < b.Inputs.Count; i++)
                    changed |= WriteNode(inputs[i + enSlot], b.Inputs[i].Value);

                changed |= WriteFormalNames(e, b);
                changed |= WriteBoxOutputs(e, b);
                return changed;
            }

            case Demux d when type == "BoxTreeDemux":
                return changed
                     | SetInt(e, "VarId", d.VarId)
                     | WriteChild(e, "Input", d.Input);

            case Parallel p when type == "BoxTreeParallel":
            {
                // `Mode` IS NOT WRITTEN, and must not be. It used to be set to the string "And" or "Or"
                // from a model field that no longer exists. Measured on the vendor's own contract (SP21
                // `NWLObject` 4.6.0.0): `IBoxTreeParallel.Mode` is typed `OperationMode`, whose only values are
                // `Sequential` and `BoxShortCircuit`. "And"/"Or" is outside that member's vocabulary, so the
                // write put a value into a live ladder's archive the vendor's own deserializer cannot read back
                // as that enum. Both readers were equally confused — they compared it against "And", which the
                // enum can never produce — so every parallel has always been read as an OR, which for a ladder
                // is the right answer reached for the wrong reason. Volt does not model this member; the honest
                // write is to leave the IDE's value alone.
                changed |= WriteChild(e, "Input", p.Input);
                var branches = TcArchive.List(e, "Trees");
                if (branches.Count != p.Branches.Count)
                    throw Refuse($"a branch changes from {branches.Count} to {p.Branches.Count} path(s)");
                for (int i = 0; i < branches.Count; i++)
                    changed |= WriteNode(branches[i], p.Branches[i]);
                return changed;
            }

            case Terminator t when type == "BoxTreeTerminator":
                return changed | WriteChild(e, "Input", t.Input);

            default:
                throw Refuse($"a '{type ?? "?"}' item becomes a {n.GetType().Name.ToLowerInvariant()}");
        }
    }

    /// <summary>A nested node member (<c>RValue</c>, <c>En</c>, <c>Input</c>). Present-vs-absent must match:
    /// the archive spells "absent" as an explicit null member, and turning one into an object is
    /// construction.</summary>
    private static bool WriteChild(XElement owner, string name, Node? node)
    {
        var child = TcArchive.Obj(owner, name);
        if (child == null)
            return node == null ? false : throw Refuse($"a '{name}' input appears where the IDE wrote none");
        if (node == null)
            throw Refuse($"the '{name}' input of an item is removed");
        return WriteNode(child, node);
    }

    /// <summary>Outputs sit one level deeper than in the live model: an <c>OutputItems</c> member of type
    /// <c>OutputItemList</c>, itself holding an <c>OutputItems</c> list.</summary>
    /// <summary>An OUTPUT operand's text only. Its modifiers are NOT written, and that is the difference from
    /// a leaf.
    ///
    /// <para>A leaf's modifiers have a network-text form - <c>NOT b</c>, parsed straight back - so the model
    /// carries them and the writer can put them back. An assignment TARGET's do not:
    /// <c>NetworkTextWriter.Lhs</c> renders a target as its bare text with no modifiers, so the reader hands
    /// back <c>new Operand(name)</c> with no flags, and writing that erased the vendor's own value.</para>
    ///
    /// <para><b>This was mine, made today.</b> The commit that stopped this method writing Type, SymbolComment,
    /// LValue and IsInstance deliberately KEPT Flags, because a leaf's flags round-trip - and did not notice
    /// that outputs come through the same function. Measured on a SET coil: <c>Flags: 2 -> 0</c> from a push
    /// that changed nothing. The coil stops latching, the push reports success, `volt status` says clean.</para>
    ///
    /// <para>The real fix is to give a target's modifiers a text form so a SET coil is visible and editable in
    /// the workspace at all. Until then the archive value is left exactly as the IDE wrote it.</para></summary>
    private static bool WriteOutputOperand(XElement o, Operand op) => SetString(o, "Operand", op.Text);

    /// <summary>Set or clear the SET bit on every target of an assignment, leaving every OTHER bit alone.
    ///
    /// <para>The whole-flags write cannot be used here. A target may carry modifiers network text has no form
    /// for — a NEGATED coil is the measured case (`Flags=Negation,Set`) — and rewriting the field wholesale
    /// would erase them on a push that never mentioned them. Only the bit the format can express is touched.</para></summary>
    /// <summary>A box's FORMAL PIN NAMES, written alongside its input values.
    ///
    /// <para><b>Values were written positionally while the names were never written at all</b>, and that pairing
    /// is a silent semantic swap. Network text names the pins — <c>t1(IN := a, PT := pt)</c> — so an engineer who
    /// REORDERS them to <c>t1(PT := pt, IN := a)</c> is saying the same thing; the writer put the values into
    /// slots 0 and 1 while the archive's Names stayed <c>[IN, PT]</c>, so <c>PT</c>'s value landed on <c>IN</c>.
    /// Nothing refused it, the text round-tripped, and the running program changed. CODESYS writes these on
    /// every rebuild (<c>AppendParam</c>); this is the in-place equivalent.</para>
    ///
    /// <para>Assigning existing <c>&lt;v&gt;</c> values is squarely inside this writer's rule — no element is
    /// created. An OPERATOR box has no formal names (its pins are positional, measured on every box in every
    /// fixture) and its model carries none, so it is left untouched rather than given an empty list. A count
    /// mismatch is a shape change and is refused, exactly as the input count above is.</para></summary>
    /// <summary>A box's OUTPUT PINS, written into the slots they belong to.
    ///
    /// <para>BY NAME, not by position, and the two lists genuinely differ in length: the archive holds a slot
    /// for every DECLARED pin plus the <c>ENO</c> echo, while the model carries only the pins actually wired
    /// (`CodesysNetworkReader.ReadBoxOutputs` and `BoxOutputs` here drop the rest). Writing positionally would
    /// put a pin's variable on its neighbour — the same swap `WriteFormalNames` exists to prevent on the input
    /// side, where it was measured changing a running program.</para>
    ///
    /// <para>The box's RESULT — the pin the vendor leaves unnamed — matches the first non-ENO slot whose name
    /// is empty. A slot the model does not mention is left ALONE rather than cleared: network text does not
    /// spell an unwired pin, so a push that never mentioned one is not an instruction to disconnect it.</para></summary>
    private static bool WriteBoxOutputs(XElement e, Box b)
    {
        if (b.Outputs.Count == 0) return false;

        var holder = TcArchive.Obj(e, "OutputItems");
        var slots = TcArchive.List(holder, "OutputItems");
        var names = TcArchive.Strings(TcArchive.Obj(e, "OutputParam"), "Names");
        var eno = Box.HasEnoSlot(names) ? 1 : 0;

        var changed = false;
        var placed = 0;
        for (int i = eno; i < slots.Count; i++)
        {
            var name = Box.FormalAt(names, i);
            var pin = b.Outputs.FirstOrDefault(o => string.Equals(o.Formal, name, StringComparison.Ordinal));
            if (pin is null) continue;
            changed |= WriteOutputOperand(slots[i], pin.Value);
            placed++;
        }
        if (placed != b.Outputs.Count)
            throw Refuse($"box '{b.Type}' names an output pin the IDE has no slot for");
        return changed;
    }

    private static bool WriteFormalNames(XElement e, Box b)
    {
        if (!b.Inputs.Any(i => !string.IsNullOrEmpty(i.Formal))) return false;   // operator: positional pins

        var list = TcArchive.Obj(e, "InputParam")?.Elements("l2")
            .FirstOrDefault(l => (string?)l.Attribute("n") == "Names");
        if (list == null)
            throw Refuse($"box '{b.Type}' names its pins but the IDE wrote no InputParam/Names to name");

        // The ENABLE OWNS SLOT 0 of this list too, under the name the reader finds it by, so the model's pins
        // start one along. `Names` is also allowed to be SHORTER than the model's pin list — that is how an
        // extensible operator says its trailing pins are positional — so only the slots the IDE actually
        // wrote are compared, and a mismatch on those is still refused.
        var slots = list.Elements("v").ToList();
        var enSlot = Box.HasEnableSlot(slots.Select(v => (string?)v.Value).ToList()) ? 1 : 0;
        if (slots.Count - enSlot > b.Inputs.Count)
            throw Refuse($"box '{b.Type}' changes from {slots.Count - enSlot} to {b.Inputs.Count} named pin(s)");

        var changed = false;
        for (int i = enSlot; i < slots.Count; i++)
        {
            var want = b.Inputs[i - enSlot].Formal ?? "";
            if (slots[i].Value == want) continue;
            slots[i].Value = want;
            changed = true;
        }
        return changed;
    }

    /// <summary>Remove the EMPTY output operand the PLCopen importer hangs off a box — the one thing that
    /// stopped every graphical body Volt created on TwinCAT from compiling.
    ///
    /// <para>Measured by drawing nothing and diffing two archives of the SAME ladder
    /// (<c>xoutput := (xtest OR xtest2);</c>): the one TwinCAT's own editor produced
    /// (<c>fixtures/tc-pou/ladder.TcPOU</c>) carries <c>&lt;l2 n="OutputItems" /&gt;</c> on the box —
    /// self-closed, EMPTY — while the one its PLCopen importer produced carries a list holding one operand
    /// whose name is <c>""</c>. The compiler reads that as the box's result going somewhere nameless
    /// instead of to the coil, and answers <c>Assignment target not specified</c> — pointing at a rung whose
    /// text is exactly right, which is why this survived: the body round-trips byte-identical, so no test
    /// that compares text could see it, and the build assertion that would have was filtering diagnostics
    /// by a POU name no vendor puts in one.</para>
    ///
    /// <para>Isolated to the BOX, not the coil: <c>out := a;</c> — a contact wired straight to a coil, no box
    /// between them — compiles clean, while <c>(a AND b)</c>, <c>(a OR b)</c> and the FBD spelling all fail.
    /// Two earlier suspects were refuted on the way: <c>LValue</c> and <c>Type</c> differ between the two
    /// archives as well, but they are RESOLUTION results the compiler fills in for itself — forcing
    /// <c>LValue</c> true left the error exactly where it was.</para>
    ///
    /// <para><b>Only an EMPTY operand is dropped.</b> A box output with a name is an embedded output — a TON
    /// writing its <c>ET</c> pin straight to a variable — and is the engineer's, not the importer's.</para>
    ///
    /// <para><b>And only on the IMPORT path.</b> The general edit path leaves an existing body alone, because
    /// this is a repair of what the import just produced rather than a rule about archives in general —
    /// running it everywhere would rewrite bodies created by older versions of Volt on a push that changed
    /// nothing, which is the one thing the writer must never do.</para></summary>
    public static string DropImporterBoxOutputs(string bodyXml)
    {
        var doc = XElement.Parse(bodyXml, LoadOptions.PreserveWhitespace);
        return DropImporterBoxOutputs(doc) ? doc.ToString(SaveOptions.DisableFormatting) : bodyXml;
    }

    /// <summary>The same repair on a live element, for the SPLICE path — where the IDE rebuilds one network
    /// through the same importer and hands back an element rather than a document.</summary>
    public static bool DropImporterBoxOutputs(XElement root)
    {
        var changed = false;

        foreach (var box in root.DescendantsAndSelf("o")
                                .Where(o => (string?)o.Attribute("t") == "BoxTreeBox")
                                .ToList())
        {
            var holder = TcArchive.Obj(box, "OutputItems");
            if (holder == null) continue;

            foreach (var op in TcArchive.List(holder, "OutputItems").ToList())
                if (string.IsNullOrEmpty(TcArchive.Str(op, "Operand")))
                {
                    op.Remove();
                    changed = true;
                }
        }

        return changed;
    }

    /// <summary>Set or clear the JUMP bit on an assignment's targets, leaving every other bit alone.
    ///
    /// <para>A jump's destination operand carries the bit as well as the item does — measured on a jump
    /// TwinCAT's own PLCopen importer built, which holds `Flags = 4` in both places (DIALECT C13). Nothing
    /// wrote it on the EDIT path, so turning an existing coil into a jump moved the item's flags 0 -> 4 and
    /// left the label operand at 0 — exactly the archive shape C13 measured as `'Done' is no valid
    /// assignment target` on the other vendor.</para>
    ///
    /// <para>BIT-PRECISE, like <see cref="WriteStorage"/> beside it and for the same reason (D26): a target
    /// may carry modifiers the text has no form for, and a whole-flags write would erase them.</para></summary>
    private static bool WriteJump(XElement e, bool jump)
    {
        var holder = TcArchive.Obj(e, "OutputItems");
        var changed = false;
        foreach (var target in TcArchive.List(holder, "OutputItems"))
        {
            var flags = TcArchive.Obj(target, "Flags");
            if (flags == null)
            {
                if (jump) throw Refuse("a jump's destination carries no flags");
                continue;
            }
            var now = TcArchive.Int(flags, "Flags");
            var next = jump ? now | TcArchive.FlagJump : now & ~TcArchive.FlagJump;
            changed |= SetInt(flags, "Flags", next);
        }
        return changed;
    }

    /// <summary>The two bits each target's COIL KIND is spelled with — <c>Negation</c> and <c>Set</c>
    /// together, per target, index-aligned with the archive's own output slots.
    ///
    /// <para><b>Per target, and both bits.</b> This was <c>WriteStorage(e, storage)</c>: ONE storage record,
    /// lifted off the assignment's VALUE, written to every output slot, and touching the <c>Set</c> bit alone.
    /// Two things followed. A fan-out whose coils disagree got the first coil's storage on all of them. And a
    /// RESET coil — which this vendor, like CODESYS, spells <c>Negation + Set</c> (<see cref="Flags.CoilFromVendor"/>)
    /// — was refused outright as having "no representation in the IDE's flag set", because <c>Negation</c> was
    /// read as a modifier rather than as half of the coil kind.</para>
    ///
    /// <para>Still BIT-PRECISE (D26): only the two coil bits are cleared and rewritten, so an edge or a jump
    /// bit the text has no form for survives an edit.</para></summary>
    private static bool WriteCoilBits(XElement e, IReadOnlyList<Operand> targets)
    {
        var holder = TcArchive.Obj(e, "OutputItems");
        var items = TcArchive.List(holder, "OutputItems");
        if (items.Count != targets.Count)
            throw Refuse($"an item changes from {items.Count} to {targets.Count} output(s)");

        const int coilBits = TcArchive.FlagNegation | TcArchive.FlagSet;
        var changed = false;
        for (int i = 0; i < items.Count; i++)
        {
            var (negation, set) = (targets[i].Flags ?? Flags.None).VendorCoilBits();
            var flags = TcArchive.Obj(items[i], "Flags");
            if (flags == null)
            {
                if (negation || set) throw Refuse("a SET or RESET coil carries no flags");
                continue;
            }
            var next = (TcArchive.Int(flags, "Flags") & ~coilBits)
                     | (negation ? TcArchive.FlagNegation : 0)
                     | (set ? TcArchive.FlagSet : 0);
            changed |= SetInt(flags, "Flags", next);
        }
        return changed;
    }

    private static bool WriteOutputs(XElement e, IReadOnlyList<Operand> targets)
    {
        var holder = TcArchive.Obj(e, "OutputItems");
        var items = TcArchive.List(holder, "OutputItems");
        if (items.Count != targets.Count)
            throw Refuse($"an item changes from {items.Count} to {targets.Count} output(s)");

        bool changed = false;
        for (int i = 0; i < items.Count; i++)
            changed |= WriteOutputOperand(items[i], targets[i]);
        return changed;
    }

    private static bool WriteOperand(XElement owner, string name, Operand? op)
    {
        var o = TcArchive.Obj(owner, name);
        if (o == null)
            return op == null || op.Text.Length == 0
                ? false
                : throw Refuse($"an operand appears in '{name}', where the IDE wrote none");
        return op == null ? false : WriteOperandInto(o, op);
    }

    /// <summary>Write ONLY what the pushed model can actually carry.
    ///
    /// <para>This assigned six members unconditionally, from a model that on the push path is ALWAYS text-derived
    /// - <c>NetworkTextGate.Validate</c> -> <c>NetworkTextReader</c>, which builds <c>new Operand(name)</c>.
    /// Network text has no syntax for an operand's declared TYPE, its symbol COMMENT or its l-value marker, so
    /// those fields arrive null/false for every operand of every network, and writing them ERASED the IDE's own
    /// values. Measured on the vendor's own files: <c>Type: "BOOL" -> ""</c> on three operands of POU_PBD, and
    /// <c>LValue: true -> false</c> on ladder.TcPOU - from a push that changed NOTHING.</para>
    ///
    /// <para>And it needed no body edit to happen: <c>PushService</c> sends the item's own body on every push, so
    /// renaming a variable in the VAR block ran this over the whole program.</para>
    ///
    /// <para><b>Type, SymbolComment and LValue are the IDE's.</b> It resolves the type from the declaration, the
    /// comment from the symbol, and the l-value marker from the operand's position in the tree. Volt neither
    /// authors nor represents them, so it must not write them - reading them is the whole of its business here.
    /// <c>IsInstance</c> is the same: which box is an FB call is the IDE's classification.</para></summary>
    private static bool WriteOperandInto(XElement o, Operand op) =>
        SetString(o, "Operand", op.Text)
      | WriteFlags(o, op.Flags);

    /// <summary>Volt's flags as the vendor's bit-field, written into the <c>Flags</c> object the IDE already
    /// put there. A <c>BoxTreeOperand</c> has NO such member — its flags live on the operand it holds — so a
    /// leaf whose flags changed is refused here rather than growing a member the vendor never writes.</summary>
    private static bool WriteFlags(XElement owner, Flags? flags)
    {
        var bits = Bits(flags);
        var holder = TcArchive.Obj(owner, "Flags");
        if (holder == null)
            return bits == 0 ? false : throw Refuse("a modifier appears on an item that carries none");
        return SetInt(holder, "Flags", bits);
    }

    /// <summary><c>Reset</c> is REFUSED rather than dropped: network text can express a reset coil and the
    /// vendor's flag set (Negation/Set/Jump/Return/Rtrig/Ftrig) cannot, so writing a plain coil instead would
    /// change what the program does.</summary>
    private static int Bits(Flags? flags)
    {
        if (flags is not { } f || f.IsNone) return 0;
        if (f.Reset)
            throw new NotSupportedException(
                "TwinCAT: a RESET modifier has no representation in the IDE's flag set. Refusing rather than " +
                "writing a plain coil, which would change what the program does.");
        int bits = 0;
        if (f.Negated) bits |= TcArchive.FlagNegation;
        if (f.Set) bits |= TcArchive.FlagSet;
        if (f.Jump) bits |= TcArchive.FlagJump;
        if (f.Return) bits |= TcArchive.FlagReturn;
        if (f.Rising) bits |= TcArchive.FlagRtrig;
        if (f.Falling) bits |= TcArchive.FlagFtrig;
        return bits;
    }

    // -- the only mutation in this file --------------------------------------------------------------

    /// <summary>Assign to a scalar member THAT EXISTS. Every write in this file goes through here, so "the
    /// writer never adds a member" is a property of one function rather than a convention twenty call sites
    /// have to remember. A missing member is a refusal, never an insertion.</summary>
    private static bool Set(XElement owner, string name, string raw, string current)
    {
        if (current == raw) return false;
        var v = owner.Elements("v").FirstOrDefault(x => (string?)x.Attribute("n") == name);
        if (v == null)
            throw Refuse($"'{name}' would have to be added to a '{TcArchive.TypeOf(owner) ?? "?"}', " +
                         "and the IDE did not write it there");
        v.Value = raw;
        return true;
    }

    /// <summary>Like <see cref="SetString"/>, but a difference in TRAILING WHITESPACE alone is not a change —
    /// the IDE's copy carries the engineer's newline and the model's does not (see the call site).</summary>
    private static bool SetText(XElement owner, string name, string? text) =>
        (TcArchive.Str(owner, name) ?? "").TrimEnd() == (text ?? "").TrimEnd()
            ? false
            : SetString(owner, name, text);

    private static bool SetString(XElement owner, string name, string? text) =>
        Set(owner, name, "\"" + (text ?? "") + "\"", "\"" + (TcArchive.Str(owner, name) ?? "") + "\"");

    private static bool SetBool(XElement owner, string name, bool b) =>
        Set(owner, name, b ? "true" : "false", TcArchive.Bool(owner, name) ? "true" : "false");

    private static bool SetInt(XElement owner, string name, int i) =>
        Set(owner, name, i.ToString(CultureInfo.InvariantCulture),
            TcArchive.Int(owner, name).ToString(CultureInfo.InvariantCulture));
}
