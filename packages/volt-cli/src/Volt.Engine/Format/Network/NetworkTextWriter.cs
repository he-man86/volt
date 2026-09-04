using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Volt.Engine.Format.Network;

/// <summary>
/// Renders a <see cref="NetworkBody"/> to network text — the canonical, constrained ST-like dialect specified
/// in <c>docs/network-text.md</c>. <b>The FORMAT is unchanged by the move to <see cref="NetworkBody"/></b>: it
/// is a product surface (engineers' committed <c>.fb</c> files, and a first-class sublanguage of
/// <c>volt-lsp-iec</c>), so this is a retarget, not a redesign. <see cref="NetworkTextReader"/> reverses it.
///
/// <para><b>What the tree model removed.</b> The previous writer's bulk was lowering a GRAPH into nested
/// expressions, and every part of that is now structural rather than derived:</para>
/// <list type="bullet">
/// <item><b>Topological ordering</b> — gone. Tree order is evaluation order; there is nothing to sort.</item>
/// <item><b>Reference counting to decide inline-vs-name</b> — gone. A wire that fans out IS a
/// <see cref="Demux"/>; everything else is nested in its consumer by construction. The old
/// writer counted uses across the whole network, then normalised operator output pins so a fan-out wire was not
/// misread as single-use and wrongly inlined (which duplicated its box).</item>
/// <item><b>The EN/ENO "into-sink" special case</b> — gone. An enabled box that feeds one sink is simply the
/// value of an <see cref="Assign"/>, so <c>IF en THEN out := (…); END_IF</c> falls out of the shape.</item>
/// </list>
///
/// <para>What remains is genuinely the writer's job: minting names for opaque leaves and enable echoes,
/// applying modifiers, and choosing between a nested expression and a hoisted <c>LET</c> when a leaf's text is
/// not a single safe token.</para>
/// </summary>
public static class NetworkTextWriter
{
    public static string Write(NetworkBody body)
    {
        var sb = new StringBuilder();
        foreach (var net in body.Networks) new Emitter(sb, net, body.Language).Emit();
        return sb.ToString();
    }

    /// <summary>Per-network emission state: the minted-name counters, the names that must not be shadowed, and
    /// the prelude that hoisted <c>LET</c> statements accumulate into while an expression is being rendered.</summary>
    private sealed class Emitter
    {
        private readonly StringBuilder _sb;
        private readonly Network _net;
        private readonly BodyLanguage _lang;
        private readonly HashSet<string> _wires;
        private readonly Dictionary<int, string> _names;
        private readonly HashSet<string> _reserved;
        private readonly List<string> _prelude = new();
        private int _g, _en, _i;

        public Emitter(StringBuilder sb, Network net, BodyLanguage lang)
        {
            _sb = sb;
            _net = net;
            _lang = lang;
            var ids = new List<int>();
            foreach (var t in net.Trees) CollectWireIds(t, ids);
            // A minted temp must never shadow a real declared identifier. This used to collect FB INSTANCE
            // names only — no leaf, no assignment target — so an ordinary variable an engineer happened to
            // call `g1` was not reserved, and a network needing one minted wire produced
            // `LET g1 := (a AND b);` beside their own `outC := (g1 OR c);`. On the way back the reader
            // matches `g<n>` as a wire name and rewrites their variable read into a reference to Volt's
            // fan-out; re-emitting reproduces the text byte-for-byte, so the canonical gate passes, and the
            // push deletes their inVariable and changes what `outC` computes. Every identifier in the
            // network is reserved now, which is the only set that cannot collide.
            _reserved = new HashSet<string>(System.StringComparer.Ordinal);
            foreach (var t in net.Trees) CollectNames(t, _reserved);

            // A WIRE WHOSE OWN NAME IS TAKEN IS RENAMED, NOT REFUSED. `g<VarId>` is the vendor's id, and
            // reusing it verbatim is what stops an edit renumbering every wire in the rung (C9) — so it is the
            // name a wire GETS, whenever it is free. When a real variable is spelled the same the two meanings
            // cannot both be written, and one of them has to move; it is the wire, because the variable is the
            // engineer's.
            //
            // This USED TO THROW, and the throw ran on the PULL path — `Write` renders every body Volt reads
            // out of the IDE. A `NotSupportedException` there does not report a limit to anybody: the item
            // simply fails to materialize and the POU is missing from the workspace, which is the same failure
            // shape that once cost six POUs and 187 networks when a fed parallel was refused. Losing the whole
            // POU to keep one wire's id is the wrong trade by a wide margin.
            //
            // Defaults are assigned FIRST and the collisions renamed after, so a minted replacement can never
            // land on a name another wire was already going to take.
            _names = new Dictionary<int, string>();
            foreach (var id in ids)
                if (!_reserved.Contains(WireName(id))) _names[id] = WireName(id);

            _wires = new HashSet<string>(_names.Values, System.StringComparer.Ordinal);
            foreach (var id in ids)
                if (!_names.ContainsKey(id))
                {
                    var name = Mint("g", ref _g);
                    _names[id] = name;
                    _wires.Add(name);
                }
        }

