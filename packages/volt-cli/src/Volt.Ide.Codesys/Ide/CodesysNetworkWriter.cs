using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Format.St;
using Volt.Engine.Format.Network;
// `Parallel` is also System.Threading.Tasks.Parallel; this file means the LD branch.
using Parallel = Volt.Engine.Format.Network.Parallel;

namespace Volt.Ide.Codesys
{
    /// <summary>
    /// Writes a <see cref="NetworkBody"/> back as LIVE typed objects, inside one
    /// <c>GetObjectToModify</c>/<c>SetObject</c> transaction.
    ///
    /// <para><b>Nothing is regenerated.</b> The previous transport rebuilt the whole PLCopen body from a
    /// projection on every write, which is why it needed a carry rule (to keep ids, vendor <c>addData</c> and
    /// comment boxes on networks the engineer had not touched), a convergence gate (so push→pull→push settled
    /// instead of oscillating) and a capability guard scoped to what a regeneration would discard. A network
    /// whose text is unchanged is simply not written here, so none of that machinery has anything to do.</para>
    ///
    /// <para>Construction is by PUBLIC constructor — measured, no private-reflection trick — and the vendor
    /// derives what it can: setting <c>BoxType="AND"</c> and appending two inputs produced
    /// <c>CallType=Operator.And</c> and <c>EnEno=true</c> unasked. So the writer supplies the type NAME and the
    /// structure, and never computes a classification the IDE owns.</para>
    /// </summary>
    internal static class CodesysNetworkWriter
    {
        /// <summary>Write <paramref name="body"/> into <paramref name="iobj"/>, the object the IDE hands out to modify.
        /// The transaction around it (<c>CodesysObjectModel.ModifyObject</c>) is the driver's: it is the vendor's
        /// ObjectManager, which no offline test has, and the writes and refusals made here — the view, a missing body slot — are what
        /// a test must reach.</summary>
        /// <param name="scope">The scope the body was read against — the change gate renders the live network
        /// against it to compare (see <see cref="TreesUnchanged"/>).</param>
        internal static void Write(object? iobj, NetworkBody body, NetworkScope scope)
        {
            // An object with no Implementation aspect holds no body: a fact about the target, refused by name as
            // UNSUPPORTED (openspec bridge-refusal-review 2.21) — it was an InvalidOperationException, which the push
            // reports as INTERNAL_ERROR, a Volt bug.
            var impl = NwlInterop.Get(iobj, "Implementation")
                ?? throw new NotSupportedException(
                    "CODESYS: this object has no Implementation aspect, so it holds no body — a graphical body cannot " +
                    "be written into it.");

            // THE VIEW IS WRITTEN (openspec bridge-refusal-review 2.22, D7). Network text states FBD or LD once, on
            // the body's IMPLEMENTATION line — the sole textual difference between the two — and the view is one
            // writable string member of the aspect. It was refused as "nothing here writes it", which made a
            // marker-only edit a refusal on this vendor while TwinCAT writes the same member through its archive.
            // ...but only when there IS one. A body that is not graphical YET — a freshly created accessor, whose
            // Implementation is still an `STImplementationObject` — has no `DefaultViewMode` member at all. There is
            // no view to set when there is no diagram yet.
            if (NwlInterop.Has(impl, "DefaultViewMode")) WriteView(impl, CodesysDriver.ViewModeText(impl), body.Language);

            // Match the network COUNT first, through the aspect's own API. `NetworkList` is read-only,
            // and an earlier version of this file refused a count change outright as "not measured" - which
            // failed every splice test, because splicing a body is exactly where a network appears or goes.
            // The aspect has AppendNetwork / InsertNetwork / RemoveNetwork / ReplaceNetwork; nothing here
            // needs the archive back door (SetSerializableValue), which also works but writes AROUND the
            // object model rather than through it.
            for (int i = Count(impl) - 1; i >= body.Networks.Count; i--)
                NwlInterop.Call(impl, "RemoveNetwork", i);
            while (Count(impl) < body.Networks.Count)
                NwlInterop.Call(impl, "AppendNetwork", NwlInterop.New(impl, "Network"));

            var existing = NwlInterop.Items(NwlInterop.Require(impl, "NetworkList"), listMember: "");
            for (int i = 0; i < existing.Count; i++)
                WriteNetwork(impl, existing[i], body.Networks[i], body.Language, scope);
        }

        /// <summary>Set the aspect's view to the pushed language, when it differs — in the spelling the vendor's own
        /// member holds (<c>"Ld"</c>, measured on a real ladder project, and <c>"Fbd"</c>). A body in a view Volt does
        /// not author (IL, or one it has never seen) pulls as its UNSUPPORTED line, and <c>BodyFormatGuard</c> refuses
        /// network text over such a body before any write; reaching here with one is a Volt bug, never a diagram
        /// written over an IL body.</summary>
        private static void WriteView(object impl, string? view, BodyLanguage pushed)
        {
            var stated = NetworkText.ViewLanguage(view);
            var live = NetworkText.LanguageNamed(stated)
                ?? throw new InvalidOperationException(
                    $"CODESYS: a graphical body reached the write over a body whose view is '{view}' " +
                    $"('{Volt.Engine.Format.St.ImplementationMarker.Unsupported(stated)}'), which the push's body guard " +
                    "refuses before any write. This is a Volt bug.");
            if (live == pushed) return;
            NwlInterop.Set(impl, "DefaultViewMode", pushed == BodyLanguage.Ld ? "Ld" : "Fbd");
        }

