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
/// <see cref="Network.SplitPoints"/> entry; everything else is nested in its consumer by construction. The old
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
        private readonly HashSet<string> _reserved;
        private readonly List<string> _prelude = new();
        private int _g, _en, _i;

        public Emitter(StringBuilder sb, Network net, BodyLanguage lang)
        {
            _sb = sb;
            _net = net;
            _lang = lang;
            _wires = new HashSet<string>(net.SplitPoints.Select(s => s.Text), System.StringComparer.Ordinal);
            // A minted temp must never shadow a real declared identifier — an FB instance is the case that bites,
            // because it is a variable in the POU's VAR section AND appears in the body.
            _reserved = new HashSet<string>(System.StringComparer.Ordinal);
            foreach (var t in net.Trees) CollectInstances(t, _reserved);
        }

        public void Emit()
        {
            _sb.Append("NETWORK ").Append(_net.Order).Append(' ').Append(_lang == BodyLanguage.Ld ? "LD" : "FBD");
            // The quoted string is the network's TITLE. The previous model had one string field and PLCopen
            // carried neither, so title and jump-label were the same slot; both vendors' INetwork has both.
            if (!string.IsNullOrEmpty(_net.Title)) _sb.Append(" \"").Append(_net.Title).Append('"');
            if (_net.Disabled) _sb.Append(" DISABLED");
            _sb.Append('\n');

            if (!string.IsNullOrEmpty(_net.Comment))
                foreach (var line in _net.Comment!.Replace("\r", "").Split('\n'))
                    _sb.Append("  // ").Append(line).Append('\n');

            // A jump TARGET is the network's label — `myLabel:` on its own line.
            if (!string.IsNullOrEmpty(_net.Label)) _sb.Append("  ").Append(_net.Label).Append(":\n");

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
                case Terminator: break;
                // Same rule at statement level: rendering an unknown node emitted a bare `;` line. Render()
                // now throws for anything it has no form for, so this arm only ever sees nodes it can render.
                default: { var t = Render(n, nested: false); Flush(); Line(t + ";"); break; }
            }
        }

        private void Assignment(Assign a)
        {
            // An enabled box feeding an assignment renders as the IF form, with the sink inside it.
            if (a.Value is Box { Enable: not null } eb) { EnabledAssign(a, eb); return; }

            var value = a.Value is null ? "" : ApplyMods(Render(a.Value, nested: false), a.Flags);

            if (a.Targets.Count == 0) { Flush(); Line(value + ";"); return; }
            if (a.Targets.Count == 1) { Flush(); Line(Lhs(a.Targets[0]) + " := " + value + ";"); return; }

            // One value, several l-values: name it once rather than repeating the expression, which would
            // duplicate the producing box on the way back in.
            var g = Mint("g", ref _g);
            Flush();
            Line("LET " + g + " := " + value + ";");
            foreach (var t in a.Targets) Line(Lhs(t) + " := " + g + ";");
        }

        /// <summary>The left-hand side. A split point is an INTERNAL wire and is introduced with <c>LET</c>;
        /// anything else is a real l-value declared in the POU.</summary>
        private string Lhs(Operand target) =>
            _wires.Contains(target.Text) ? "LET " + target.Text : target.Text;

        private void EnabledAssign(Assign a, Box b)
        {
            var enText = Render(b.Enable!, nested: false);
            var body = Definition(b);
            var en = Mint("en", ref _en);
            Flush();
            Line("LET " + en + " := " + enText + ";");
            if (a.Targets.Count == 1)
                Line("IF " + en + " THEN " + Lhs(a.Targets[0]) + " := " + body + "; END_IF");
            else
            {
                var g = Mint("g", ref _g);
                Line("IF " + en + " THEN LET " + g + " := " + body + "; END_IF");
                foreach (var t in a.Targets) Line(Lhs(t) + " := " + g + ";");
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
            if (a.Value is null) { Flush(); Line(action + ";"); return; }
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
                case Box b: return ApplyMods(Definition(b), b.Flags);
                case Parallel p:
                    return "(" + string.Join(p.Mode == ParallelMode.And ? " AND " : " OR ",
                                             p.Branches.Select(x => Render(x, nested: true))) + ")";
                case Terminator t: return t.Input is null ? "" : Render(t.Input, nested);
                case Assign a: return a.Value is null ? "" : Render(a.Value, nested);

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

        private void Line(string s) => _sb.Append("  ").Append(s).Append('\n');

        private void Flush()
        {
            foreach (var p in _prelude) _sb.Append("  ").Append(p).Append('\n');
            _prelude.Clear();
        }

        /// <summary>Decorate an operand with its modifiers: <c>NOT</c> prefix, trailing <c>RISING</c>/
        /// <c>FALLING</c>, trailing <c>SET</c>/<c>RESET</c>. Inverse of the reader's modifier parsing.</summary>
        private static string ApplyMods(string value, Flags f)
        {
            if (f.IsNone) return value;
            if (f.Negated) value = "NOT " + value;
            if (f.Rising) value += " RISING";
            else if (f.Falling) value += " FALLING";
            if (f.Set) value += " SET";
            else if (f.Reset) value += " RESET";
            return value;
        }

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

        private static void CollectInstances(Node n, HashSet<string> into)
        {
            switch (n)
            {
                case Box b:
                    if (b.Instance is { } i && !string.IsNullOrEmpty(i.Text)) into.Add(i.Text);
                    if (b.Enable is { } e) CollectInstances(e, into);
                    foreach (var p in b.Inputs) CollectInstances(p.Value, into);
                    break;
                case Assign a:
                    if (a.Value is { } v) CollectInstances(v, into);
                    break;
                case Parallel p2:
                    if (p2.Input is { } pi) CollectInstances(pi, into);
                    foreach (var br in p2.Branches) CollectInstances(br, into);
                    break;
                case Terminator t:
                    if (t.Input is { } ti) CollectInstances(ti, into);
                    break;
            }
        }
    }
}
