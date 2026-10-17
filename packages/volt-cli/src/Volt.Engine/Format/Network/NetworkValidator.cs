using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;

namespace Volt.Engine.Format.Network;

/// <summary>
/// THE SHARED VALIDATOR (openspec <c>ld-fbd-coverage</c> 2R.6b, <c>v2-spec.md</c> section 7): the checks over the MODEL that
/// no spelling decides — a vendor fact a build refuses (X3, X9, X10, X12, X13), a split's one definition (X17), the jump
/// bit's echo (C13) and every composition no store, build and run has measured (the spec's MEASURE list). One walk, called
/// by the text writer (a pulled network it refuses is shown as its <c>UNSUPPORTED</c> line), the text reader (a finding is a
/// diagnostic at the node's span) and the LSP's port of it; the vendor readers reach it through the writer. A check here
/// is never repeated in a walk that spells or parses.
/// </summary>
public static class NetworkValidator
{
    /// <summary>One finding: the shape it names (a phrase the <c>UNSUPPORTED</c> line can carry), what was found, the
    /// <c>NETWORK_*</c> code a push refuses it under, and the node it was found on (null: the network itself).</summary>
    public sealed record Finding(string Reason, string Detail, string Code, Node? At);

    /// <summary>The first finding on <paramref name="network"/>'s trees, or null when it has none.</summary>
    public static Finding? Check(Network network)
    {
        if (network is null) throw new ArgumentNullException(nameof(network));
        try
        {
            new Walker(network).Run();
            return null;
        }
        catch (FindingException f) { return f.Finding; }
    }

    /// <summary><see cref="Check"/> as the writer's refusal.</summary>
    internal static void Refuse(Network network)
    {
        if (Check(network) is { } f) throw new NetworkUnrepresentableException(f.Reason, f.Detail) { At = f.At, Code = f.Code };
    }

    private sealed class FindingException : Exception
    {
        public FindingException(Finding f) : base(f.Detail) => Finding = f;
        public Finding Finding { get; }
    }

    private sealed class Walker
    {
        private readonly Network _net;
        private readonly Dictionary<int, int> _definitions = new();
        private readonly HashSet<int> _defining = new();

        public Walker(Network net) => _net = net;

        public void Run()
        {
            if (_net.Unsupported is not null && _net.Trees.Count > 0)
                throw new ArgumentException(
                    $"network {_net.Order} is UNSUPPORTED ('{_net.Unsupported}') and holds {_net.Trees.Count} tree(s): such a " +
                    "network holds none, because what it holds is what the text cannot say.");
            foreach (var t in _net.Trees) Count(t);
            foreach (var t in _net.Trees) Top(t);
        }

        private void Count(Node n)
        {
            if (n is Demux { Input: not null } d)
            {
                if (d.VarId < 0) Fail("a split with a negative VarId", $"a split carries the VarId {d.VarId}, and its name is split<digits>.", d);
                _definitions[d.VarId] = _definitions.TryGetValue(d.VarId, out var k) ? k + 1 : 1;
                if (_definitions[d.VarId] > 1)
                    Fail("a split defined twice", $"split{d.VarId} is defined twice in network {_net.Order + 1}: a split is defined once (X17).",
                        d, ConflictCodes.NetworkDuplicateName);
            }
            foreach (var c in n.Children()) Count(c);
        }

        private void Top(Node n)
        {
            switch (n)
            {
                case Terminator t:
                    if (!t.Flags.IsNone) Fail("a flag on an empty item", $"an empty item carries {Describe(t.Flags)}.", t);
                    return;
                default:
                    Value(n, consumed: false);
                    return;
            }
        }