        internal static void WriteNetwork(object impl, object net, Network model, BodyLanguage language, NetworkScope scope)
        {
            SetIfChanged(net, "Title", model.Title ?? "");
            SetIfChanged(net, "Label", model.Label ?? "");
            SetIfChanged(net, "Comment", model.Comment ?? "");
            if (NwlInterop.Flag(net, "OutCommented") != model.Disabled)
                NwlInterop.Set(net, "OutCommented", model.Disabled);

            // THE CHANGE GATE. A network whose LOGIC is unchanged is not rebuilt — which is what the class
            // header above has always claimed and what, until now, nothing enforced.
            //
            // What follows is destroy-and-rebuild: every NetworkItem is removed and re-appended from the pushed
            // text. That makes the write LOSSY BY CONSTRUCTION for anything the reader does not capture or the
            // builder does not set — so without a gate, a push that touched only the DECLARATION still re-minted
            // every rung in the POU, and each re-mint silently dropped whatever the round trip cannot carry.
            // Scoping it "to ONE network" bounded the damage to every network, since PushService always sends
            // the whole body. TwinCAT's `TcNetworkWriter.Apply` has always returned null on no-change; this is
            // the same rule, and it is what stops the losses below from reaching a rung nobody edited.
            if (TreesUnchanged(net, model, language, scope)) return;

            // Before this network's items are removed. Not for atomicity — the whole write runs inside
            // `CodesysObjectModel.ModifyObject`, which rolls the checkout back on any throw, including a refusal in a
            // later network after an earlier one was already rebuilt. It is here so the refusal is judged on exactly
            // the networks the change gate above lets through (an unchanged pulled network holding the shape is never
            // refused), and so a caller with no transaction — the offline tests — sees the live network untouched.
            foreach (var tree in model.Trees) RefuseUnbuildableEno(tree, consumed: false);

            for (int i = NwlInterop.RequireInt(net, "NetworkItemCount") - 1; i >= 0; i--)
                NwlInterop.Call(net, "RemoveNetworkItem", i);

            var ctx = new BuildContext(net);
            foreach (var tree in model.Trees)
                NwlInterop.Call(net, "AppendTree", ctx.Node(tree, consumed: false));
        }

        /// <summary>Does the live network already hold exactly the logic being pushed?
        ///
        /// <para>Compared as TEXT, through the same reader and writer a pull uses, because that is the only
        /// definition of "the same" that matters here: two bodies are equal exactly when they materialize to the
        /// same file. Comparing the object graphs instead would re-implement the reader and drift from it.</para>
        ///
        /// <para>Only the TREES are compared. Title, label, comment and OutCommented are written above through
        /// <c>SetIfChanged</c>, which is already idempotent, so they are neutralised here (the live network's
        /// metadata is replaced by the model's) rather than dragged into a decision about logic.</para>
        ///
        /// <para><b>A body the reader REFUSES is not rebuilt.</b> If reading the live network throws — a vendor
        /// split point is the measured case — the exception propagates and the push fails. That is deliberate:
        /// Volt cannot tell whether such a body matches, and destroy-and-rebuild would delete the very construct
        /// it cannot represent. Refusing is the same answer the reader gives on pull.</para>
        ///
        /// <para><b>Rendered against the body's scope</b>, the one it was read against: the text spells a wire name
        /// and an FB instance through the declarations, so both sides must be written with the same ones. A live
        /// network the writer has no spelling for throws <c>UnrepresentableBodyException</c> — like a reader
        /// refusal, it is not rebuilt, because a rebuild would delete the fact the text could not carry.</para></summary>
        private static bool TreesUnchanged(object net, Network model, BodyLanguage language, NetworkScope scope)
        {
            var live = CodesysNetworkReader.ReadNetwork(net, model.Order);
            return Render(live with { Title = model.Title, Label = model.Label, Comment = model.Comment, Disabled = model.Disabled }, language, scope)
                == Render(model, language, scope);
        }

