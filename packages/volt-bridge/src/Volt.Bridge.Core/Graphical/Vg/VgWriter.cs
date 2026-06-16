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
            var leaves = net.Nodes.OfType<InVar>().OrderBy(n => n.LocalId).ToList();
            var blocks = net.Nodes.OfType<Block>().ToList();
            var ordered = TopoOrder(blocks, byId);

            // Name EVERY node that needs a synthetic name: inVariable leaves i1,i2… (localId order);
            // operator/function results g1,g2… (topo order); FB instances keep their real name.
            // Synthetic names skip any real FB-instance name (the only other identifiers in the
            // resolvable namespace), so they never collide — round-trip stays identical even if a POU
            // has an instance named i1/g1.
            var reserved = new HashSet<string>(
                blocks.Where(b => !IsOperatorOrFunction(b) && !string.IsNullOrEmpty(b.InstanceName))
                      .Select(b => b.InstanceName!), StringComparer.Ordinal);
            var names = new Dictionary<long, string>();
            int li = 0, g = 0;
            foreach (var iv in leaves) names[iv.LocalId] = Mint("i", ref li, reserved);
            foreach (var b in ordered)
                names[b.LocalId] = (!IsOperatorOrFunction(b) && !string.IsNullOrEmpty(b.InstanceName))
                    ? b.InstanceName! : Mint("g", ref g, reserved);

            // Per-network VAR_TEMP declaring the synthetic temps (leaves, then results) with
            // writer-owned types — authoritative when the XML supplied one (OutputParamTypes /
            // InputParamTypes), else BOOL. Operator operand types are absent in the XML → BOOL.
            // Omitted entirely when a network has no temps (control-flow-only / empty).
            var temps = new List<(string Name, string Type)>();
            foreach (var iv in leaves) temps.Add((names[iv.LocalId], LeafType(iv, blocks)));
            foreach (var b in ordered)
                if (IsOperatorOrFunction(b)) temps.Add((names[b.LocalId], b.OutputTypes?.FirstOrDefault() ?? "BOOL"));
            if (temps.Count > 0)
            {
                sb.Append("  VAR_TEMP\n");
                foreach (var (name, type) in temps)
                    sb.Append("    ").Append(name).Append(" : ").Append(type).Append(";\n");
                sb.Append("  END_VAR\n");
            }

            // Leaf statements: one per inVariable, RHS its opaque expression (+ its own modifiers).
            foreach (var iv in leaves)
                sb.Append("  ").Append(names[iv.LocalId]).Append(" := ")
                  .Append(ApplyMods(iv.Expression, iv.Mods)).Append(";\n");

            foreach (var b in ordered) EmitBlock(sb, b, byId, names);

            foreach (var ov in net.Nodes.OfType<OutVar>())
                sb.Append("  ").Append(ov.Expression).Append(" := ")
                  .Append(ApplyMods(RenderConn(ov.Source, byId, names), ov.Mods)).Append(";\n");

            // Control flow (valid CODESYS ST): a label is "name:"; a jump/return is bare when
            // unconditional, else wrapped in IF … THEN … END_IF (its condition is a named wire).
            foreach (var node in net.Nodes)
                switch (node)
                {
                    case Label lb: sb.Append("  ").Append(lb.Name).Append(":\n"); break;
                    case Jump jp: EmitGoto(sb, "JMP " + jp.Target, jp.Condition, jp.Mods, byId, names); break;
                    case Return rt: EmitGoto(sb, "RETURN", rt.Condition, rt.Mods, byId, names); break;
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

        /// <summary>The declared type for a leaf temp: the type of the (first) block input pin it
        /// feeds, from the XML's InputParamTypes. Operator operands have none → BOOL.</summary>
        private static string LeafType(InVar iv, List<Block> blocks)
        {
            foreach (var b in blocks)
                foreach (var p in b.Inputs)
                    if (p.Source?.RefLocalId == iv.LocalId && !string.IsNullOrEmpty(p.Type))
                        return p.Type!;
            return "BOOL";
        }

        private static void EmitGoto(StringBuilder sb, string action, Conn? cond, Mods mods,
            IReadOnlyDictionary<long, GraphNode> byId, IReadOnlyDictionary<long, string> names)
        {
            if (cond is null) { sb.Append("  ").Append(action).Append(";\n"); return; }
            var c = ApplyMods(RenderConn(cond, byId, names), mods);   // NOT cond when negated
            sb.Append("  IF ").Append(c).Append(" THEN ").Append(action).Append("; END_IF\n");
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

        private static void EmitBlock(StringBuilder sb, Block b,
            IReadOnlyDictionary<long, GraphNode> byId, IReadOnlyDictionary<long, string> names)
        {
            var args = b.Inputs.Where(p => p.Source != null)
                .Select(p => RenderPinArg(p, byId, names)).ToList();

            if (FbdOperators.TypeToSymbol.TryGetValue(b.TypeName, out var op))   // operator → infix
            {
                sb.Append("  ").Append(names[b.LocalId]).Append(" := (")
                  .Append(string.Join($" {op} ", args.Select(a => a.Value))).Append(");\n");
            }
            else if (string.IsNullOrEmpty(b.InstanceName))               // stateless function call
            {
                sb.Append("  ").Append(names[b.LocalId]).Append(" := ").Append(b.TypeName)
                  .Append('(').Append(string.Join(", ", args.Select(a => a.Value))).Append(");\n");
            }
            else                                                          // FB instance call: pin := arg
            {
                sb.Append("  ").Append(b.InstanceName).Append('(')
                  .Append(string.Join(", ", args.Select(a => a.Pin + " := " + a.Value))).Append(");\n");
            }
        }

        private static (string Pin, string Value) RenderPinArg(Pin p,
            IReadOnlyDictionary<long, GraphNode> byId, IReadOnlyDictionary<long, string> names)
            => (p.FormalParameter, ApplyMods(RenderConn(p.Source, byId, names), p.Mods));

        /// <summary>A wire → text: every producer is referenced by its NAME — a leaf inVariable by its
        /// <c>i*</c> temp, a block by its <c>g*</c>/instance name (and <c>.Pin</c> for a selected
        /// FB output). Operands are never inlined, so the text stays isomorphic to the node graph.</summary>
        private static string RenderConn(Conn? c, IReadOnlyDictionary<long, GraphNode> byId,
            IReadOnlyDictionary<long, string> names)
        {
            if (c == null) return "";
            if (!byId.TryGetValue(c.RefLocalId, out var src)) return "";
            switch (src)
            {
                case InVar iv: return names.TryGetValue(iv.LocalId, out var inm) ? inm : iv.Expression;
                case Block b:
                    var nm = names[b.LocalId];
                    // An FB instance output is real ST member access (inst.Q). An operator/function
                    // result is a single anonymous value named gN — `.Out1` on it is NOT valid ST, so
                    // reference the value directly.
                    return (c.FormalParameter != null && !IsOperatorOrFunction(b)) ? nm + "." + c.FormalParameter : nm;
                default: return "";
            }
        }

        private static bool IsOperatorOrFunction(Block b)
            => FbdOperators.TypeToSymbol.ContainsKey(b.TypeName) || string.IsNullOrEmpty(b.InstanceName);

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