        private void Value(Node n, bool consumed)
        {
            switch (n)
            {
                case Leaf l:
                    if (l.Operand.Flags is { IsNone: false } of && of != l.Flags)
                        Fail("an operand whose flags disagree with its item",
                            $"the operand '{l.Operand.Text}' carries {Describe(of)} and its item {Describe(l.Flags)}.", l);
                    ValueFlags(l.Flags, $"the operand '{l.Operand.Text}'", l);
                    return;

                case Terminator t:
                    if (!(t.Flags with { Negated = false }).IsNone)
                        Fail("a flag on an empty slot", $"an unconnected slot carries {Describe(t.Flags)}.", t);
                    if (t.Flags.Negated)
                        Fail("a negated empty slot outside a lone coil value",
                            "a negated empty slot is measured as the value of one plain coil only, `x := NOT;` (2R.5 #6a).", t);
                    return;

                case Assign a:
                    AssignOf(a);
                    return;

                case Demux d:
                    if (d.Input is null)
                    {
                        if (!_definitions.ContainsKey(d.VarId))
                            Fail("a split referenced and never defined",
                                $"split{d.VarId} is read and network {_net.Order + 1} defines it nowhere.", d, ConflictCodes.NetworkBadExpression);
                        if (_defining.Contains(d.VarId))
                            Fail("a split read inside its own definition",
                                $"split{d.VarId} is read inside the value that defines it: a split that feeds itself is not measured.", d);
                        return;
                    }
                    _defining.Add(d.VarId);
                    try { Value(d.Input, consumed: true); }
                    finally { _defining.Remove(d.VarId); }
                    return;

                case Parallel p:
                    if (p.Branches.Count < 2)
                        Fail(p.Branches.Count == 0 ? "a Parallel with no branch" : "a Parallel with one branch",
                            $"a parallel holds {p.Branches.Count} branch(es), and the build refuses fewer than two (C0023, X13).", p);
                    if (p.Mode is not (ParallelMode.BoxShortCircuit or ParallelMode.Sequential))
                        Fail("an unmeasured Parallel mode", $"a parallel has the mode '{p.Mode}'; the measured modes are BoxShortCircuit and Sequential.", p);
                    if (p.Input is Terminator)
                        Fail("a Parallel fed by the empty terminator",
                            "a parallel fed by an unconnected slot (`NOT BRANCH (…)`) is not measured; an unfed parallel has no feed.", p);
                    if (p.Input is not null) Value(p.Input, consumed: true);
                    foreach (var b in p.Branches) Value(b, consumed: true);
                    return;

                case Box b:
                    BoxOf(b, consumed);
                    return;

                default:
                    Fail("an unknown network item", $"the node '{n.GetType().Name}' is no node network text knows.", n);
                    return;
            }
        }

        private void AssignOf(Assign a)
        {
            var item = a.Flags with { Jump = false, Return = false };
            if (!item.IsNone) Fail(UnheldFlags.AssignItemMarker, $"an assignment item carries {Describe(item)} on the item itself.", a);
            if (a.Targets.Count == 0 && !a.Flags.Return)
                Fail("an assign with no target", "an assignment drives no target.", a);
            if (a.Targets.Count > 1 &&
                ((a.Flags.Jump && !a.Targets.Any(t => t.Flags?.Jump == true)) || (a.Flags.Return && !a.Targets.Any(t => t.Flags?.Return == true))))
                Fail("a jump bit on an item no target carries",
                    $"an assignment carries the {(a.Flags.Jump ? "Jump" : "Return")} bit on the item and on none of its {a.Targets.Count} targets (C13).", a);

            var lone = a.Targets.Count <= 1;
            foreach (var t in a.Targets)
            {
                var f = t.Flags ?? Flags.None;
                if (lone) f = f with { Jump = f.Jump || a.Flags.Jump, Return = f.Return || a.Flags.Return };
                Coil(f, t.Text, a);
                if (!lone && (f.Negated || f.Rising || f.Falling))
                    Fail("a modified coil beside another coil",
                        $"the coil '{t.Text}' carries {Describe(f)} beside another coil: not measured — a negated or edge coil is measured alone on its item.", a);
            }

            if (a.Value is Terminator { Flags: { Negated: true } nf } && (nf with { Negated = false }).IsNone)
            {
                var plain = a.Targets.Count == 1 && (a.Targets[0].Flags ?? Flags.None).IsNone && !a.Flags.Jump && !a.Flags.Return;
                if (!plain)
                    Fail("a negated empty slot outside a lone coil value",
                        "`NOT;` beside another coil, or on a modified coil, is not measured — `x := NOT;` is (2R.5 #6a).", a.Value);
                return;
            }
            Value(a.Value, consumed: true);
        }

        private void Coil(Flags f, string text, Node at)
        {
            if (f.Jump && f.Return)
                Fail("an item that both jumps and returns", $"the coil '{text}' carries both the Jump and the Return bit.", at);
            if ((f.Jump || f.Return) && (f.Negated || f.Rising || f.Falling || f.Reset))
                Fail("a modified jump or return",
                    $"the jump or return coil carries {Describe(f)}: not measured — `JMP l :=`, `JMP l S=` and `RETURN :=` are.", at);
            if (f.Rising && f.Falling)
                Fail("rising and falling on one node", $"the coil '{text}' carries both a rising and a falling edge.", at);
            if ((f.Rising || f.Falling) && (f.Set || f.Reset))
                Fail("an edge beside a set or reset coil", $"the coil '{text}' carries {Describe(f)}: an edge beside S= or R= is not measured.", at);
            if (f.Negated && (f.Set || f.Reset))
                Fail("a negated set or reset coil",
                    $"the coil '{text}' carries a negation beside its storage, which the vendor's two coil bits cannot hold apart.", at);
            if (f.Set && f.Reset) Fail("a coil both set and reset", $"the coil '{text}' carries both the Set and the Reset bit.", at);
        }