        /// <summary>
        /// THE PUSH HALF OF "EN IS A PIN, ENO IS SPELLED" (spec; task 4.1): refuse, naming the box, a consumer the box
        /// CODESYS builds would read through another output than the text states — or a box it would not build at all.
        ///
        /// <para><b>What decides is EN, not the output list.</b> The spec asks for "the IDE's box", and on CODESYS that is
        /// not something Volt can read back: the vendor derives no <c>OutputParams</c> from the box type (on construction,
        /// commit or build), and the <c>MainOutputIndex</c> a consumer is read through (N16) is read-only and stays unset
        /// on a box Volt constructs. Measured by running each shape (DIALECT N21): a consumed enabled MOVE is read through
        /// its ENO whatever list Volt writes, a consumed enabled comparison does not compile in any list, and an operator
        /// with no EN carrying an ENO slot is "Missing EN pin". So the text's reading (<see cref="NetworkText.HasEnoOutput"/>)
        /// is compared with what the built box will do. Only the shapes that would feed a consumer ANOTHER value than the
        /// text says, or that Volt cannot build, are refused: "Missing EN pin" is a compile error the build names, so
        /// <c>.ENO</c> on a box with no EN is written (openspec <c>bridge-refusal-review</c> 1.5).</para>
        ///
        /// <para>Only a CONSUMED box has a consumer to misread; every top-level shape built clean. An Execute box's ENO is
        /// its type's, and an FB call may declare <c>ENO</c> without EN (Lenze <c>Dryer</c>, N16), so neither is refused
        /// on the missing EN. A pulled body holding the 40 drawn enabled comparisons still round-trips: the change gate
        /// above never rebuilds a network whose text is unchanged.</para>
        /// </summary>
        private static void RefuseUnbuildableEno(Node n, bool consumed)
        {
            // The comparison family is the engine's (`NetworkText.IsComparison`): DIALECT N21 measured it on GT as not
            // compiling when Volt builds one consumed with EN, in any output list Volt can write.
            if (n is Box b && consumed && b.StCode is null)
            {
                var readsEno = NetworkText.HasEnoOutput(b, consumed: true);
                if (b.Enable is not null && NetworkText.IsComparison(b.Type))
                    throw Unbuildable(b, "a consumed enabled comparison: CODESYS does not compile one Volt builds, " +
                                         "with or without `.ENO` (its result variable hangs off an output index Volt " +
                                         "cannot set, DIALECT N21)");
                if (b.Enable is not null && !readsEno)
                    throw Unbuildable(b, "the text reads its main output (no `.ENO`), and CODESYS reads a box Volt " +
                                         "builds with EN through its ENO (DIALECT N21) — the push would feed the " +
                                         "consumer the enable, not the data. Write `.ENO` if that is meant");
                // `.ENO` on a box with no EN is NOT refused (openspec bridge-refusal-review 1.5): Volt builds the box the
                // text describes, and CODESYS's build reports it ("Missing EN pin", DIALECT N21) — the build's error.
            }
            // Everything below the top level is consumed by its parent.
            foreach (var child in n.Children()) RefuseUnbuildableEno(child, consumed: true);
        }

        private static NotSupportedException Unbuildable(Box b, string why) =>
            new($"CODESYS: the '{b.Type}' box is {why}. Refusing rather than build a network whose consumer reads " +
                "another output than the text says, or that does not compile. The IDE can edit this network.");

        private static string Render(Network network, BodyLanguage language, NetworkScope scope) =>
            NetworkTextWriter.Write(new NetworkBody(language, new[] { network }), scope);

        private static int Count(object impl) =>
            NwlInterop.Items(NwlInterop.Require(impl, "NetworkList"), listMember: "").Count;

        /// <summary>Write a string member only when it really differs — comparing with TRAILING WHITESPACE
        /// ignored, because the IDE stores a title or comment with the newline the engineer typed after it and
        /// the model holds it trimmed (see the reader's `Clean`). Without that, every push rewrote a title
        /// nobody had touched.</summary>
        private static void SetIfChanged(object o, string member, string value)
        {
            var current = NwlInterop.Text(o, member) ?? "";
            if (current.TrimEnd() != value.TrimEnd()) NwlInterop.Set(o, member, value);
        }

        /// <summary>Per-network build state.</summary>
        private sealed class BuildContext
        {
            private readonly object _net;

            public BuildContext(object net) { _net = net; }