        public void Emit()
        {
            // `NETWORK <order> <language>` is the network's IDENTITY and stays positional — every reader,
            // regex and editor grammar anchors on that prefix. Everything optional after it is NAMED.
            _sb.Append("NETWORK ").Append(_net.Order).Append(' ').Append(_lang == BodyLanguage.Ld ? "LD" : "FBD");

            // LABEL and TITLE are two different things and both vendors' INetwork carries both: the label is
            // the jump target `JMP` resolves against, the title is free text the engineer wrote. They were
            // one slot once, and the title spent a while being called the label. Naming them on the header
            // ends that: neither can be mistaken for the other, for `DISABLED`, or for the language, and a
            // later field can be added without shifting anything. The label used to be a `myLabel:` line in
            // the BODY, which modelled a property of the network as a statement — the same conflation in a
            // different place.
            if (!string.IsNullOrEmpty(_net.Label)) _sb.Append(" LABEL: ").Append(_net.Label);

            // A QUOTE INSIDE THE TITLE IS DOUBLED. Engineers put quotes in network titles — one real project
            // has two, `Muting of alarm "No bunch"` and `the "Active"-alarm signals are reset` — and writing
            // them raw ended the title early for any reader, so the second half was lost on the way back in.
            // Doubling is the escape because it needs nothing but the delimiter itself: no new character to
            // reserve, and a title with no quote in it is unchanged.
            if (!string.IsNullOrEmpty(_net.Title))
                _sb.Append(" TITLE: \"").Append(_net.Title!.Replace("\"", "\"\"")).Append('"');

            // DISABLED stays a bare flag — it is a keyword, not a value, and reads better than `DISABLED: true`.
            if (_net.Disabled) _sb.Append(" DISABLED");
            _sb.Append('\n');

            if (!string.IsNullOrEmpty(_net.Comment))
                foreach (var line in _net.Comment!.Replace("\r", "").Split('\n'))
                    _sb.Append("  // ").Append(line).Append('\n');

            foreach (var tree in _net.Trees) Statement(tree);
            _sb.Append("END_NETWORK\n");
        }

        // ── statements ────────────────────────────────────────────────────────────────────────────

        private void Statement(Node n)
        {
            _prelude.Clear();
            switch (n)
            {
                case Box b when b.StCode is not null: Execute(b); break;
                case Assign a when a.Flags.Jump || a.Flags.Return: Goto(a); break;
                case Assign a: Assignment(a); break;
                case Box b when b.Enable is not null: EnabledCall(b); break;
                case Box b: { var t = Definition(b); Flush(); Line(t + ";"); break; }
                case Terminator t when t.Input is not null: Statement(t.Input); break;
                // NOT a bare `break`. An unconnected terminator standing as its own statement is an item the
                // IDE is holding, and dropping it emitted no line at all — the item gone from the workspace
                // with nothing in the file to show it had ever been there.
                case Terminator: Flush(); Line(Unconnected + ";"); break;

                // A fan-out wire's DEFINITION. The vendor holds it as a `BoxTreeDemux` carrying the producer;
                // the format spells it `LET g<VarId> := <producer>;` (docs/network-text.md §5) and every
                // reference to it renders as the bare name. Both halves were missing, which is how 573 of these
                // in one real project came back as `out := ( AND b);` with the wire silently gone.
                case Demux d when d.Input is not null:
                {
                    var v = ApplyMods(Render(d.Input, nested: false), d.Flags);
                    Flush();
                    Line("LET " + NameOf(d.VarId) + " := " + v + ";");
                    break;
                }
                // Same rule at statement level: rendering an unknown node emitted a bare `;` line. Render()
                // now throws for anything it has no form for, so this arm only ever sees nodes it can render.
                default: { var t = Render(n, nested: false); Flush(); Line(t + ";"); break; }
            }
        }