        private void BoxOf(Box b, bool consumed)
        {
            var isFb = b.Instance is not null;
            var isExecute = b.StCode is not null;
            var what = isExecute ? "the EXECUTE box" : $"the '{b.Type}' box";

            if (isExecute && !b.Flags.IsNone)
                Fail("a flag on an Execute box", $"{what} carries {Describe(b.Flags)}: a modifier on an Execute box is not measured.", b);
            ValueFlags(b.Flags, what, b);

            for (var i = 0; i < b.Inputs.Count; i++)
                if (b.Inputs[i].Flags is { IsNone: false } pf && !PinFlagsSpelled(pf))
                    Fail(BoxRefusals.PinFlagMarker, $"{what} has {Describe(pf)} on its pin {b.Inputs[i].Formal ?? "input " + (i + 1)}.", b);
            if (b.Enable is null && !b.EnableFlags.IsNone)
                Fail(BoxRefusals.PinFlagMarker, $"{what} has {Describe(b.EnableFlags)} on an EN pin it does not have.", b);
            if (!PinFlagsSpelled(b.EnableFlags))
                Fail(BoxRefusals.PinFlagMarker, $"{what} has {Describe(b.EnableFlags)} on its EN pin.", b);
            if (b.EnableFlags.Rising || b.EnableFlags.Falling)
                Fail("an edge on the EN pin", $"{what} has an edge on its EN pin: not measured — `NOT EN c` is.", b);

            if (!isFb && !isExecute)
            {
                if (NetworkSpelling.TwoInputOperators.Contains(b.Type) && b.Inputs.Count > 2)
                    Fail("a two input operator box with more inputs",
                        $"{what} holds {b.Inputs.Count} inputs, and {b.Type.ToUpperInvariant()} takes two (the build refuses it: \"needs exactly '2' operands\", X13).", b);
                if (NetworkSpelling.OperatorWords.Contains(b.Type) && b.Inputs.Count < 2)
                    Fail("an operator box with fewer than two inputs",
                        $"{what} holds {b.Inputs.Count} input(s), and {b.Type.ToUpperInvariant()} takes at least two (the build refuses it: \"needs at least '2' operands\", X13).", b);
                if (string.Equals(b.Type, NetworkSpelling.Move, StringComparison.OrdinalIgnoreCase) && b.Inputs.Count != 1)
                    Fail("a MOVE with no input or two",
                        $"{what} holds {b.Inputs.Count} inputs: a MOVE with 0 or 2 inputs is not measured.", b);
            }

            foreach (var o in b.Outputs)
            {
                if (o.Value.Flags is { IsNone: false } of)
                    Fail("a flag on an output pin", $"{what}'s output to '{o.Value.Text}' carries {Describe(of)}: a modified output pin is not measured.", b);
                if (string.Equals(o.Formal, Box.EnoPin, StringComparison.OrdinalIgnoreCase) && !isFb)
                {
                    if (!NetworkSpelling.EnoShown(b))
                        Fail("an ENO output pin on a box without ENO", $"{what} wires an output named ENO to '{o.Value.Text}' and shows no ENO.", b);
                    if (consumed)
                        Fail("an ENO pin wired beside a consumer",
                            $"{what} wires its ENO to '{o.Value.Text}' and a consumer reads it: it stores and does not build (\"ENO output is not used as main output\", X12).", b);
                }
            }

            // X9 (4c): an ENO output with no EN is an FB's declared output, an Execute box's by type, or a function's (its
            // box built with its output list builds on both vendors: `rcc_network_eno_function_without_en`) — on an
            // operator it does not build ("Missing EN pin").
            if (b.HasEnoOutput && b.Enable is null && !isFb && !isExecute && NetworkSpelling.IsOperatorBox(b.Type))
                Fail("an ENO output without EN",
                    $"{what} has an ENO output and no EN: it stores and does not build (\"Missing EN pin\", X9).", b);

            // An FB's stored ENO with no EN is shown only where a consumer reads it with nothing after the box. At the top level
            // or read by `.name` the text has no position for it, so a positional output after it would read back one slot
            // lower, onto the ENO's (named outputs carry no slot: there the ENO alone is what a rebuild loses).
            if (isFb && b.HasEnoOutput && b.Enable is null && !(consumed && b.MainOutputName is null) && b.Outputs.Any(o => o.Formal is null))
                Fail("a positional output after an FB's unshown ENO",
                    $"{what} has an ENO output and no EN, which the text shows nowhere here, and an unnamed output pin after it.", b);

            if (!consumed)
            {
                if (b.ConnectedSlot is { } slot)
                    Fail("a top-level box with a connection slot", $"the top-level {what} records output slot {slot} as connected, and nothing consumes it.", b);
            }
            else Connection(b, what, isFb, isExecute);

            if (b.Enable is not null) Value(b.Enable, consumed: true);
            foreach (var p in b.Inputs) Value(p.Value, consumed: true);
        }