            /// <param name="consumed">Whether something consumes the node — everything but a top-level item. The
            /// text reads a box's ENO output differently at the top level (<c>NetworkText.HasEnoOutput</c>).</param>
            public object Node(Node n, bool consumed = true)
            {
                switch (n)
                {
                    // A LEAF'S MODIFIERS GO ON ITS OPERAND, mirroring the read. `BoxTreeOperand` carries no
                    // Flags member of its own (DIALECT N4), so applying them to the ITEM reaches nothing — and
                    // now that the reader correctly lifts the operand's flags onto the leaf, applying them to
                    // the item would hit ApplyFlags' "carries no Flags" throw on every negated contact.
                    case Leaf l:
                        return NwlInterop.New(_net, "BoxTreeOperand", Operand(l.Operand, l.Flags));

                    case Assign a:
                    {
                        // STORAGE USED TO BE LIFTED OFF THE VALUE HERE, and the two paragraphs that stood
                        // in this place described that design in the present tense long after it was gone.
                        // What they recorded is still worth keeping: the write took `a.Value?.Flags` WHOLE and
                        // applied every bit to each target, so the NOT in `out := NOT a;` landed on the COIL as
                        // well as the input and the IDE ran `out := NOT NOT a` — the inverse of the committed
                        // source. Invisible from every direction Volt had: the reader lifted only storage back
                        // off a target, the text writer rendered no modifier on a target at all, so the next
                        // pull was byte-identical and the change gate said "unchanged"; and a negated BOOL coil
                        // COMPILES, so the build oracle was blind too. The format spells storage on the coil
                        // now, so there is nothing to lift and nothing to strip.
                        //
                        // STORAGE COMES OFF THE TARGET, because that is where the model carries it and where
                        // this vendor keeps it. It used to be lifted off the VALUE (`CoilStorage`, deleted) to
                        // suit the old `out := v SET;` spelling, applied as ONE record to every target — so a
                        // fan-out whose coils disagreed got the first coil's storage on all of them.
                        var asg = NwlInterop.New(_net, "BoxTreeAssign");
                        NwlInterop.Set(asg, "RValue", Node(a.Value));
                        // A JUMP RIDES ON THE TARGET OPERAND, exactly like coil storage — and putting it on
                        // the ITEM instead made every jump a COMPILE ERROR.
                        //
                        // `Flagged(asg, a.Flags)` set `Jump` on the `BoxTreeAssign`, which the IDE does not
                        // read: it drew the rung as an ordinary coil assigning to the label, and CODESYS
                        // answered `Identifier 'Done' not defined` / `'Done' is no valid assignment target`,
                        // plus `The label 'DONE' has not been referenced` — the label existed and nothing
                        // jumped to it. Measured by moving the bit and rebuilding: 2 errors and 1 warning
                        // became a clean build.
                        //
                        // The bit goes in BOTH places, because that is what the vendor itself writes — read off
                        // a jump TwinCAT's own importer built (`VltProbe_Jump.TcPOU`): `Flags = 4` on the output
                        // `Operand` AND on the `BoxTreeAssign`. Only the operand is load-bearing for the
                        // compiler (stripping the item's bit still built clean), but "it compiles" is a weaker
                        // claim than "it is what the IDE would have written", and the two vendors share this
                        // object model member-for-member (N1), so the other one's importer is evidence here.
                        //
                        // RETURN RIDES ON THE TARGET TOO (DIALECT C13's correction): a return an engineer draws
                        // has the vendor's `???` in its target slot with `Return` on it, and network text v2 reads
                        // `RETURN;` into exactly that shape. This once said a return has no target to carry the
                        // bit — true of the model v1 text built, which had none — and the writer kept writing
                        // only `Jump` here, so under v2 the IDE got a coil assigning to `???` and the build said
                        // "The assignment target is not specified." (`ng_conditional_jump_and_return`, re-recorded
                        // 2026-09-27). The item keeps its bit as well, as for a jump.
                        //
                        // NOTHING IN A ROUND TRIP COULD HAVE CAUGHT THIS. Volt wrote the bit to the item and
                        // read it back from the item, so the text was byte-identical while the IDE disagreed
                        // with both halves. Only a BUILD sees it, which is why the jump tests now do one.
                        var outputs = NwlInterop.Require(asg, "Outputs");
                        foreach (var t in a.Targets)
                        {
                            // ENCODED, not applied on top. A target's flags are a COIL KIND, and the vendor
                            // spells that kind with `Negation`/`Set` (`Flags.VendorCoilBits`, the inverse of
                            // the reader's decode — `CoilBitsRoundTrip` gates that the pair agrees). Handing
                            // the raw target to `Operand(o, extra)` would send `Reset` through `ApplyFlags`,
                            // which knows only the vendor's own bit names and has no Reset to write.
                            var (negation, set) = (t.Flags ?? Flags.None).VendorCoilBits();
                            var coil = t with
                            {
                                Flags = Flags.None with { Negated = negation, Set = set, Jump = a.Flags.Jump, Return = a.Flags.Return },
                            };
                            NwlInterop.Call(outputs, "AppendOutputItem", Operand(coil));
                        }
                        return Flagged(asg, a.Flags);
                    }

                    case Box b:
                    {
                        // AN FB CALL'S TYPE IS NOT ITS INSTANCE NAME. Network text carries ONE name for a call —
                        // `t1(...)` — and its reader takes the TYPE from the declarations (`NetworkScope`: `t1 :
                        // TON`), so the model arrives with `Type: "TON", Instance: "t1"`, as a pull reads it. (v1's
                        // reader built `Type: "t1"` and this writer resolved it here from the declaration; that
                        // resolver went with the v1 text, task 3.9.) An FB call with no instance names no box the IDE
                        // can resolve at all, and is refused rather than written with the instance name as its type.
                        // Unreachable from a push: the reader builds every FB call with its instance and its type
                        // from the declarations. A model without one is Volt's bug (openspec bridge-refusal-review 2.20).
                        if (b.Kind == CallKind.FunctionBlock && b.Instance is null)
                            throw new InvalidOperationException(
                                $"network model invariant: the function-block call '{b.Type}' carries no instance; the " +
                                "reader builds every FB call with one.");

                        var box = NwlInterop.New(_net, "BoxTreeBox");
                        // The TYPE NAME only: CallType and EnEno are the vendor's to derive, and it does.
                        NwlInterop.Set(box, "BoxType", b.Type);

                        // Everything else the READER models on a box had no counterpart here and was dropped in
                        // silence: an FB call lost its instance, an embedded output vanished, an EN pin was
                        // forgotten. Each is set through the member the reader reads, so the two cannot drift -
                        // and NwlInterop fails loud (naming the observed assembly version) if a member is not
                        // there, which is the whole reason this vendor's typed model is safer than an archive.
                        // AN INSTANCE IS WRITTEN, AND SO IS THE ABSENCE OF ONE.
                        //
                        // A freshly constructed `BoxTreeBox` does not arrive blank: its `Instance` operand
                        // holds `???`, the vendor's own unresolved-instance marker (measured by dumping a
                        // created box beside an engineer-drawn one — `probe-nwl-execute-compare.py` (deleted; `git show b2496efb4b:packages/volt-cli/scripts/probe-nwl-execute-compare.py`):
                        // created `Instance.OperandExpr = '???'`, real `= None`). Leaving it there hands the
                        // compiler an operand that is not an expression, and the build answers `Expression
                        // expected instead of '?'` — on a body that LOADS and round-trips byte-for-byte, so
                        // neither the text, the reader nor the canonical gate can see it. C13 again.
                        //
                        // The reader already knows this marker means "no instance" (an empty `OperandExpr` is
                        // how the vendor spells one); the writer has to say it too, or every box Volt creates
                        // without an instance carries a marker the engineer never drew.
                        if (b.Instance is { } inst) WriteInstance(box, inst);
                        else NwlInterop.Set(NwlInterop.Require(box, "Instance"), "OperandExpr", "");

                        // AN EXECUTE BOX CARRIES RAW ST ON THE BOX ITSELF, and constructing one IS measured
                        // now (`probe-nwl-execute-create.py` (deleted; `git show b2496efb4b:packages/volt-cli/scripts/probe-nwl-execute-create.py`), live SP21): `STSnippet` and
                        // `STImplementationObject` both have public parameterless constructors, `Snippet` is
                        // settable through `ISTSnippet`, and setting `box.STSnippet` flips `ProvidesSTSnippet`
                        // on its own. Committed, reloaded, read back byte-identical.
                        //
                        // THE TEXT GOES IN THROUGH `Insert`, NOT `Text`. Both throw, and only one works:
                        // `set_Text` clears the document first (`TextDocument.Remove`), which underflows on a
                        // document with no line info — `ArgumentOutOfRangeException: Non-negative number
                        // required` — and leaves the text EMPTY. `Insert(0, …)` lands the text and then throws
                        // `InvalidOperationException: Unique ID generator not available`, an editor-bookkeeping
                        // service this document has no host for. So the throw is caught and the POSTCONDITION
                        // IS VERIFIED: the text is read back and compared. That is what makes this a measured
                        // vendor quirk rather than a swallowed error — if the ST did not land, this throws.
                        if (b.StCode is not null)
                        {
                            var snippet = NwlInterop.New(box, "STSnippet");
                            var stImpl = Activator.CreateInstance(
                                Reflection.FindType("_3S.CoDeSys.STObject.STImplementationObject")
                                ?? throw new InvalidOperationException(
                                    "CODESYS: _3S.CoDeSys.STObject.STImplementationObject is not loaded, so an " +
                                    "Execute box's ST has nowhere to live."))!;
                            NwlInterop.Set(snippet, "Snippet", stImpl);

                            var doc = NwlInterop.Require(stImpl, "TextDocument");
                            try { NwlInterop.Call(doc, "Insert", 0, b.StCode); }
                            catch (InvalidOperationException) { /* the UID generator; the text still lands */ }

                            if (!string.Equals(NwlInterop.Text(doc, "Text"), b.StCode, StringComparison.Ordinal))
                                throw new InvalidOperationException(
                                    $"CODESYS: the Execute box '{b.Type}' did not take its ST — the document " +
                                    "read back different text than was written. Refusing rather than creating " +
                                    "a box whose code is gone.");

                            NwlInterop.Set(box, "STSnippet", snippet);
                        }


                        // THE ENABLE IS INPUT SLOT 0 — appended first, and named `EN` in the param list below,
                        // which is exactly how the reader finds it again (`Box.HasEnableSlot`).
                        //
                        // This used to REFUSE a wired enable outright: "the vendor's `En` member is a nullable
                        // BOOLEAN, not a wired expression, so there is nowhere to put the enable's tree." The
                        // first half was measured and true; the conclusion was not. `En` is the "EN/ENO is
                        // shown on this box" flag, and the enable's EXPRESSION is an ordinary input item — 220
                        // of 220 boxes with one, in a real project. So there was somewhere to put it after all,
                        // and every push carrying an enable was refused for want of looking one slot over.
                        if (b.Enable is { } en)
                        {
                            NwlInterop.Call(box, "AppendInputItem", Node(en));
                            NwlInterop.Set(box, "En", true);
                            NwlInterop.Set(box, "Eno", true);   // shown as a pair, and the vendor sets both
                        }

                        foreach (var p in b.Inputs)
                            NwlInterop.Call(box, "AppendInputItem", Node(p.Value));

                        // FORMAL PIN NAMES, where the model has them. `AppendInputItem` supplies only the value
                        // WIRED to a pin, never the pin's name, and `InputParams` is where the reader looks for
                        // it - so a call written without this came back with none: the next pull rendered
                        // `t1( := a,  := pt)`, which no longer parses, and the POU could never be pushed again.
                        //
                        // An OPERATOR has no formal names (its pins are positional) and must not be given any.
                        // The TYPE is left empty on purpose: it is the IDE's to resolve from the box type, and
                        // the vendor's own PLCopen export writes an empty `InputParamTypes` for the same reason.
                        // The pin names, in the SAME order the items were appended — so an enable occupies
                        // slot 0 under the name the reader looks for. Written whenever any pin is named OR an
                        // enable is present: an enable on an otherwise positional operator (`MOVE`, `MUL` — the
                        // commonest shape in a ladder) still has to name its own slot, or the reader cannot
                        // tell the rung from a data operand on the way back in.
                        if (b.Enable is not null || b.Inputs.Any(i => !string.IsNullOrEmpty(i.Formal)))
                        {
                            var pins = NwlInterop.Require(box, "InputParams");
                            if (b.Enable is not null) NwlInterop.Call(pins, "AppendParam", Box.EnablePin, "");
                            foreach (var p in b.Inputs)
                                NwlInterop.Call(pins, "AppendParam", p.Formal ?? "", "");
                        }

                        // THE BOX'S OWN OUTPUT PINS, and the `ENO` ECHO IN FRONT OF THEM.
                        //
                        // `Outputs.AppendOutputItem` takes an `Operand` and the result survives save-and-reload
                        // with `CallType` resolved from `BoxType` by the vendor (`probe-nwl-boxoutputs.py` (deleted; `git show b2496efb4b:packages/volt-cli/scripts/probe-nwl-boxoutputs.py`)).
                        // Names go in `OutputParams`, the way input names go in `InputParams`.
                        //
                        // <b>AN ENABLED BOX NEEDS ITS ENO SLOT, and leaving it out compiled to an error.</b> A
                        // box Volt built with an enable and no output slot LOADS and round-trips byte-for-byte,
                        // and the build answers `Expression expected instead of '?'` — the IDE drawing an empty
                        // pin. The vendor's own enabled boxes all carry it: `OutputParams.Names[0] == "ENO"`
                        // with `Outputs[0]` NULL (measured on 181 boxes, `nwl-census.log` (deleted; `git show b2496efb4b:packages/volt-cli/scripts/nwl-census.log`)). So the echo
                        // is written as the vendor writes it — a named slot holding nothing — and the data pins
                        // follow it, which is also what keeps their names aligned on the way back in.
                        //
                        // This is the C13 shape again: a self-consistent round trip said the body was fine
                        // while the compiler disagreed with it, which is why this is gated by a BUILD.
                        //
                        // <b>WHETHER THE BOX HAS AN ENO OUTPUT IS THE MODEL'S FACT, NOT ITS EN.</b> The two are
                        // independent (DIALECT N16, census 1.6: 40 enabled comparisons have EN and no ENO), and the
                        // text keeps them apart — `x := GT(EN := c, a, b)` reads x off the comparison, `… .ENO` off
                        // the ENO. Keyed on EN, both got the ENO slot, the reader then found a box with an ENO output
                        // whose consumer reads its main output — the ENO — and the next pull said `.ENO`: x fed by
                        // ENO, a different program. Null is where the text has no position for the fact (a
                        // top-level box with no positional pin, a consumed operator with no EN), and there the box
                        // is built as the text reads it — by the text's own rule, never a copy of it here. A null
                        // where the text DOES state the fact never gets this far: the change gate renders the model
                        // first, and the text writer refuses it by name.
                        var eno = NetworkText.HasEnoOutput(b, consumed);
                        var slots = OutputSlots(b, eno);
                        if (slots.Count > 0)
                        {
                            var outs = NwlInterop.Require(box, "Outputs");
                            // AN EMPTY OPERAND, not a null, for the echo and for a slot passed over. The vendor
                            // STORES the echo slot as null but will not ACCEPT one: <c>AppendOutputItem(null)</c>
                            // answers "Object reference not set to an instance of an object". An empty operand is
                            // the shape its own PLCopen importer hangs off a box (see <c>DropImporterBoxOutputs</c>
                            // on the TwinCAT side) and the shape of every unwired pin on a resolved FB box, and the
                            // reader skips an empty output slot, so it round-trips as the nothing it is.
                            foreach (var (_, value) in slots)
                                NwlInterop.Call(outs, "AppendOutputItem", Operand(value ?? new Operand("")));
                        }

                        // THE OUTPUT NAMES AND STORED TYPES, index-aligned with the slots as the reader reads them back
                        // (`OutputParams`). The vendor derives neither (DIALECT N21: `OutputParams` holds exactly what the
                        // writer appended), so a type the model carries and this does not write is a type the next pull
                        // does not have — a data wire read back "of unknown type". A slot only a TYPE names (the one a
                        // wire is connected to) gets a param and NO output item: the vendor stores the connected slot as
                        // null, and an empty operand there is an assignment to nothing — measured live, the build answers
                        // "The assignment target is not specified".
                        var types = b.OutputTypes ?? Array.Empty<string?>();
                        if (slots.Any(x => !string.IsNullOrEmpty(x.Formal)) || types.Any(t => t is not null))
                        {
                            var outPins = NwlInterop.Require(box, "OutputParams");
                            for (var i = 0; i < Math.Max(slots.Count, types.Count); i++)
                                NwlInterop.Call(outPins, "AppendParam",
                                    (i < slots.Count ? slots[i].Formal : null) ?? "", (i < types.Count ? types[i] : null) ?? "");
                        }

                        // THE REFUSAL THAT USED TO STAND HERE said a box's embedded output "has no network
                        // text form, so rebuilding it would drop the pin's variable from the project" — true
                        // when it was written, and the reason it was written is worth keeping: a TON whose `ET`
                        // pin carries `elapsed` on the pin itself pulled as `t1(IN := a, PT := pt);` with
                        // `elapsed` nowhere in the file, and the next edit to that network dropped it from the
                        // live project with no diff, no diagnostic and no compile error. The format spells the
                        // pin now (`ET => elapsed`), so the honest answer is to write it rather than refuse it.

                        return Flagged(box, b.Flags);
                    }

                    // THE WIRE ID IS WRITTEN AS THE MODEL CARRIES IT.
                    //
                    // This used to mint a fresh id from the aspect's own allocator for every wire, so editing
                    // anything in a network renumbered all of its fan-out. Measured live: changing one operand
                    // moved `LET g0` to `LET g2`, while the untouched network beside it kept `g1` because the
                    // change gate spared it. The engineer got wires they never touched renamed in the same
                    // commit as the edit they did make — noise in a diff, from the one tool whose entire value
                    // is that the diff is honest.
                    //
                    // Minting was there against a collision that does not exist: ids are NETWORK-scoped, not
                    // body-unique. Measured by pushing the same `g0` in two networks — both came back `g0`,
                    // each pairing with its own references. And TwinCAT has always written `d.VarId` straight
                    // through, so the minting was also the divergence, not the reuse.
                    case Demux d:
                    {
                        var dm = NwlInterop.New(_net, "BoxTreeDemux");
                        NwlInterop.Set(dm, "VarId", d.VarId);
                        // With an Input this DEFINES the wire; without one it REFERENCES the definition
                        // carrying the same id.
                        // The producer carries the type the text declared the wire with, which the box writes into
                        // `OutputParams.Types` — the one place the vendor keeps it, and it derives none itself (N21).
                        if (d.Input is { } src) NwlInterop.Call(dm, "SetInputTree", 0, Node(NetworkText.WithDeclaredType(src, d.Type)));
                        // No flags: the model has none on a Demux, because the IDE stores none (DIALECT N20). This
                        // used to call Flagged(dm, d.Flags), which set bits on an IFlags the node hands out and never
                        // keeps — the push reported success and the wire ran un-negated.
                        return dm;
                    }

                    case Terminator t:
                        return Flagged(NwlInterop.New(_net, "BoxTreeTerminator"), t.Flags);

                    case Parallel p:
                    {
                        var par = NwlInterop.New(_net, "BoxTreeParallel");
                        if (p.Input is { } pi) NwlInterop.Call(par, "SetInputTree", 0, Node(pi));
                        foreach (var branch in p.Branches) NwlInterop.Call(par, "Append", Node(branch));
                        // SET, never left: a freshly constructed BoxTreeParallel is `Sequential` (DIALECT N20) while
                        // 16 of 17 real ones are `BoxShortCircuit` (census 1.3), so leaving it flipped the evaluation
                        // mode of every Parallel a push rebuilt — and no reader looked, so no pull showed it.
                        // No flags, for the Demux reason above.
                        NwlInterop.SetEnum(par, "Mode", p.Mode.ToString());
                        return par;
                    }

                    default:
                        throw new NotSupportedException(
                            $"CODESYS: no way to write the graphical node '{n.GetType().Name}' — refusing " +
                            "rather than writing a body that is not what the source says.");
                }
            }

