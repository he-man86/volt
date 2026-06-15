using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace VoltBridge.Core.Fbd.Vg
{
    /// <summary>
    /// Renders a <see cref="GraphBody"/> to VG text — a canonical, constrained Structured-Text-LIKE
    /// dialect: one operation per statement, every gate/FB result named, leaf operands inline. It
    /// reads as ST and the ST LSP loads it, but pin modifiers are VG EXTENSIONS, not standard ST:
    /// <c>NOT operand</c> (negation — this one IS valid ST), and the suffixes <c>RISING</c>/
    /// <c>FALLING</c> (edge) and <c>SET</c>/<c>RESET</c> (storage), which keep the modifier visible
    /// right at the pin rather than synthesizing hidden R_TRIG/SR instances. Round-trippable
    /// (<c>VgParser</c> reverses it); emission is deterministic so VG→graph→VG is a fixed point.
    /// </summary>
    public static class VgWriter
    {
        // Operator box types render infix; everything else is an FB call or function call.
        // Canonical operator table lives in FbdOperators (shared with the transpiler + parser).
        public static string Write(GraphBody body)
        {
            var sb = new StringBuilder();
            sb.Append("%LANG ").Append(body.Language).Append('\n');
            foreach (var net in body.Networks) WriteNetwork(sb, net);
            return sb.ToString();
        }

        private static void WriteNetwork(StringBuilder sb, GraphNetwork net)
        {
            sb.Append("NETWORK");
            if (!string.IsNullOrEmpty(net.Label)) sb.Append(" \"").Append(net.Label).Append('"');
            if (net.Disabled) sb.Append(" DISABLED");
            sb.Append('\n');
            if (!string.IsNullOrEmpty(net.Comment))
                foreach (var line in net.Comment!.Replace("\r", "").Split('\n'))
                    sb.Append("  // ").Append(line).Append('\n');

            var byId = net.Nodes.ToDictionary(n => n.LocalId);
            var blocks = net.Nodes.OfType<Block>().ToList();
            var ordered = TopoOrder(blocks, byId);

            // Name each block's output: FB instance keeps its name; operators/functions get g1, g2…
            var names = new Dictionary<long, string>();
            int g = 0;
            foreach (var b in ordered)
                names[b.LocalId] = (!IsOperatorOrFunction(b) && !string.IsNullOrEmpty(b.InstanceName))
                    ? b.InstanceName! : "g" + (++g);

            foreach (var b in ordered) EmitBlock(sb, b, byId, names);

            foreach (var ov in net.Nodes.OfType<OutVar>())
                sb.Append("  ").Append(ov.Expression).Append(" := ")
                  .Append(ApplyMods(RenderConn(ov.Source, byId, names), ov.Mods)).Append(";\n");

            // Control flow (valid CODESYS ST): a label is "name:"; a jump/return is bare when
            // unconditional, else wrapped in IF … THEN … END_IF (its condition is a wire).
            foreach (var node in net.Nodes)
                switch (node)
                {
                    case Label lb: sb.Append("  ").Append(lb.Name).Append(":\n"); break;
                    case Jump jp: EmitGoto(sb, "JMP " + jp.Target, jp.Condition, jp.Mods, byId, names); break;
                    case Return rt: EmitGoto(sb, "RETURN", rt.Condition, rt.Mods, byId, names); break;
                }
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

        /// <summary>A wire → text: a leaf inVariable inlines its expression; a block reference uses
        /// the block's name (and <c>.Pin</c> for a selected output).</summary>
        private static string RenderConn(Conn? c, IReadOnlyDictionary<long, GraphNode> byId,
            IReadOnlyDictionary<long, string> names)
        {
            if (c == null) return "";
            if (!byId.TryGetValue(c.RefLocalId, out var src)) return "";
            switch (src)
            {
                case InVar iv: return iv.Expression;
                case Block b:
                    var nm = names[b.LocalId];
                    return c.FormalParameter != null ? nm + "." + c.FormalParameter : nm;
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