        private void Assignment(Assign a)
        {
            // An enabled box feeding an assignment renders as the IF form, with the sink inside it.
            if (a.Value is Box { Enable: not null } eb) { EnabledAssign(a, eb); return; }

            // `?`, not "": a coil with nothing driving it says so, instead of rendering as `x := ;`. One
            // spelling for "connected to nothing", everywhere it can occur.
            var value = a.Value is null ? Unconnected : ApplyMods(Render(a.Value, nested: false), a.Flags);

            if (a.Targets.Count == 0) { Flush(); Line(value + ";"); return; }
            if (a.Targets.Count == 1) { Flush(); Line(Lhs(a.Targets[0]) + " " + AssignOp(a.Targets[0]) + " " + value + ";"); return; }

            // One value, several l-values: name it once rather than repeating the expression, which would
            // duplicate the producing box on the way back in. EACH TARGET KEEPS ITS OWN OPERATOR — a fan-out
            // whose coils disagree (one plain, one SET) is ordinary, and the old trailing-word spelling had
            // one modifier for the whole statement, so it could only carry the first coil's storage.
            var g = Mint("g", ref _g);
            Flush();
            Line("LET " + g + " := " + value + ";");
            foreach (var t in a.Targets) Line(Lhs(t) + " " + AssignOp(t) + " " + g + ";");
        }

        /// <summary>The left-hand side. A split point is an INTERNAL wire and is introduced with <c>LET</c>;
        /// anything else is a real l-value declared in the POU.</summary>
        private string Lhs(Operand target) =>
            _wires.Contains(target.Text) ? "LET " + target.Text : target.Text;

        /// <summary>A fan-out wire's name: `g<VarId>` whenever that is free, so the SAME wire keeps the same
        /// name across a pull -> push round trip and the id the IDE holds survives it (C9). A wire whose id
        /// spells a name the engineer already uses is minted a free one instead — see the constructor.</summary>
        private string NameOf(int varId) => _names[varId];

        /// <summary>The name a wire WANTS. Only the constructor asks, and only to find out whether it is free.</summary>
        private static string WireName(int varId) => "g" + varId;

        private static void CollectWireIds(Node? n, List<int> into)
        {
            switch (n)
            {
                case Demux d:
                    into.Add(d.VarId);
                    CollectWireIds(d.Input, into);
                    break;
                case Assign a: CollectWireIds(a.Value, into); break;
                case Box b:
                    CollectWireIds(b.Enable, into);
                    foreach (var p in b.Inputs) CollectWireIds(p.Value, into);
                    break;
                case Parallel p2:
                    CollectWireIds(p2.Input, into);
                    foreach (var br in p2.Branches) CollectWireIds(br, into);
                    break;
                case Terminator t: CollectWireIds(t.Input, into); break;
            }
        }

        private void EnabledAssign(Assign a, Box b)
        {
            var enText = Render(b.Enable!, nested: false);
            var body = Definition(b);
            var en = Mint("en", ref _en);
            Flush();
            Line("LET " + en + " := " + enText + ";");
            if (a.Targets.Count == 1)
                Line("IF " + en + " THEN " + Lhs(a.Targets[0]) + " " + AssignOp(a.Targets[0]) + " " + body + "; END_IF");
            else
            {
                var g = Mint("g", ref _g);
                Line("IF " + en + " THEN LET " + g + " := " + body + "; END_IF");
                foreach (var t in a.Targets) Line(Lhs(t) + " " + AssignOp(t) + " " + g + ";");
            }
        }

        private void EnabledCall(Box b)
        {
            var enText = Render(b.Enable!, nested: false);
            var body = Definition(b);
            var en = Mint("en", ref _en);
            Flush();
            Line("LET " + en + " := " + enText + ";");
            Line("IF " + en + " THEN " + body + "; END_IF");
        }

