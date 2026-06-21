using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Volt.Bridge.Core.Graphical.Vg
{
    /// <summary>
    /// Renders a <see cref="GraphBody"/> to VG text — a canonical, constrained Structured-Text-LIKE
    /// dialect that is ISOMORPHIC to the PLCopen node graph: each network is a delimited block
    /// <c>NETWORK &lt;index&gt; &lt;LANG&gt; … END_NETWORK</c>, and EVERY node is its own named statement
    /// (inVariable leaves <c>i*</c>, operator/function results <c>g*</c>, FB instances keep their real
    /// name, outVariables keep their target), operands are ONLY names or literals — never a nested
    /// sub-expression. Per-network synthetic temps are declared in a <c>VAR_TEMP</c> block (a VG-only
    /// construct, stripped on push, regenerated on pull). This shrinks the VG⊄FBD gap to ~zero and
    /// makes round-trip identical in all cases (fan-out preserved by shared names). Pin modifiers are
    /// VG EXTENSIONS, not standard ST: <c>NOT operand</c> (negation — valid ST), and the suffixes
    /// <c>RISING</c>/<c>FALLING</c> (edge) and <c>SET</c>/<c>RESET</c> (storage), which keep the
    /// modifier visible at the pin rather than synthesizing hidden R_TRIG/SR instances. Round-trippable
    /// (<c>VgParser</c> reverses it); emission is deterministic so VG→graph→VG is a fixed point.
    /// </summary>
    public static class VgWriter
    {
        // Operator box types render infix; everything else is an FB call or function call.
        // Canonical operator table lives in FbdOperators (shared with the transpiler + parser).
        public static string Write(GraphBody body)
        {
            var sb = new StringBuilder();
            int seq = 0;
            foreach (var net in body.Networks) { WriteNetwork(sb, net, net.Order ?? seq, body.Language); seq++; }
            return sb.ToString();
        }

        // A network is a delimited block — NETWORK <index> <LANG> … END_NETWORK — with a VAR_TEMP
        // decl section and an impl section, mirroring a POU. <index> is the REAL PLCopen network index
        // (localId / 10^10), so gapped bodies (e.g. networks 1,2,4) round-trip without re-numbering;
        // <LANG> (FBD/LD) carries the body language, so there's no separate %LANG header.
        private static void WriteNetwork(StringBuilder sb, GraphNetwork net, int index, string language)
        {
            sb.Append("NETWORK ").Append(index).Append(' ').Append(language);
            if (!string.IsNullOrEmpty(net.Label)) sb.Append(" \"").Append(net.Label).Append('"');
            if (net.Disabled) sb.Append(" DISABLED");
            sb.Append('\n');
            if (!string.IsNullOrEmpty(net.Comment))
                foreach (var line in net.Comment!.Replace("\r", "").Split('\n'))
                    sb.Append("  // ").Append(line).Append('\n');

            var byId = net.Nodes.ToDictionary(n => n.LocalId);
            var blocks = net.Nodes.OfType<Block>().ToList();
            var ordered = TopoOrder(blocks, byId);

            bool IsEnEno(Block b) => b.Inputs.Any(p => p.FormalParameter == "EN");
            string? ResultPin(Block b) => IsEnEno(b) ? "Out2" : null;   // EN/ENO result is the Out2 pin; an operator's is unnamed

            // Consumer count per (producer, output pin) — the basis for inline-vs-name: a wire used ONCE is
            // inlined into its consumer's expression; a wire that fans out (2+) keeps a name (else inlining it
            // would duplicate its box).
            var uses = new Dictionary<(long, string?), int>();
            int Get((long, string?) k) => uses.TryGetValue(k, out var v) ? v : 0;
            // A plain operator/function has a SINGLE output, referenced as either the bare name (null pin) or its
            // "OUT" pin — the IDE round-trip flips between them, so normalise to null or the count splits and a
            // fan-out wire is misread as single-use (→ wrongly inlined, duplicating the box).
            string? OutKey(long id, string? pin) =>
                byId.TryGetValue(id, out var p) && p is Block pb && IsOperatorOrFunction(pb) && !IsEnEno(pb) ? null : pin;
            void Count(Conn? c) { if (c != null) { var k = (c.RefLocalId, OutKey(c.RefLocalId, c.FormalParameter)); uses[k] = Get(k) + 1; } }
            foreach (var n in net.Nodes)
                switch (n)
                {
                    case Block bb: foreach (var p in bb.Inputs) Count(p.Source); break;
                    case OutVar o: Count(o.Source); break;
                    case Jump j: Count(j.Condition); break;
                    case Return r: Count(r.Condition); break;
                }
            int ResultUses(Block b) => Get((b.LocalId, ResultPin(b)));

            var reserved = new HashSet<string>(
                blocks.Where(b => !IsOperatorOrFunction(b) && !string.IsNullOrEmpty(b.InstanceName))
                      .Select(b => b.InstanceName!), StringComparer.Ordinal);

            // NAMED producers (get a statement + a `g*`/instance name): FB instances (stateful), EN/ENO boxes
            // (the IF form + the `en*` ENO wire), and operator/function results that FAN OUT. Everything else —
            // leaves and single-use operator/function results — is INLINED into its consumer's expression.
            var names = new Dictionary<long, string>();
            var enNames = new Dictionary<long, string>();
            int g = 0, en = 0, li = 0;
            foreach (var b in ordered)
            {
                if (!IsOperatorOrFunction(b)) names[b.LocalId] = b.InstanceName!;           // FB instance
                else if (IsEnEno(b) || ResultUses(b) >= 2) names[b.LocalId] = Mint("g", ref g, reserved);
                if (IsEnEno(b)) enNames[b.LocalId] = Mint("en", ref en, reserved);
            }
            // An OPAQUE leaf — its text has whitespace or parens, so it can't sit at an operand position as a
            // single token (it would mis-split or mis-parse as a call) — is NAMED and gets its own statement.
            // A simple atom (a bare variable/literal) is inlined.
            var leaves = net.Nodes.OfType<InVar>().OrderBy(n => n.LocalId).ToList();
            foreach (var iv in leaves)
                if (!IsInlinableLeaf(iv)) names[iv.LocalId] = Mint("i", ref li, reserved);

            // VAR_TEMP declares only the SYNTHETIC named wires (named opaque leaves i*, g* results, en*) —
            // inlined leaves and FB instances (real vars) are not temps. Keeps the body valid ST and lets the
            // parser tell a named result (`g1 := …`) from a sink (`out := …`).
            var temps = new List<(string Name, string Type)>();
            foreach (var iv in leaves)
                if (names.TryGetValue(iv.LocalId, out var ln)) temps.Add((ln, "BOOL"));
            foreach (var b in ordered)
            {
                if (enNames.TryGetValue(b.LocalId, out var et)) temps.Add((et, "BOOL"));
                if (names.TryGetValue(b.LocalId, out var rn) && IsOperatorOrFunction(b))
                    temps.Add((rn, b.OutputTypes?.FirstOrDefault() ?? "BOOL"));
            }
            if (temps.Count > 0)
            {
                sb.Append("  VAR_TEMP\n");
                foreach (var (nm, ty) in temps) sb.Append("    ").Append(nm).Append(" : ").Append(ty).Append(";\n");
                sb.Append("  END_VAR\n");
            }

            // A wire → text. A NAMED producer is its name (`.Pin` for an FB output, `en*` for an ENO); an
            // INLINED producer recurses to its expression (a leaf → its literal/var; an operator/function →
            // its parenthesised body).
            string Render(Conn? c)
            {
                if (c == null) return "";
                if (!byId.TryGetValue(c.RefLocalId, out var src)) return "";
                if (c.FormalParameter == "ENO" && enNames.TryGetValue(c.RefLocalId, out var enWire)) return enWire;
                if (names.TryGetValue(c.RefLocalId, out var nm))
                    return (src is Block fb && c.FormalParameter != null && !IsOperatorOrFunction(fb))
                        ? nm + "." + c.FormalParameter : nm;
                return src switch
                {
                    InVar iv => ApplyMods(iv.Expression, iv.Mods),
                    Block b => Definition(b, excludeEn: false),
                    _ => "",
                };
            }
            // A block's VALUE expression (no LHS): operator → fully-parenthesised infix, stateless function →
            // call, FB instance → pin-bound call. EN/ENO reuses it for the IF body, dropping the EN pin.
            string Definition(Block b, bool excludeEn)
            {
                var args = b.Inputs.Where(p => p.Source != null && !(excludeEn && p.FormalParameter == "EN"))
                    .Select(p => (Pin: p.FormalParameter, Val: ApplyMods(Render(p.Source), p.Mods))).ToList();
                if (FbdOperators.TypeToSymbol.TryGetValue(b.TypeName, out var op))
                    return "(" + string.Join($" {op} ", args.Select(a => a.Val)) + ")";
                if (string.IsNullOrEmpty(b.InstanceName))
                    return b.TypeName + "(" + string.Join(", ", args.Select(a => a.Val)) + ")";
                return b.InstanceName + "(" + string.Join(", ", args.Select(a => a.Pin + " := " + a.Val)) + ")";
            }

            // Statements: named opaque leaves first, then named blocks (topo order, so a name is defined before
            // it's used), then sinks, then control flow. Inlined leaves / single-use results emit nothing.
            foreach (var iv in leaves)
                if (names.TryGetValue(iv.LocalId, out var ln))
                    sb.Append("  ").Append(ln).Append(" := ").Append(ApplyMods(iv.Expression, iv.Mods)).Append(";\n");

            foreach (var b in ordered)
            {
                if (IsEnEno(b))
                {
                    var enPin = b.Inputs.First(p => p.FormalParameter == "EN");
                    sb.Append("  ").Append(enNames[b.LocalId]).Append(" := ")
                      .Append(ApplyMods(Render(enPin.Source), enPin.Mods)).Append(";\n");
                    sb.Append("  IF ").Append(enNames[b.LocalId]).Append(" THEN ");
                    if (IsOperatorOrFunction(b)) sb.Append(names[b.LocalId]).Append(" := ").Append(Definition(b, excludeEn: true));
                    else sb.Append(Definition(b, excludeEn: true));   // EN/ENO FB call
                    sb.Append("; END_IF\n");
                }
                else if (names.TryGetValue(b.LocalId, out var nm))
                {
                    if (IsOperatorOrFunction(b)) sb.Append("  ").Append(nm).Append(" := ").Append(Definition(b, false)).Append(";\n");
                    else sb.Append("  ").Append(Definition(b, false)).Append(";\n");   // FB instance call
                }
            }

            foreach (var ov in net.Nodes.OfType<OutVar>())
                sb.Append("  ").Append(ov.Expression).Append(" := ").Append(ApplyMods(Render(ov.Source), ov.Mods)).Append(";\n");

            foreach (var node in net.Nodes)
                switch (node)
                {
                    case Label lb: sb.Append("  ").Append(lb.Name).Append(":\n"); break;
                    case Jump jp: EmitGoto(sb, "JMP " + jp.Target, jp.Condition, jp.Mods, Render); break;
                    case Return rt: EmitGoto(sb, "RETURN", rt.Condition, rt.Mods, Render); break;
                }

            sb.Append("END_NETWORK\n");
        }

        /// <summary>The next synthetic name <c>prefix{n}</c> that isn't a real (reserved) identifier,
        /// so a temp can never shadow an FB instance of the same name.</summary>
        private static string Mint(string prefix, ref int n, HashSet<string> reserved)
        {
            string s;
            do { s = prefix + (++n); } while (reserved.Contains(s));
            return s;
        }

        private static void EmitGoto(StringBuilder sb, string action, Conn? cond, Mods mods, Func<Conn?, string> render)
        {
            if (cond is null) { sb.Append("  ").Append(action).Append(";\n"); return; }
            sb.Append("  IF ").Append(ApplyMods(render(cond), mods)).Append(" THEN ").Append(action).Append("; END_IF\n");
        }

        /// <summary>Decorate an operand with its modifiers: <c>NOT</c> prefix (negation), trailing
        /// <c>RISING</c>/<c>FALLING</c> (edge), trailing <c>SET</c>/<c>RESET</c> (storage). Inverse
        /// of <see cref="VgParser"/>'s modifier parsing.</summary>
        private static string ApplyMods(string value, Mods m)
        {
            if (m.IsNone) return value;
            if (m.Negated) value = "NOT " + value;
            if (m.Edge == EdgeMod.Rising) value += " RISING";
            else if (m.Edge == EdgeMod.Falling) value += " FALLING";
            if (m.Storage == StorageMod.Set) value += " SET";
            else if (m.Storage == StorageMod.Reset) value += " RESET";
            return value;
        }

        private static bool IsOperatorOrFunction(Block b)
            => FbdOperators.TypeToSymbol.ContainsKey(b.TypeName) || string.IsNullOrEmpty(b.InstanceName);

        /// <summary>A leaf is inlinable iff its rendered text is a single safe token — no whitespace (which
        /// would mis-split an operator expression) and no parens (which would mis-parse as a call/group). Opaque
        /// leaves (`a + 1`, `NOT x`, `f(x)`) fail this and are named instead.</summary>
        private static bool IsInlinableLeaf(InVar iv)
        {
            var t = ApplyMods(iv.Expression, iv.Mods);
            return t.IndexOf(' ') < 0 && t.IndexOf('(') < 0 && t.IndexOf(')') < 0;
        }

        /// <summary>Order blocks so every block appears after the blocks feeding its inputs;
        /// ties broken by localId for determinism. Cycles (shouldn't occur in FBD) fall back to
        /// localId order.</summary>
        private static List<Block> TopoOrder(List<Block> blocks, IReadOnlyDictionary<long, GraphNode> byId)
        {
            var blockIds = new HashSet<long>(blocks.Select(b => b.LocalId));
            var result = new List<Block>();
            var state = new Dictionary<long, int>(); // 0=unseen,1=visiting,2=done
            var map = blocks.ToDictionary(b => b.LocalId);

            void Visit(Block b)
            {
                if (state.TryGetValue(b.LocalId, out var s) && s == 2) return;
                if (s == 1) return; // cycle guard
                state[b.LocalId] = 1;
                foreach (var dep in b.Inputs.Where(p => p.Source != null)
                             .Select(p => p.Source!.RefLocalId)
                             .Where(x => blockIds.Contains(x))
                             .OrderBy(x => x))
                    Visit(map[dep]);
                state[b.LocalId] = 2;
                result.Add(b);
            }

            foreach (var b in blocks.OrderBy(b => b.LocalId)) Visit(b);
            return result;
        }
    }
}
