using System.Globalization;
using System.Text;

namespace Volt.Engine.Format.Network;

/// <summary>
/// THE HASH AN <c>%UNSUPPORTED</c> LINE CARRIES: 8 hex digits of the network as stored, so two networks shown as the same
/// shape are two lines, and an edited line pairs with no live network. FNV-1a over a structural walk of the trees — every
/// node kind and every fact the model holds of it — so the same stored network hashes alike on both vendors. A network
/// the vendor reader could not read at all (no trees) hashes its shape, so two of them under one header show the same
/// line; a push that deletes or moves one of the two is refused (<see cref="NetworkPairing.RefuseUnseenLoss"/>).
/// </summary>
public static class NetworkHash
{
    public static string Of(Network net)
    {
        var sb = new StringBuilder();
        if (net.Trees.Count == 0) sb.Append("unsupported:").Append(net.Unsupported);
        foreach (var t in net.Trees) Serialize(t, sb);
        uint h = 2166136261;
        foreach (var c in sb.ToString())
        {
            h ^= c;
            h *= 16777619;
        }
        return h.ToString("x8", CultureInfo.InvariantCulture);
    }

    private static void Serialize(Node? n, StringBuilder sb)
    {
        static void F(Flags? f, StringBuilder s) => s.Append(f is null ? "-" : $"{(f.Negated ? 1 : 0)}{(f.Set ? 1 : 0)}{(f.Reset ? 1 : 0)}{(f.Jump ? 1 : 0)}{(f.Return ? 1 : 0)}{(f.Rising ? 1 : 0)}{(f.Falling ? 1 : 0)}");
        static void O(Operand? o, StringBuilder s)
        {
            if (o is null) { s.Append("~"); return; }
            s.Append('<').Append(o.Text.Length).Append(':').Append(o.Text);
            F(o.Flags, s);
            s.Append('>');
        }
        switch (n)
        {
            case null: sb.Append('~'); return;
            case Leaf l: sb.Append("(L"); O(l.Operand, sb); F(l.Flags, sb); break;
            case Terminator t: sb.Append("(T"); F(t.Flags, sb); break;
            case Assign a:
                sb.Append("(A"); F(a.Flags, sb);
                foreach (var t in a.Targets) O(t, sb);
                Serialize(a.Value, sb);
                break;
            case Demux d: sb.Append("(D").Append(d.VarId); Serialize(d.Input, sb); break;
            case Parallel p:
                sb.Append("(P").Append((int)p.Mode);
                Serialize(p.Input, sb);
                foreach (var b in p.Branches) Serialize(b, sb);
                break;
            case Box b:
                sb.Append("(B<").Append(b.Type.Length).Append(':').Append(b.Type).Append('>');
                O(b.Instance, sb); F(b.Flags, sb); F(b.EnableFlags, sb);
                sb.Append(b.StCode is null ? "~" : "<" + b.StCode.Length + ":" + b.StCode + ">");
                Serialize(b.Enable, sb);
                foreach (var p in b.Inputs) { sb.Append('i').Append(p.Formal ?? "~").Append(';'); F(p.Flags, sb); Serialize(p.Value, sb); }
                foreach (var o in b.Outputs) { sb.Append('o').Append(o.Formal ?? "~").Append(';').Append(o.Slot?.ToString(CultureInfo.InvariantCulture) ?? "~"); O(o.Value, sb); }
                sb.Append('c').Append(b.ConnectedSlot?.ToString(CultureInfo.InvariantCulture) ?? "~")
                  .Append('e').Append(b.HasEnoOutput ? 1 : 0).Append('n').Append(b.MainOutputName ?? "~");
                break;
            default: sb.Append("(?").Append(n.GetType().Name); break;
        }
        sb.Append(')');
    }
}