        /// <summary>A CODESYS Execute box: an enabled box whose call is raw ST. The ST is emitted VERBATIM
        /// between the markers — its own indentation preserved — so it round-trips byte-for-byte, and the
        /// explicit <c>END_EXECUTE</c> disambiguates the ST's own nested <c>END_IF</c>s.</summary>
        private void Execute(Box b)
        {
            var st = b.StCode!.Replace("\r", "").TrimEnd('\n');
            if (b.Enable is null)
            {
                Flush();
                Line("EXECUTE");
                _sb.Append(st).Append('\n');
                Line("END_EXECUTE");
                return;
            }
            var enText = Render(b.Enable, nested: false);
            var en = Mint("en", ref _en);
            Flush();
            Line("LET " + en + " := " + enText + ";");
            Line("IF " + en + " THEN");
            Line("EXECUTE");
            _sb.Append(st).Append('\n');
            Line("END_EXECUTE");
            Line("END_IF");
        }

        private void Goto(Assign a)
        {
            var action = a.Flags.Jump
                ? "JMP " + (a.Targets.Count > 0 ? a.Targets[0].Text : "")
                : "RETURN";
            // UNCONDITIONAL when nothing drives it — a null value, or the unconnected terminator the
            // reader builds for exactly this (a rung end nothing drives). Rendering the terminator as a
            // condition instead would emit `IF  THEN RETURN; END_IF`, with an empty condition.
            if (a.Value is null or Terminator { Input: null }) { Flush(); Line(action + ";"); return; }
            var cond = ApplyMods(Render(a.Value, nested: false), a.Flags with { Jump = false, Return = false });
            Flush();
            Line("IF " + cond + " THEN " + action + "; END_IF");
        }

        // ── expressions ───────────────────────────────────────────────────────────────────────────