            /// <summary>The box's output slots as the vendor lists them: the <c>ENO</c> echo first when the box has
            /// an ENO output, then each pin AT ITS SLOT (task 3.10) — a positional <c>=&gt; v</c> is spelled by the slot it
            /// fills, so <c>f(a, =&gt;, =&gt; x)</c> puts <c>x</c> on slot 2 with slot 1 passed over, and writing the
            /// pins one after another would move <c>x</c> onto slot 1: another output, a different program. A pin
            /// with no stored slot (a named one — the text carries its name, not its position) takes the next.</summary>
            private static List<(string? Formal, Operand? Value)> OutputSlots(Box b, bool eno)
            {
                var slots = new List<(string? Formal, Operand? Value)>();
                if (eno) slots.Add((Box.EnoPin, null));
                foreach (var o in b.Outputs)
                {
                    if (o.Slot is { } at)
                    {
                        if (at < slots.Count)
                            throw new NotSupportedException(
                                $"CODESYS: the '{b.Type}' box wires output slot {at} to '{o.Value.Text}', a slot " +
                                (eno && at == 0 ? "its ENO echo holds" : "another pin already holds") +
                                " — refusing rather than write the pin onto another output.");
                        while (slots.Count < at) slots.Add((null, null));
                    }
                    slots.Add((o.Formal, o.Value));
                }
                return slots;
            }