        /// <summary>How a consumer reads the box — the connection the IDE stores, checked against what builds.</summary>
        private void Connection(Box b, string what, bool isFb, bool isExecute)
        {
            if (NetworkSpelling.ConnectedByEno(b))
            {
                // X3 (3c, measured on operators): an operator box with EN read through its ENO writes its value somewhere,
                // or it stores and does not build. A function or a program call with no output wired is a stored shape the
                // corpora hold (a PROGRAM call's box has no data output at all) — not refused.
                if (b.Enable is not null && !isFb && !isExecute && NetworkSpelling.IsOperatorBox(b.Type) &&
                    !b.Outputs.Any(o => o.Formal is null || !string.Equals(o.Formal, Box.EnoPin, StringComparison.OrdinalIgnoreCase)))
                    Fail("an operator box read through its ENO with no output wired",
                        $"{what} is read through its ENO and writes its value nowhere: it stores and does not build (X3) — wire it, `=> t`.", b);
                return;
            }
            if (isExecute)
                Fail("an EXECUTE box read by its value", "an EXECUTE box is read through its ENO, its only output.", b);
            if (b.Enable is not null && b.HasEnoOutput)
                Fail("a box with EN and ENO read by its value",
                    $"{what} has EN and an ENO output, and its consumer reads another output: it stores and does not build (\"ENO output is not used as main output\", X10).", b);
            if (isFb)
            {
                if (b.MainOutputName is not { } name)
                {
                    Fail("a consumed FB with no output named",
                        $"{what} is consumed by a data output and the model names none (`.name`).", b);
                    return;
                }
                if (name.Length == 0)
                    Fail("a consumed FB whose output has no name", $"{what} is read through an output slot the box names nothing.", b);
                if (string.Equals(name, Box.EnoPin, StringComparison.OrdinalIgnoreCase))
                    Fail("an FB read through .ENO",
                        $"{what} is read through an output named ENO: an FB's ENO is read with no `.name` (its declared ENO) or through its shown ENO (X9).", b);
                return;
            }
            if (b.MainOutputName is not null || (b.ConnectedSlot is { } slot && slot != (NetworkSpelling.MainSlotOfCall(b.Type) ?? 0)))
                Fail("a function read by a declared output",
                    $"{what} is read through its output slot {b.ConnectedSlot?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? b.MainOutputName}: not measured — a function is read by its value.", b);
            if (b.ConnectedSlot is null && NetworkSpelling.MainSlotOfCall(b.Type) is not null)
                Fail("a consumed box with no stored connection slot", $"{what} is consumed and does not record which output its consumer reads.", b);
        }

        private void ValueFlags(Flags f, string what, Node at)
        {
            if (f.Set || f.Reset || f.Jump || f.Return)
                Fail("a coil flag on a value", $"{what} carries {Describe(f)}, which a value has no spelling for.", at);
            if (f.Rising && f.Falling) Fail("rising and falling on one node", $"{what} carries both a rising and a falling edge.", at);
        }

        /// <summary>A pin's modifiers the text spells: a negation and an edge (2R.5 #15, #16; the edge around the negated pin,
        /// N17). A coil bit, or rising with falling, has no spelling.</summary>
        private static bool PinFlagsSpelled(Flags f) => !f.Set && !f.Reset && !f.Jump && !f.Return && !(f.Rising && f.Falling);

        private static void Fail(string reason, string detail, Node? at, string code = ConflictCodes.NetworkUnsupported) =>
            throw new FindingException(new Finding(reason, detail, code, at));
    }

    internal static string Describe(Flags f) =>
        string.Join(" + ", new[]
        {
            f.Negated ? "a negation" : null, f.Set ? "a set" : null, f.Reset ? "a reset" : null,
            f.Jump ? "a jump" : null, f.Return ? "a return" : null,
            f.Rising ? "a rising edge" : null, f.Falling ? "a falling edge" : null,
        }.Where(s => s != null));
}