        /// <summary>An expression. <paramref name="nested"/> is true at operand position, where a leaf whose
        /// text is not a single safe token cannot appear inline — it would mis-split an operator group or
        /// mis-parse as a call — so it is hoisted to its own <c>LET i*</c> statement.</summary>
        private string Render(Node n, bool nested)
        {
            switch (n)
            {
                case Leaf l:
                {
                    var text = ApplyMods(l.Operand.Text, l.Flags);
                    // The safety test is about the OPERAND'S OWN TEXT, not about the modifiers on it. A modifier
                    // is grammar the parser reads inline at operand position (`NOT`, `RISING`/`FALLING`,
                    // `SET`/`RESET` - Cursor.Operand), so testing the rendered string instead meant every
                    // modifier's own space disqualified it: `(a AND NOT b)` was hoisted to
                    // `LET i1 := NOT b; out := (a AND i1);`. That is still correct network text and still means
                    // the same tree, but it is not what the engineer wrote, so the canonical-form gate refused
                    // their push and told them to write Volt's version instead.
                    if (!nested || IsSafeToken(l.Operand.Text)) return text;
                    var name = Mint("i", ref _i);
                    _prelude.Add("LET " + name + " := " + text + ";");
                    return name;
                }
                // A REFERENCE to a fan-out wire: the bare name. A Demux carrying an input is the definition
                // and is emitted as a statement, but it can also sit inline as its own consumer's source.
                case Demux d: return ApplyMods(NameOf(d.VarId), d.Flags);

                case Box b: return ApplyMods(Definition(b), b.Flags);
                case Parallel p:
                    // Branches are OR-ed. A ladder's parallel IS an OR, it is the only form the published text
                    // format spells (the AND in "((a OR b) AND c)" is a series, i.e. an AND box), and it is the
                    // only value either vendor can produce — `IBoxTreeParallel.Mode` is
                    // `Sequential|BoxShortCircuit` and carries no And/Or at all.
                    //
                    // THE RUNG FEEDING THE BRANCH IS IN SERIES WITH IT, and it used to be dropped on the floor.
                    //
                    // `Parallel.Input` is "the rung feeding the branch" and `Branches` are the parallel paths
                    // (NetworkModel), so the logic is `Input AND (b1 OR b2 …)`. This arm rendered the branches
                    // ALONE, leaving the feeding element out of the committed file entirely — a silent change to
                    // what the program computes, not merely to how it draws. The text was then a fixed point, so
                    // the canonical gate passed and `volt status` read clean over it.
                    //
                    // REFUSING WAS TRIED FIRST AND WAS WORSE, which is worth recording because it looked like the
                    // principled answer. A body the reader refuses is an item `FetchService` skips (DIALECT C7),
                    // and a fed parallel is not the rarity it was assumed to be: refusing removed SIX POUs from
                    // the Lenze workspace — 187 networks, including the four largest ladders in the project — and
                    // losing a POU entirely is a worse outcome than any rendering of it.
                    //
                    // So it is rendered, honestly. What survives is the LOGIC and the round trip; what does not
                    // is the drawing's shape on a rebuild, because re-reading `(c AND (a OR b))` gives an AND box
                    // over an OR box rather than a `BoxTreeParallel`. That costs a redraw of a network the
                    // engineer edited anyway, and the change gate spares every network they did not touch. A
                    // dedicated spelling for a parallel would keep the shape too, and wants measuring against a
                    // real ladder before it is invented.
                    var branches = "(" + string.Join(" OR ",
                                                     p.Branches.Select(x => Render(x, nested: true))) + ")";
                    var rung = p.Input is null
                        ? branches
                        : "(" + Render(p.Input, nested: true) + " AND " + branches + ")";
                    return ApplyMods(rung, p.Flags);
                // AN UNCONNECTED PIN HAS A SPELLING. These two arms used to return "" — the same silent
                // default that the comment below calls "the single line that turned a missing feature into
                // invisible data loss", three lines above where it says so. A box input wired to nothing is a
                // `Terminator` with no input, and rendering it as nothing produced text nobody can read back:
                // `( * iRPM * 6)`, `RESET := , PV := )`, `MOVE(, iDec)`. Measured on a real customer project
                // (Lenze_MID-S100): 110 of its 373 networks, every one of them pullable and un-pushable.
                //
                // THE SPELLING IS THE EMPTY SLOT ITSELF, and that is a measured choice rather than a shrug.
                // A magic token was tried first — `?`, on the reasoning that it "cannot be anything else". It
                // can: CODESYS writes `???` into a box whose instance is not yet named, and the same project
                // holds five of them, one as an assignment target (`??? := ioAxis.xVirtual;`). A token picked
                // for being impossible turned out to be content.
                //
                // An empty slot cannot collide with anything, because it is a POSITION rather than a string:
                // the grammar is fully parenthesised with no precedence (§4), so `(`, `,`, `)`, `:=` and an
                // operator symbol each mark a place an operand belongs, and finding the next one of those
                // instead says there is no operand there. The reader reads it deliberately (`IsEmptyOperand`),
                // which is the opposite of the silent "" this used to return.
                case Terminator t: return t.Input is null ? Unconnected : Render(t.Input, nested);
                case Assign a: return a.Value is null ? Unconnected : Render(a.Value, nested);

                // NO SILENT DEFAULT. This arm returned "" — the single line that turned a missing feature into
                // invisible data loss. A `Demux` (the vendor's fan-out item, the 4th most common item in the one
                // real ladder project ever surveyed: 573 across 36 POUs) has no arm here, so a branch off a gate
                // output PULLED as `out := ( AND b);` — the wire silently gone, `volt status` clean, and the
                // resulting file no longer parseable, so it could never be pushed back either. A body Volt
                // cannot render must fail, never render as nothing.
                default:
                    throw new NotSupportedException(
                        $"network text has no form for the graphical node '{n.GetType().Name}' — refusing to " +
                        "render a body that is not what the IDE holds. Edit this POU in the IDE.");
            }
        }

        /// <summary>A box's VALUE expression: an operator renders fully parenthesised and infix, a stateless
        /// function as a positional call, an FB instance as a pin-bound call.</summary>
        private string Definition(Box b)
        {
            var args = b.Inputs
                .Select(p => (p.Formal, Text: ApplyMods(Render(p.Value, nested: true), p.Flags)))
                .ToList();

            if (FbdOperators.TypeToSymbol.TryGetValue(b.Type, out var op))
                return "(" + string.Join(" " + op + " ", args.Select(a => a.Text)) + ")";
            if (b.Instance is { } inst)
                return inst.Text + "(" + string.Join(", ", args.Select(a => a.Formal + " := " + a.Text)) + ")";
            return b.Type + "(" + string.Join(", ", args.Select(a => a.Text)) + ")";
        }

        // ── helpers ───────────────────────────────────────────────────────────────────────────────