            /// <summary>Name the function-block instance a box calls — by MUTATING the operand the box already
            /// holds, not by replacing it.
            ///
            /// <para><b><c>IBoxTreeBox.Instance</c> is READ-ONLY on this build.</b> Reflected over the shipped
            /// <c>NWLObject.plugin</c> 4.6.0.0: the property has a getter and no setter, so assigning to it
            /// threw "'BoxTreeBox' has no 'Instance (writable)'" and creating an FB-instance call from text
            /// failed outright — `t1(IN := a, PT := pt)` could not be pushed at all. That refusal was accurate
            /// about the object model and wrong about what to do with it.</para>
            ///
            /// <para><c>IOperand.OperandExpr</c> IS writable, and the box arrives holding an operand already, so
            /// the instance name goes there. TwinCAT reaches the same member through its archive
            /// (<c>&lt;o n="Instance"&gt;</c>), so this is the two vendors writing the same field.</para></summary>
            private void WriteInstance(object box, Operand inst)
            {
                var op = NwlInterop.Require(box, "Instance");
                NwlInterop.Set(op, "OperandExpr", inst.Text);
                // `Type` is NOT written here — see `Operand` below for why it never could be.
                ApplyFlags(op, inst.Flags);
            }

            private object Operand(Operand o) => Operand(o, Flags.None);

