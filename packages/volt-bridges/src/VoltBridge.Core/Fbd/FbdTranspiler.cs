using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace VoltBridge.Core.Fbd;

/// <summary>
/// Renders a vendor-neutral <see cref="FbdBody"/> to Structured Text — the single,
/// shared FBD/LD→ST transpiler both bridges use, so the same network yields identical
/// ST regardless of vendor. Validated against CODESYS's own
/// <c>GetImplementationSnippet()</c> rendering as the correctness oracle.
///
/// Convention (matching CODESYS): an FB box renders as a call carrying only its INPUTS,
/// followed by one assignment per connected OUTPUT:
///   <code>
///   inst(in1 := expr, in2 := expr);
///   outTarget := inst.outName;
///   </code>
/// Operators (OR/AND/ADD/…) render infix and parenthesised; functions render
/// functional (<c>NAME(a, b)</c>). Pin NAMES come from the <see cref="PinResolver"/>
/// (each box type's interface) — the model itself is positional.
/// </summary>
public static class FbdTranspiler
{
    /// <summary>Resolves a box type's formal parameter names (input pin order, output
    /// pin order). Return null for operators / unknown types (rendered positionally).</summary>
    public delegate (IReadOnlyList<string> Inputs, IReadOnlyList<string> Outputs)? PinResolver(string boxType);

    public static string ToSt(FbdBody body, PinResolver resolvePins)
    {
        var sb = new StringBuilder();
        foreach (var net in body.Networks)
        {
            if (net.Disabled) continue;
            foreach (var box in net.Boxes)
                EmitStatement(sb, box, resolvePins);
        }
        return sb.ToString();
    }

    private static void EmitStatement(StringBuilder sb, FbdBox box, PinResolver resolve)
    {
        var pins = resolve(box.Type);

        // FB instance: a call with named inputs, then one assignment per wired output.
        if (box.Instance is not null)
        {
            var inNames = pins?.Inputs;
            var args = new List<string>();
            for (var i = 0; i < box.Inputs.Count; i++)
            {
                if (IsUnconnected(box.Inputs[i])) continue;
                var name = inNames is not null && i < inNames.Count ? inNames[i] : $"i{i}";
                args.Add($"{name} := {RenderSource(box.Inputs[i], resolve)}");
            }
            sb.Append(box.Instance).Append('(').Append(string.Join(", ", args)).Append(");\n");

            var outNames = pins?.Outputs;
            for (var i = 0; i < box.Outputs.Count; i++)
            {
                if (string.IsNullOrEmpty(box.Outputs[i])) continue;
                var name = outNames is not null && i < outNames.Count ? outNames[i] : $"o{i}";
                sb.Append(box.Outputs[i]).Append(" := ").Append(box.Instance).Append('.').Append(name).Append(";\n");
            }
            return;
        }

        // A function/operator at network top level → assign its value to the wired output
        // (e.g. y := (a OR b);), or a bare expression statement if nothing is wired.
        var expr = RenderBox(box, resolve);
        var target = box.Outputs.FirstOrDefault(o => !string.IsNullOrEmpty(o));
        sb.Append(string.IsNullOrEmpty(target) ? expr : $"{target} := {expr}").Append(";\n");
    }

    private static string RenderSource(FbdSource src, PinResolver resolve) => src switch
    {
        FbdOperand o => o.Text,
        FbdNestedBox n => RenderBox(n.Box, resolve),
        _ => "",
    };

    private static string RenderBox(FbdBox box, PinResolver resolve)
    {
        var operands = box.Inputs.Where(s => !IsUnconnected(s)).Select(s => RenderSource(s, resolve)).ToList();

        // Operator → infix, parenthesised:  (a OR b OR c)
        if (Operators.TryGetValue(box.Type.ToUpperInvariant(), out var op))
            return "(" + string.Join($" {op} ", operands) + ")";

        // Function → functional:  NAME(a, b)
        return $"{box.Type}({string.Join(", ", operands)})";
    }

    private static bool IsUnconnected(FbdSource s) => s is FbdOperand o && string.IsNullOrEmpty(o.Text);

    private static readonly Dictionary<string, string> Operators = new()
    {
        ["OR"] = "OR", ["AND"] = "AND", ["XOR"] = "XOR",
        ["ADD"] = "+", ["SUB"] = "-", ["MUL"] = "*", ["DIV"] = "/", ["MOD"] = "MOD",
        ["GT"] = ">", ["LT"] = "<", ["GE"] = ">=", ["LE"] = "<=", ["EQ"] = "=", ["NE"] = "<>",
    };
}
