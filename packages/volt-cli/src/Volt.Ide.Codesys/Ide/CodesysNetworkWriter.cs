using System;
using System.Collections.Generic;
using System.Globalization;
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

            // PAIR THE LIVE NETWORKS WITH THE PUSHED ONES BY TEXT, NOT POSITION (ld-fbd-coverage 1b.4, NetworkPairing): a
            // network whose text did not change is not touched, wherever a network was inserted or removed before it, and
            // only the changed ones are rebuilt — so a network the push cannot build (S4, an N21 comparison) is refused
            // only when ITS text changed. Pairing by position shifted every network after an insertion into "changed".
            // Through the aspect's own API: AppendNetwork / InsertNetwork(int, INetwork) / RemoveNetwork(int)
            // (reflected off SP21's NWLObject.dll); nothing here needs the archive back door (SetSerializableValue),
            // which also works but writes AROUND the object model rather than through it.
            var live = NwlInterop.Items(NwlInterop.Require(impl, "NetworkList"), listMember: "");
            var shown = live.Select((n, i) => CodesysNetworkReader.ReadNetworkShown(n, i)).ToList();
            var plan = NetworkPairing.Plan(shown, body.Networks, body.Language, scope);
            // A removal that would erase what the text does not show — a moved network's symbol comment, a replaced
            // UNSUPPORTED line, one of two identically shown networks — is refused before anything changes (gate 1b-4).
            NetworkPairing.RefuseUnseenLoss(Volt.Contracts.Vendors.CodesysDisplay, shown, plan, body.Language, scope);

            // Every network to build is judged BEFORE the list changes: a refusal leaves the body as the IDE holds it
            // (the transaction rolls back too, but an offline caller has none).
            // A rebuild whose trees did not change writes only the header (WriteNetwork's change gate), so it builds nothing.
            foreach (var move in plan)
            {
                if (move.Step == NetworkStep.Insert) RefuseUnbuildable(body.Networks[move.Pushed!.Value]);
                else if (move.Step == NetworkStep.Rebuild &&
                         !TreesUnchanged(shown[move.Live!.Value], body.Networks[move.Pushed!.Value], body.Language, scope))
                    RefuseUnbuildable(body.Networks[move.Pushed.Value]);
            }

            // Removals from the end, so each index is still the live one.
            foreach (var move in plan.Where(m => m.Step == NetworkStep.Remove).OrderByDescending(m => m.Live!.Value, Comparer<int>.Default))
                NwlInterop.Call(impl, "RemoveNetwork", move.Live!.Value);

            // What is left is the kept and rebuilt networks in order; insertions go between them.
            var at = 0;
            foreach (var move in plan)
            {
                switch (move.Step)
                {
                    case NetworkStep.Keep:
                        at++;
                        break;
                    case NetworkStep.Rebuild:
                        WriteNetwork(impl, NetworkAt(impl, at), body.Networks[move.Pushed!.Value], body.Language, scope);
                        at++;
                        break;
                    case NetworkStep.Insert:
                        var fresh = NwlInterop.New(impl, "Network");
                        if (at == Count(impl)) NwlInterop.Call(impl, "AppendNetwork", fresh);
                        else NwlInterop.Call(impl, "InsertNetwork", at, fresh);
                        WriteNetwork(impl, NetworkAt(impl, at), body.Networks[move.Pushed!.Value], body.Language, scope);
                        at++;
                        break;
                }
            }
        }

        private static object NetworkAt(object impl, int index) =>
            NwlInterop.Items(NwlInterop.Require(impl, "NetworkList"), listMember: "")[index];

        /// <summary>A network the push would BUILD from its text, refused by name where it cannot be built: a pushed
        /// <c>UNSUPPORTED</c> line (nothing to build from, <see cref="NetworkPairing.RefuseUnpairedUnsupported"/>) and a
        /// box read through a named main output (S4: <c>MainOutputIndex</c> is read-only on a box Volt builds, N21).</summary>
        private static void RefuseUnbuildable(Network model)
        {
            NetworkPairing.RefuseUnpairedUnsupported(Volt.Contracts.Vendors.CodesysDisplay, model);
            foreach (var (box, output) in NetworkPairing.NamedMainOutputs(model))
                throw new NotSupportedException(
                    $"CODESYS: network {model.Order + 1} changed, and its '{box.Type}' box is read through its output " +
                    $"'{output}', which is not the box's first output: a box Volt builds cannot be read through any other " +
                    "(its main output index is read-only, DIALECT N21), so the consumer would read another value than the " +
                    "text says. Refusing to rebuild this network; a network whose text is unchanged is kept as the IDE " +
                    "holds it. The IDE can edit this network.");
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
            var live = CodesysNetworkReader.ReadNetworkShown(net, model.Order);
            if (TreesUnchanged(live, model, language, scope)) return;

            // Before this network's items are removed. Not for atomicity — the whole write runs inside
            // `CodesysObjectModel.ModifyObject`, which rolls the checkout back on any throw, including a refusal in a
            // later network after an earlier one was already rebuilt. It is here so the refusal is judged on exactly
            // the networks the change gate above lets through (an unchanged pulled network holding the shape is never
            // refused), and so a caller with no transaction — the offline tests — sees the live network untouched.
            RefuseUnbuildable(model);
            foreach (var tree in model.Trees) RefuseUnbuildableEno(tree, consumed: false);
            // What the rebuild below would ERASE without a trace: a symbol comment, which the text does not carry.
            NetworkText.RefuseSymbolCommentLoss(Volt.Contracts.Vendors.CodesysDisplay, live);
            // What it resets without a refusal: the stored values of the members the text does not carry yet that the
            // rebuilt items do not hold, named in one warning (ld-fbd-coverage 2.2, the interim loss window) — read before
            // the items go and again once they are built, since the fresh value is the vendor's own (a negated contact's
            // Fixed is set with the negation, N29). The network object stays, so its own Id does too.
            var held = HeldByItems(net);

            for (int i = NwlInterop.RequireInt(net, "NetworkItemCount") - 1; i >= 0; i--)
                NwlInterop.Call(net, "RemoveNetworkItem", i);

            var ctx = new BuildContext(net, scope);
            foreach (var tree in model.Trees)
                NwlInterop.Call(net, "AppendTree", ctx.Node(tree, consumed: false));

            if (RebuildLoss.Warning(Volt.Contracts.Vendors.CodesysDisplay, model.Order, held, HeldByItems(net)) is { } loss)
                Volt.Engine.Ide.BridgeLog.Warn(loss);
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
        /// <para><b>A live network the text cannot spell is never rebuilt.</b> The live side is the network AS SHOWN
        /// (<see cref="CodesysNetworkReader.ReadNetworkShown"/>): one the reader refuses (a vendor split point is the
        /// measured case) or the writer has no spelling for renders as its <c>UNSUPPORTED</c> line, so it compares equal
        /// only to that line pushed back — a header edit. Its trees are never paired with other trees
        /// (<see cref="NetworkPairing"/>'s cost), and its removal beside an insertion is refused
        /// (<see cref="NetworkPairing.RefuseUnseenLoss"/>, gate 1b-4): a rebuild would delete the very content the text
        /// could not carry.</para>
        ///
        /// <para><b>Rendered against the body's scope</b>, the one it was read against: the text spells a wire name
        /// and an FB instance through the declarations, so both sides must be written with the same ones.</para></summary>
        private static bool TreesUnchanged(Network live, Network model, BodyLanguage language, NetworkScope scope)
        {
            return NetworkPairing.Render(live with { Title = model.Title, Label = model.Label, Comment = model.Comment, Disabled = model.Disabled }, language, scope)
                == NetworkPairing.RenderPushed(model, language, scope);
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
                // An enabled COMPARISON read as a value is built as the PLCopen importer builds it — EN, no ENO, its result
                // slot null (2R.5 #26: that box stores, builds and runs; the refusal that stood here said no box Volt builds
                // compiles, which held for the box built with ENO). Read through its ENO it is any enabled box (#22).
                if (b.Enable is not null && !readsEno && !NetworkText.IsComparison(b.Type))

                    throw Unbuildable(b, "the model reads its main output, and CODESYS reads a box Volt builds with EN " +
                                         "through its ENO (DIALECT N21) — the push would feed the consumer the enable, " +
                                         "not the data. Write the box as an open line and read it as ENO (B4)");
                // An operator read through ENO with no EN never reaches here from the text (the reader refuses it, P3, N21).
            }
            // Everything below the top level is consumed by its parent.
            foreach (var child in n.Children()) RefuseUnbuildableEno(child, consumed: true);
        }

        private static NotSupportedException Unbuildable(Box b, string why) =>
            new($"CODESYS: the '{b.Type}' box is {why}. Refusing rather than build a network whose consumer reads " +
                "another output than the text says, or that does not compile. The IDE can edit this network.");

        /// <summary>The stored values of the rebuild-loss candidates (<see cref="RebuildLoss"/>) every item of
        /// <paramref name="net"/> holds, in its notation: each flag set's <c>Fixed</c>, each operand's <c>Boolean</c> and its
        /// ARCHIVED <c>Address</c> — the API property answers the
        /// sentinel on every operand (DIALECT N27). The walk follows the members the reader reads.</summary>
        private static List<RebuildLoss.Held> HeldByItems(object net)
        {
            var held = new List<RebuildLoss.Held>();
            void Item(object? o)
            {
                if (o is null) return;
                if (NwlInterop.Get(o, "Flags") is { } flags)
                    held.Add(new("Flags.Fixed", NwlInterop.TypeName(o), Bool(NwlInterop.Get(flags, "Fixed"))));
                switch (NwlInterop.TypeName(o))
                {
                    case "BoxTreeOperand": Operand(NwlInterop.Get(o, "Operand")); break;
                    case "BoxTreeAssign":
                        foreach (var t in NwlInterop.Items(NwlInterop.Get(o, "Outputs"))) Operand(t);
                        Item(NwlInterop.Get(o, "RValue"));
                        break;
                    case "BoxTreeBox":
                        Operand(NwlInterop.Get(o, "Instance"), instance: true);
                        // B7 (2R.3): the members the text does not carry, each as the box stores it — its whole output
                        // and input lists (a call's unwired pins, a function's '   ', a bit operator's ['']), its type
                        // spelling, EN/ENO, CallType and pin flag list (RebuildLoss.Candidates).
                        foreach (var (member, list) in new[] { ("OutputParam", "OutputParams"), ("InputParam", "InputParams") })
                        {
                            var param = NwlInterop.Get(o, list);
                            held.Add(new(member + ".Names", "BoxTreeBox", RebuildLoss.List(CodesysNetworkReader.Strings(param, "Names"))));
                            held.Add(new(member + ".Types", "BoxTreeBox", RebuildLoss.List(CodesysNetworkReader.Strings(param, "Types"))));
                        }
                        held.Add(new("BoxType", "BoxTreeBox", NwlInterop.Text(o, "BoxType")));
                        held.Add(new("EN", "BoxTreeBox", Bool(NwlInterop.Get(o, "En"))));
                        held.Add(new("ENO", "BoxTreeBox", Bool(NwlInterop.Get(o, "Eno"))));
                        held.Add(new("CallType", "BoxTreeBox", NwlInterop.Get(o, "CallType")?.ToString()));
                        held.Add(new("InputFlags", "BoxTreeBox", NwlInterop.Get(o, "InputFlags") is System.Collections.IEnumerable pinFlags
                            ? pinFlags.Cast<object?>().Count().ToString(CultureInfo.InvariantCulture) + " sets"
                            : null));
                        // Output slots beyond the names (an enabled PROGRAM call's second null slot), counted raw: the
                        // slots are nulls, which NwlInterop.Items drops.
                        if (NwlInterop.Get(NwlInterop.Get(o, "OutputParams"), "Names") is System.Collections.IEnumerable slotNames &&
                            NwlInterop.Get(NwlInterop.Get(o, "Outputs"), "List") is System.Collections.IEnumerable rawSlots &&
                            RebuildLoss.ExtraSlots("BoxTreeBox", rawSlots.Cast<object?>().Count(), slotNames.Cast<object?>().Count()) is { } extra)
                            held.Add(extra);
                        foreach (var i in NwlInterop.Items(NwlInterop.Get(o, "InputItemList"), listMember: "")) Item(i);
                        foreach (var t in NwlInterop.Items(NwlInterop.Get(o, "Outputs"))) Operand(t);
                        break;
                    case "BoxTreeParallel":
                        Item(NwlInterop.Get(o, "Input"));
                        foreach (var b in NwlInterop.Items(NwlInterop.Get(o, "Trees"), listMember: "")) Item(b);
                        break;
                    default:   // a Demux or Terminator: its feed
                        Item(NwlInterop.Get(o, "Input"));
                        break;
                }
            }
            void Operand(object? op, bool instance = false)
            {
                if (op is null) return;
                held.Add(new(instance ? "Instance.Type" : "Operand.Type", instance ? "BoxTreeBox" : "Operand", NwlInterop.Text(op, "Type")));
                held.Add(new("Operand.Boolean", "Operand", Bool(NwlInterop.Get(op, "Boolean"))));
                held.Add(new("Operand.Address", "Operand", NwlInterop.Call(op, "GetSerializableValue", "Address") as string));
                if (NwlInterop.Get(op, "Flags") is { } flags) held.Add(new("Flags.Fixed", "Operand", Bool(NwlInterop.Get(flags, "Fixed"))));
            }
            for (int i = 0; i < NwlInterop.RequireInt(net, "NetworkItemCount"); i++)
                Item(NwlInterop.TryCall(net, "GetTree", i));
            return held;
        }

        private static string? Bool(object? v) => v is bool b ? (b ? "true" : "false") : null;

        private static int Count(object impl) =>
            NwlInterop.Items(NwlInterop.Require(impl, "NetworkList"), listMember: "").Count;

        /// <summary>Write a string member only when it really differs — comparing with TRAILING WHITESPACE
        /// ignored, because the IDE stores a title or comment with the newline the engineer typed after it and
        /// the model holds it trimmed (see the reader's `Clean`). Without that, every push rewrote a title
        /// nobody had touched.</summary>
        private static void SetIfChanged(object o, string member, string value)
        {
            var current = NwlInterop.Text(o, member) ?? "";
            if (!string.Equals(current, value, StringComparison.Ordinal)) NwlInterop.Set(o, member, value);
        }

        /// <summary>Per-network build state.</summary>
        private sealed class BuildContext
        {
            private readonly object _net;
            private readonly NetworkScope _scope;

            public BuildContext(object net, NetworkScope scope) { _net = net; _scope = scope; }

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
                            // PER TARGET (2R.5): a rung drives a coil beside a jump (#9), two jumps (#11), an edge coil
                            // (#14) — each target's own bits, the item's Jump/Return only where it has one target (the
                            // bit's cache on the item, DIALECT C13). Applied to every target, a coil beside a jump became
                            // a second jump, and an edge coil was written plain.
                            var f = t.Flags ?? Flags.None;
                            var (negation, set) = f.VendorCoilBits();
                            var lone = a.Targets.Count == 1;
                            var coil = t with
                            {
                                Flags = Flags.None with
                                {
                                    Negated = negation, Set = set, Rising = f.Rising, Falling = f.Falling,
                                    Jump = f.Jump || (lone && a.Flags.Jump), Return = f.Return || (lone && a.Flags.Return),
                                },
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
                        NwlInterop.Set(box, "BoxType", b.Type);
                        // THE CALL TYPE OF A FUNCTION OR METHOD CALL, from the callee's declaration (ld-fbd-coverage 2R.4,
                        // B7 D) — what the editor gives a box it draws; its input names the push's gate derived already
                        // (NetworkDerivation.Derive). The vendor resolves an operator's CallType from its type name on
                        // reload, but not a FUNCTION's or a METHOD's: measured live (SP21, simulation, design "2R.4"),
                        // Volt's box without it answers "The assignment source is incorrect." (the input names alone too),
                        // the CallType without the names "Function 'AwF' requires exactly '1' inputs", both run as drawn.
                        // An FB call, a PROGRAM call and a conversion run the same with the fresh None, so the scope names
                        // no callee for them and the vendor keeps its own.
                        var callee = b.Instance is null && b.StCode is null ? _scope.Callee(b.Type) : null;
                        if (callee is not null) NwlInterop.SetEnum(box, "CallType", callee.CallType);

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
                        var eno = NetworkText.HasEnoOutput(b, consumed);
                        if (b.Enable is { } en)
                        {
                            NwlInterop.Call(box, "AppendInputItem", Node(en));
                            NwlInterop.Set(box, "En", true);
                            // Shown as a pair where the box has an ENO — but an enabled comparison read as a VALUE has
                            // none (2R.5 #26): the editor draws it EN true, ENO false (40 of 40 lenze-mid boxes), the
                            // PLCopen importer's builds and runs (awkward-sweep, CODESYS SP21); with the pair shown it is
                            // read through its ENO (N21).
                            NwlInterop.Set(box, "Eno", eno);
                        }

                        foreach (var p in b.Inputs)
                            NwlInterop.Call(box, "AppendInputItem", Node(p.Value));
                        if (b.Inputs.Any(p => !p.Flags.IsNone) || !b.EnableFlags.IsNone) WritePinFlags(box, b);

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
                        // THE NAMES AND TYPES ARE THE BOX'S MEMBERS (ld-fbd-coverage 2.3): the stored ones the text spells by
                        // pragma — S1's `['']` on a bit operator, a call's whole output list — else what the text's own
                        // pins give (NetworkMembers.DerivedOutputNames / DerivedOutputTypes). The output items are laid
                        // out by them: each pin in the slot its name holds.
                        var (names, types) = NetworkMembers.Buildable(b, new BoxSite(consumed));
                        // A FUNCTION's whole output list, as the editor draws it (2R.4): its result pin '   ' (or the ENO
                        // echo) and every VAR_OUTPUT, wired or not — which the '   ' pin needs the derived CallType for.
                        if (callee is not null && NetworkDerivation.OutputNames(b, callee, eno) is { } drawn)
                        {
                            names = drawn;
                            types = drawn.Select(n => n == Box.EnoPin ? "BOOL" : "").ToList();
                        }
                        var slots = OutputSlots(b, eno, names);
                        if (slots.Count > 0)
                        {
                            var outs = NwlInterop.Require(box, "Outputs");
                            // AN EMPTY OPERAND, not a null, for the echo and for a slot passed over. The vendor
                            // STORES the echo slot as null but will not ACCEPT one: <c>AppendOutputItem(null)</c>
                            // answers "Object reference not set to an instance of an object". An empty operand is
                            // the shape its own PLCopen importer hangs off a box (see <c>DropImporterBoxOutputs</c>
                            // on the TwinCAT side) and the shape of every unwired pin on a resolved FB box, and the
                            // reader skips an empty output slot, so it round-trips as the nothing it is.
                            foreach (var slot in slots)
                                NwlInterop.Call(outs, "AppendOutputItem", Operand(slot.Value ?? new Operand("")));
                            // The vendor's null where it stores one: in place of the empty operand appended there.
                            for (var i = 0; i < slots.Count; i++)
                                if (slots[i].IsNull)
                                {
                                    NwlInterop.Call(outs, "RemoveOutputItem", i);
                                    NwlInterop.Call(outs, "InsertOutputItem", i, null);
                                }
                        }

                        // THE OUTPUT NAMES AND STORED TYPES, index-aligned with the slots as the reader reads them back
                        // (`OutputParams`). The vendor derives neither (DIALECT N21: `OutputParams` holds exactly what the
                        // writer appended), so a type the model carries and this does not write is a type the next pull
                        // does not have — a data wire read back "of unknown type". A slot only a TYPE names (the one a
                        // wire is connected to) gets a param and NO output item: the vendor stores the connected slot as
                        // null, and an empty operand there is an assignment to nothing — measured live, the build answers
                        // "The assignment target is not specified".
                        if (names.Count > 0 || types.Count > 0)
                        {
                            var outPins = NwlInterop.Require(box, "OutputParams");
                            for (var i = 0; i < Math.Max(names.Count, types.Count); i++)
                                NwlInterop.Call(outPins, "AppendParam", i < names.Count ? names[i] : "", i < types.Count ? types[i] : "");
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
                        // B6: the split's type is its feeder's — derived, never written; the text states none.
                        if (d.Input is { } src) NwlInterop.Call(dm, "SetInputTree", 0, Node(src));
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

            /// <summary>
            /// THE BOX'S OUTPUT ITEMS AS THE VENDOR LISTS THEM — one per output NAME (ld-fbd-coverage 2.3: the names are the
            /// box's member, and the IDE draws a slot for each): the MAIN output's slot null, as the vendor stores it whether
            /// or not a consumer reads it (the ENO echo where the box has one, else slot 0 — census 1b.1: `n`, `nR`, `ne`,
            /// `neee` on 1,300 boxes), each pin in the slot its name holds — a positional <c>=&gt; v</c> in the slot it fills
            /// (task 3.10), so <c>f(a, =&gt;, =&gt; x)</c> puts <c>x</c> on slot 2 — and every other slot an empty operand,
            /// the shape of an unwired pin on a drawn box. Null is <see cref="OutputSlot.Null"/>: the vendor takes it through
            /// <c>InsertOutputItem</c> (measured live 2026-10-15, a TON consumed by Q with ET wired: pushed, pulled
            /// byte-identical, built clean), where <c>AppendOutputItem(null)</c> throws.
            /// </summary>
            private static List<OutputSlot> OutputSlots(Box b, bool eno, IReadOnlyList<string> names)
            {
                var slots = new List<OutputSlot?>();
                void At(int at, OutputSlot slot, string what)
                {
                    while (slots.Count <= at) slots.Add(null);
                    if (slots[at] is not null)
                        throw new NotSupportedException(
                            $"CODESYS: the '{b.Type}' box wires output slot {at} to {what}, a slot " +
                            (eno && at == 0 ? "its ENO echo holds" : "another pin already holds") +
                            " — refusing rather than write the pin onto another output.");
                    slots[at] = slot;
                }
                if (eno) At(0, OutputSlot.Null, "ENO");
                foreach (var o in b.Outputs)
                {
                    int at;
                    // The named ENO pin (P5, 2R.5 #23): the variable the vendor stores on the ENO slot, in place of its null.
                    if (string.Equals(o.Formal, Box.EnoPin, StringComparison.OrdinalIgnoreCase))
                    {
                        if (!eno)
                            throw new InvalidOperationException(
                                $"network model invariant: the '{b.Type}' box wires its ENO to '{o.Value.Text}' and is built with no ENO output; the reader refuses that text (P5).");
                        slots[0] = OutputSlot.Of(o.Value);
                        continue;
                    }
                    if (o.Formal is { } formal)
                    {
                        var named = Enumerable.Range(0, names.Count)
                            .Where(i => string.Equals(names[i], formal, StringComparison.OrdinalIgnoreCase) && (i >= slots.Count || slots[i] is null))
                            .ToList();
                        if (named.Count == 0)
                            throw new NotSupportedException(
                                $"CODESYS: the '{b.Type}' box's output names ({string.Join(", ", names.Select(n => "'" + n + "'"))}) " +
                                $"hold no '{formal}' for the pin wired to '{o.Value.Text}'.");
                        at = named[0];
                    }
                    else
                        at = o.Slot ?? throw new InvalidOperationException(
                            $"network model invariant: the '{b.Type}' box's positional output to '{o.Value.Text}' has no slot; the reader places every one.");
                    At(at, OutputSlot.Of(o.Value), "'" + o.Value.Text + "'");
                }
                while (slots.Count < names.Count) slots.Add(null);
                // The main output: slot 0 (the ENO echo, set above, where the box has one) — null where no pin holds it.
                if (slots.Count > 0 && slots[0] is null) slots[0] = OutputSlot.Null;
                return slots.Select(s => s ?? OutputSlot.Empty).ToList();
            }

            /// <summary>One output item: a pin's operand, an empty operand (an unwired slot), or the vendor's null.</summary>
            private sealed class OutputSlot
            {
                private OutputSlot(Operand? value, bool isNull) { Value = value; IsNull = isNull; }
                public Operand? Value { get; }
                public bool IsNull { get; }
                public static readonly OutputSlot Null = new(null, true);
                public static readonly OutputSlot Empty = new(new Operand(""), false);
                public static OutputSlot Of(Operand value) => new(value, false);
            }

            /// <summary>
            /// THE FLAGS ON A BOX'S INPUT PINS (S6, ld-fbd-coverage 2.3) — the vendor's <c>InputFlags</c>, one flag set per input
            /// item (the EN slot included), index-aligned, which the reader reads into <see cref="Input.Flags"/>. Written
            /// through the box's own <c>SetInputFlag(int, IFlags2)</c> (SP21 <c>NWLObject.plugin</c> 4.6.0.0: <c>InputFlags</c>
            /// is a getter, an array the box hands out) with a flag set made by its public constructor, and READ BACK: a pin
            /// whose negation the box does not keep is refused by name rather than built plain — inverted logic in the PLC,
            /// with the text saying otherwise.
            /// </summary>
            private static void WritePinFlags(object box, Box b)
            {
                var first = b.Enable is null ? 0 : 1;
                // The EN slot's own set (2R.5 #16), then each pin's (S6; an edge, 2R.5 #15).
                var pins = new List<(int Slot, Flags Flags, string Name)>();
                if (b.Enable is not null && !b.EnableFlags.IsNone) pins.Add((0, b.EnableFlags, Box.EnablePin));
                for (var i = 0; i < b.Inputs.Count; i++)
                    if (!b.Inputs[i].Flags.IsNone) pins.Add((first + i, b.Inputs[i].Flags, b.Inputs[i].Formal ?? $"input {i}"));
                foreach (var (slot, flags, _) in pins)
                {
                    var set = NwlInterop.New(box, "Flags");
                    SetBits(set, flags);
                    NwlInterop.Call(box, "SetInputFlag", slot, set);
                }
                var kept = (NwlInterop.Get(box, "InputFlags") as System.Collections.IEnumerable)?.Cast<object?>().ToList()
                           ?? throw new NotSupportedException(
                               $"CODESYS: the '{b.Type}' box answers no InputFlags after its pin flags were set.");
                if (kept.Count != first + b.Inputs.Count)
                    throw new NotSupportedException(
                        $"CODESYS: the '{b.Type}' box answers {kept.Count} pin flag set(s) for {first + b.Inputs.Count} input(s), " +
                        "so which pin a flag belongs to is unknown. Refusing rather than flag another pin.");
                // READ BACK, every bit: a pin whose modifier the box does not keep is refused by name rather than built
                // plain — inverted logic, or an edge gone, with the text saying otherwise.
                foreach (var (slot, flags, name) in pins)
                    if (kept[slot] is not { } k ||
                        (flags.Negated && !NwlInterop.Flag(k, "Negation")) ||
                        (flags.Rising && !NwlInterop.Flag(k, "Rtrig")) ||
                        (flags.Falling && !NwlInterop.Flag(k, "Ftrig")))
                        throw new NotSupportedException(
                            $"CODESYS: the '{b.Type}' box did not keep the modifier written on its pin {name} — " +
                            "refusing rather than build the pin plain, another program than the text.");
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
                // from anything Volt holds (census 1b.1: 4 of the 10 in the corpora are ANOTHER variable's
                // comment). So a network holding one never reaches this builder: `WriteNetwork` refuses it
                // first (`NetworkText.RefuseSymbolCommentLoss`) rather than erase it unseen.
                // ...except where the TEXT states it: a leaf feeding a wire stores the type the wire is declared with (S3a,
                // ld-fbd-coverage 2.3) — the IDE-drawn leaf holds its declared type and a pushed one held none, so the pull
                // read the wire back "of unknown type" (vendor-facts nwl-leaf-wire-type, DIALECT N32).
                if (!string.IsNullOrEmpty(o.Type)) NwlInterop.Set(op, "Type", o.Type);
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

                SetBits(NwlInterop.Get(item, "Flags")
                    ?? throw new InvalidOperationException(
                        $"CODESYS: '{item.GetType().Name}' carries no Flags, so its modifiers cannot be written"), f);
            }

            /// <summary>The bits of <paramref name="f"/> set, by name, on a flag set itself — an item's <c>Flags</c>, or one
            /// of a box's <c>InputFlags</c> (S6).</summary>
            private static void SetBits(object target, Flags f)
            {
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