            /// <summary>Build the vendor operand. <paramref name="extra"/> is applied ON TOP of the operand's own
            /// modifiers, never instead of them, and serves the two places the model keeps a modifier somewhere
            /// other than on the operand itself: coil STORAGE, which belongs on an assignment target, and a
            /// LEAF's flags, which the model carries on the node while the vendor keeps them on the operand
            /// (DIALECT N4 — <c>BoxTreeOperand</c> has no Flags member). <c>ApplyFlags</c> only ever sets bits,
            /// so nothing the engineer wrote is overwritten.</summary>
            private object Operand(Operand o, Flags extra)
            {
                var op = NwlInterop.New(_net, "Operand", o.Text);

                // `Type` AND `IsLValue` ARE THE IDE'S, and the two lines that restored them here could
                // never run. `PushService` always sends an item's body AS TEXT, so every model that reaches
                // this writer is text-derived and carries `Type = null` and `IsLValue = false` on every
                // operand — both production call sites pass exactly such a model, and network text has no
                // syntax for either field. So `if (!string.IsNullOrEmpty(o.Type)) Set(op, "Type", …)` read
                // as "Volt preserves the resolved type across a rebuild" while doing nothing at all.
                //
                // It does not need to. Measured live (`test/e2e/graphical/rebuild.test.ts`): an FB whose
                // network is edited — destroying and re-appending every item in it — still COMPILES, so the
                // IDE re-resolves the type from the declaration and the l-value marker from the operand's
                // position, exactly as `TcNetworkWriter` says it does on the other vendor. TwinCAT reaches
                // the same answer from the opposite direction: it must not write these because it edits in
                // place and would overwrite the IDE's values (measured there as `Type: "BOOL" -> ""`).
                //
                // `SymbolComment` is the one field of the three that is NOT restored and NOT re-derivable
                // from anything Volt holds. It has no build consequence and no interface Volt can observe
                // it through, so nothing here claims it survives a rebuild.
                ApplyFlags(op, o.Flags);
                if (!extra.IsNone) ApplyFlags(op, extra);
                return op;
            }