        /// <summary>The operand text for a pin connected to NOTHING: the empty slot (docs/network-text.md §3).
        /// Named rather than written as a bare "" so every site that means "no operand" says so, and so this
        /// comment sits where the decision is.</summary>
        private const string Unconnected = "";

        private void Line(string s) => _sb.Append("  ").Append(s).Append('\n');

        private void Flush()
        {
            foreach (var p in _prelude) _sb.Append("  ").Append(p).Append('\n');
            _prelude.Clear();
        }

        /// <summary>Decorate an operand with the modifiers a VALUE carries: <c>NOT</c> prefix, trailing
        /// <c>RISING</c>/<c>FALLING</c>. Inverse of the reader's modifier parsing.
        ///
        /// <para>Coil storage is deliberately absent. It belongs to the TARGET, and <see cref="AssignOp"/>
        /// renders it as the assignment operator.</para></summary>
        private static string ApplyMods(string value, Flags f)
        {
            if (f.IsNone) return value;
            if (f.Negated) value = "NOT " + value;
            if (f.Rising) value += " RISING";
            else if (f.Falling) value += " FALLING";
            return value;
        }

        /// <summary>The assignment operator a coil's STORAGE spells — ExST's own, per
        /// <c>docs/codesys-reference/01-languages-and-editors.md</c>: <c>S=</c> sets, <c>R=</c> resets.
        ///
        /// <para><b>Storage is a property of the coil, and now reads like one.</b> The format used to spell it
        /// as a trailing word on the VALUE — <c>out := a SET;</c> — which put it on the wrong side of the
        /// assignment and cost more than legibility: the whole of <c>CoilStorage</c> (deleted) existed to carry
        /// the flag across that gap and back, a fan-out whose coils disagreed could not be spelled at all
        /// because one trailing word had to serve every target, and the target's own bits were never rendered,
        /// so a RESET coil — the vendor's <c>Negation + Set</c> — came out as a plain <c>SET</c>. Per target,
        /// on the target, none of those are expressible.</para></summary>
        private static string AssignOp(Operand target) =>
            target.Flags switch { { Reset: true } => "R=", { Set: true } => "S=", _ => ":=" };

        /// <summary>A leaf can sit inline iff its text is a single safe token — no whitespace (which would
        /// mis-split an operator expression) and no parens (which would mis-parse as a call or group).</summary>
        private static bool IsSafeToken(string t) =>
            t.IndexOf(' ') < 0 && t.IndexOf('(') < 0 && t.IndexOf(')') < 0;

        private string Mint(string prefix, ref int n)
        {
            string s;
            do { s = prefix + (++n); } while (_reserved.Contains(s) || _wires.Contains(s));
            return s;
        }

        /// <summary>Every identifier this network MENTIONS — leaves, assignment targets, box instances and
        /// box outputs — so a minted `g<n>`/`i<n>`/`en<n>` cannot land on one of them.
        ///
        /// <para>It collected FB instances alone, and the name says why that looked sufficient: an instance
        /// is a declared variable that also appears in the body. So is every other operand. A `Leaf` arm was
        /// simply missing, which is the whole of the bug — its twin <c>CollectWires</c> has always walked the
        /// same tree for the other set.</para></summary>
        private static void CollectNames(Node? n, HashSet<string> into)
        {
            switch (n)
            {
                case Leaf l:
                    if (!string.IsNullOrEmpty(l.Operand.Text)) into.Add(l.Operand.Text);
                    break;
                case Box b:
                    if (b.Instance is { } i && !string.IsNullOrEmpty(i.Text)) into.Add(i.Text);
                    foreach (var o in b.Outputs)
                        if (!string.IsNullOrEmpty(o.Text)) into.Add(o.Text);
                    CollectNames(b.Enable, into);
                    foreach (var p in b.Inputs) CollectNames(p.Value, into);
                    break;
                case Assign a:
                    foreach (var t2 in a.Targets)
                        if (!string.IsNullOrEmpty(t2.Text)) into.Add(t2.Text);
                    CollectNames(a.Value, into);
                    break;
                // A demux's own NAME is a wire, collected by `CollectWires`; only what feeds it is a name.
                case Demux d: CollectNames(d.Input, into); break;
                case Parallel p2:
                    CollectNames(p2.Input, into);
                    foreach (var br in p2.Branches) CollectNames(br, into);
                    break;
                case Terminator t: CollectNames(t.Input, into); break;
            }
        }
    }
}
