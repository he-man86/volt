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
        public static void Write(CodesysObjectModel om, object node, NetworkBody body, string? declaration = null)
        {
            om.ModifyObject(node, iobj =>
            {
                var impl = NwlInterop.Get(iobj, "Implementation")
                    ?? throw new InvalidOperationException(
                        "CODESYS: the item has no Implementation aspect — refusing to write a graphical body " +
                        "into an item that cannot hold one");

                // THE VIEW CANNOT BE CHANGED BY A PUSH, and this is the only place that says so. Network
                // text prints FBD or LD on every network header — the sole textual difference between the
                // two — so it invites an edit that nothing applies: the member is never written on an
                // update, and the change gate below compares both sides with the language neutralised, so a
                // header-only edit wrote nothing, reported success, and was reverted by the next pull.
                // ...but only when there IS one. A body that is not graphical YET — a freshly created
                // accessor, whose Implementation is still an `STImplementationObject` — has no
                // `DefaultViewMode` member at all, and `ReadViewMode` demands it. Asking that of a CREATE
                // turned every graphical property accessor into `'STImplementationObject' has no
                // 'DefaultViewMode'`. There is no view to preserve when there is no diagram yet.
                if (NwlInterop.Get(impl, "DefaultViewMode") is not null)
                    NetworkText.RefuseViewModeChange(CodesysDriver.ReadViewMode(impl), body.Language);

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
                    WriteNetwork(impl, existing[i], body.Networks[i], declaration, body.Language);
            });
        }

        internal static void WriteNetwork(object impl, object net, Network model, string? declaration, BodyLanguage language)
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
            if (TreesUnchanged(net, model, language)) return;

            for (int i = NwlInterop.RequireInt(net, "NetworkItemCount") - 1; i >= 0; i--)
                NwlInterop.Call(net, "RemoveNetworkItem", i);

            var ctx = new BuildContext(net, declaration);
            foreach (var tree in model.Trees)
                NwlInterop.Call(net, "AppendTree", ctx.Node(tree));
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
        /// it cannot represent. Refusing is the same answer the reader gives on pull.</para></summary>
        private static bool TreesUnchanged(object net, Network model, BodyLanguage language)
        {
            var live = CodesysNetworkReader.ReadNetwork(net, model.Order);
            return Render(live with { Title = model.Title, Label = model.Label, Comment = model.Comment, Disabled = model.Disabled }, language)
                == Render(model, language);
        }

        private static string Render(Network network, BodyLanguage language) =>
            NetworkTextWriter.Write(new NetworkBody(language, new[] { network }));

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
            private readonly string? _declaration;

            public BuildContext(object net, string? declaration)
            { _net = net; _declaration = declaration; }

            public object Node(Node n)
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
                        // COIL STORAGE GOES BACK WHERE THIS VENDOR KEEPS IT — on the TARGET — having been read
                        // onto the value (see CodesysNetworkReader). It is written from the value and STRIPPED
                        // from the value, so the source operand does not also come out latched: `out := a SET;`
                        // is a set COIL, not a set input. Without this the write half of the same gap stayed
                        // open — a SET an engineer typed in the workspace was accepted and landed as a plain
                        // coil, changing what the program does.
                        // STORAGE ONLY — not the value's whole flag record.
                        //
                        // This was `a.Value?.Flags ?? Flags.None`, and every bit of it was then applied to each
                        // target below. `ApplyFlags` sets Negation, Rtrig and Ftrig as readily as Set, so the NOT
                        // in `out := NOT a;` landed on the COIL as well as on the input and the IDE ran
                        // `out := NOT NOT a` — the inverse of the committed source, on the vendor's canonical FBD
                        // fixture. `out := clk RISING;` gave a rising-edge coil the same way.
                        //
                        // Invisible from every direction Volt had: the reader lifts only storage back off a
                        // target (`CoilStorage.OntoValue`) and the text writer renders a target with no modifiers
                        // at all, so the next pull was byte-identical and the change gate then said "unchanged";
                        // and a negated BOOL coil COMPILES, so the build oracle could not see it either.
                        //
                        // DIALECT D26 already stated the rule — "the write back is BIT-PRECISE rather than a
                        // whole-flags assignment" — and TwinCAT obeys it (`TcNetworkWriter.WriteStorage` touches
                        // the Set bit alone). This vendor did not.
                        // STORAGE COMES OFF THE TARGET, because that is where the model carries it and where
                        // this vendor keeps it. It used to be lifted off the VALUE (`CoilStorage`, deleted) to
                        // suit the old `out := v SET;` spelling, applied as ONE record to every target — so a
                        // fan-out whose coils disagreed got the first coil's storage on all of them.
                        var asg = NwlInterop.New(_net, "BoxTreeAssign");
                        if (a.Value is { } v) NwlInterop.Set(asg, "RValue", Node(v));
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
                        // RETURN stays on the ITEM, and that asymmetry is the model's rather than a
                        // preference: a return has no target operand to carry anything, and a POU built with
                        // the bit there compiles clean.
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
                                Flags = Flags.None with { Negated = negation, Set = set, Jump = a.Flags.Jump },
                            };
                            NwlInterop.Call(outputs, "AppendOutputItem", Operand(coil));
                        }
                        return Flagged(asg, a.Flags);
                    }

                    case Box b:
                    {
                        // An Execute box carries raw ST on the box itself. The READER models it
                        // (ProvidesSTSnippet + the STSnippet's Implementation aspect); constructing one is not
                        // measured, and this wrote the box WITHOUT its code - a program that read back as
                        // `???();` with the engineer's ST gone. Refuse until the construction is measured: a
                        // dropped body is the one outcome this transport exists to prevent.
                        if (b.StCode is not null)
                            throw new NotSupportedException(
                                "CODESYS: writing an Execute box (ST inside FBD) is not implemented - Volt can " +
                                "READ one but not build one, and writing the box without its ST would silently " +
                                "delete the code. Edit the Execute box in the IDE and pull.");

                        // AN FB CALL'S TYPE IS NOT ITS INSTANCE NAME. Network text carries ONE name for a
                        // call, so `t1 : TON` renders as `t1(...)` and the reader rebuilds `Box(Type: "t1")`.
                        // Writing that into BoxType puts an unresolvable type in the slot the IDE resolves the
                        // call's signature from: the push reports accepted, the next pull renders identical
                        // text, and only `volt build` ever reveals it. The pre-NetworkBody writer had a
                        // declaration-driven instance->type resolver that threw when it could not resolve; it
                        // went with that rewrite and nothing replaced it. TwinCAT refuses this exact case
                        // (TcNetworkWriter: "a box changes from X to Y"), so refusing here is also what makes
                        // the two vendors agree again.
                        if (b.Kind == CallKind.FunctionBlock && b.Instance is null)
                            throw new NotSupportedException(
                                $"CODESYS: the call '{b.Type}' is a function-block instance, and network text " +
                                "carries only the instance name - Volt cannot tell which TYPE to write into the " +
                                "box, and writing the instance name there produces a POU that no longer " +
                                "compiles. Edit this network in the IDE.");

                        var box = NwlInterop.New(_net, "BoxTreeBox");
                        // The TYPE NAME only: CallType and EnEno are the vendor's to derive, and it does.
                        NwlInterop.Set(box, "BoxType", BoxTypeOf(b));

                        // Everything else the READER models on a box had no counterpart here and was dropped in
                        // silence: an FB call lost its instance, an embedded output vanished, an EN pin was
                        // forgotten. Each is set through the member the reader reads, so the two cannot drift -
                        // and NwlInterop fails loud (naming the observed assembly version) if a member is not
                        // there, which is the whole reason this vendor's typed model is safer than an archive.
                        if (b.Instance is { } inst) WriteInstance(box, inst);

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

                        // A BOX'S EMBEDDED OUTPUT IS REFUSED, because a rebuild cannot carry one.
                        //
                        // This was `if (b.Outputs.Count > 0) { ...append them... }` — a guard that can NEVER
                        // be true. `Box.Outputs` has no network-text syntax (`Outputs` appears nowhere in
                        // `NetworkTextWriter` or `NetworkTextReader`), every Box the text reader builds is
                        // constructed with an empty list, and every model reaching this writer is text-derived.
                        // So the branch never ran, while the comment above claimed the loss was closed — the
                        // same dead-code-that-reads-as-a-guarantee shape the `Type`/`IsLValue` writes were
                        // deleted for.
                        //
                        // What it was hiding: a box that writes a pin's value directly — a TON whose `ET` pin
                        // carries `elapsed` on the pin itself, the shape a vendor FBD export writes —
                        // pulls as `t1(IN := a, PT :=
                        // pt);` with `elapsed` nowhere in the file. Edit anything else in that network and the
                        // destroy-and-rebuild drops it from the live project: no diff (git never held it), no
                        // diagnostic, and no compile error, because nothing references the variable — it simply
                        // stops being written. TwinCAT does not lose it; its box arm neither compares nor writes
                        // outputs, so an in-place edit leaves them alone.
                        //
                        // Refusing is the honest answer until the format can spell one. The model can only ever
                        // carry outputs from a LIVE read, so this fires exactly when a caller hands the writer a
                        // vendor-derived box — which no production path does today, and which must not silently
                        // lose pins the day one does.
                        if (b.Outputs.Count > 0)
                            throw new NotSupportedException(
                                $"CODESYS: the box '{b.Type}' writes to an output pin directly, which network " +
                                "text has no form for — rebuilding it would drop the pin's variable from the " +
                                "project. Edit this POU in the IDE.");

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
                        if (d.Input is { } src) NwlInterop.Call(dm, "SetInputTree", 0, Node(src));
                        return Flagged(dm, d.Flags);
                    }

                    case Terminator t:
                    {
                        var term = NwlInterop.New(_net, "BoxTreeTerminator");
                        if (t.Input is { } ti) NwlInterop.Call(term, "SetInputTree", 0, Node(ti));
                        return Flagged(term, t.Flags);
                    }

                    case Parallel p:
                    {
                        var par = NwlInterop.New(_net, "BoxTreeParallel");
                        if (p.Input is { } pi) NwlInterop.Call(par, "SetInputTree", 0, Node(pi));
                        foreach (var branch in p.Branches) NwlInterop.Call(par, "Append", Node(branch));
                        return Flagged(par, p.Flags);
                    }

                    default:
                        throw new NotSupportedException(
                            $"CODESYS: no way to write the graphical node '{n.GetType().Name}' — refusing " +
                            "rather than writing a body that is not what the source says.");
                }
            }

            /// <summary>The TYPE to write into <c>BoxType</c> — resolved from the DECLARATION for a
            /// function-block call, because the body cannot carry it.
            ///
            /// <para>Network text names a call once: `t1(IN := a, PT := pt)`. `NetworkTextReader` therefore
            /// builds <c>Box(Type: "t1", Instance: "t1")</c> — both the INSTANCE name. The IDE needs the type
            /// (`TON`) in <c>BoxType</c>, because that is what it resolves the call's signature from. Writing
            /// `t1` there produced a box the IDE could not resolve: it came back with NO formal parameter names,
            /// so the next pull rendered `t1( := a,  := pt)` and that text no longer parses — the POU could be
            /// created and then never pushed again.</para>
            ///
            /// <para>The type is one line up, in the declaration the same push writes (`t1 : TON;`), which is why
            /// the declaration is written BEFORE the body on both call sites. This restores the
            /// declaration-driven resolver the pre-NetworkBody writer had and that nothing replaced — including
            /// its refusal: an instance that is not declared is a body Volt cannot write correctly, and a
            /// silently unresolvable box is exactly the failure this exists to prevent.</para>
            ///
            /// <para>An ARCHIVE-derived model already carries the real type (`Type: "TON"`, `Instance: "t1"`),
            /// so resolution runs only when the two are the same string — the text-derived shape.</para></summary>
            private string BoxTypeOf(Box b)
            {
                if (b.Kind != CallKind.FunctionBlock || b.Instance is not { } inst) return b.Type;
                if (!string.Equals(b.Type, inst.Text, StringComparison.OrdinalIgnoreCase)) return b.Type;

                return StDeclaration.TypeOfVariable(_declaration, inst.Text)
                    ?? throw new NotSupportedException(
                           $"CODESYS: the call '{inst.Text}' names a function-block instance that is not declared " +
                           "in this POU, so Volt cannot tell the IDE which TYPE the box calls. Declare it, or " +
                           "edit this network in the IDE.");
            }

            /// <summary>Name the function-block instance a box calls            /// <summary>Name the function-block instance a box calls — by MUTATING the operand the box already
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