            private static object Flagged(object item, Flags f)
            {
                ApplyFlags(item, f);
                return item;
            }

            /// <summary>The vendor bit-field, set by NAME. <c>Reset</c> has no counterpart and is refused rather
            /// than dropped: network text can express a reset coil, the object model (as measured) cannot, and
            /// silently writing a plain coil would change what the program does.</summary>
            private static void ApplyFlags(object item, Flags? flags)
            {
                if (flags is not { } f || f.IsNone) return;
                // A RESET reaching here has not been through the coil encoding, and this is the wrong place to
                // do it: `Reset` is a COIL KIND, spelled by the vendor as `Negation + Set` on an assignment
                // TARGET (`Flags.CoilFromVendor`), and only the assignment arm knows which operands are
                // targets. This used to refuse outright — "a RESET modifier has no representation in the IDE's
                // flag set" — which was the belief that made every reset coil in a project pull as a SET coil.
                if (f.Reset)
                    throw new InvalidOperationException(
                        "CODESYS: a RESET reached the generic flag write. Coil storage is encoded per TARGET " +
                        "via Flags.VendorCoilBits(); a Reset anywhere else is a modifier the model should " +
                        "never have produced.");

                var target = NwlInterop.Get(item, "Flags")
                    ?? throw new InvalidOperationException(
                        $"CODESYS: '{item.GetType().Name}' carries no Flags, so its modifiers cannot be written");
                if (f.Negated) NwlInterop.Set(target, "Negation", true);
                if (f.Set) NwlInterop.Set(target, "Set", true);
                if (f.Jump) NwlInterop.Set(target, "Jump", true);
                if (f.Return) NwlInterop.Set(target, "Return", true);
                if (f.Rising) NwlInterop.Set(target, "Rtrig", true);
                if (f.Falling) NwlInterop.Set(target, "Ftrig", true);
            }
        }
    }

}
