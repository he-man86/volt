using System.Collections.Generic;
using Volt.Engine.Format.Network;
using Parallel = Volt.Engine.Format.Network.Parallel;

namespace Volt.Tests.Shared;

/// <summary>
/// STRUCTURAL equality for <see cref="NetworkBody"/> models — the oracle's "model A equals model B". Test code:
/// only the oracle compares models, so it ships in no product (compiled into each suite that runs the oracle).
///
/// <para><b>Why this exists.</b> The model is records, but its members are <c>IReadOnlyList&lt;T&gt;</c>, and a
/// record compares a list by REFERENCE: two bodies built from the same vendor network are never <c>==</c>. v1
/// therefore compared rendered text only. Network text v2 adds a model oracle, <c>Read(Write(m)) ≅ m</c> over
/// every vendor-read fixture (openspec network-text-literal-nwl, task 2.1/2.2), because a text round trip can be a
/// fixed point and still have lost a fact: a writer arm that drops a flag the vendor reader filled writes the
/// same text, reads the same text back, and only the MODEL shows the flag is gone.</para>
///
/// <para><b>Strict, with no equivalences.</b> Every field of every node is compared, the v2 slot facts included,
/// and nothing is normalised: <c>Operand.Flags</c> null is not <see cref="Flags.None"/>, an absent formal is not
/// a default formal. The spec's one sanctioned equivalence — absent vs default <c>InputParams</c> names (task
/// 2.1, review 7.9) — is deliberately NOT built in: the 2026-09-26 census found no default formals to reconcile
/// (AND/OR/NOT carry <c>[]</c>, arithmetic/compare/MOVE only <c>['EN']</c>), and an equivalence added before a
/// fixture needs it is exactly the kind of default that hides a real loss.</para>
/// </summary>
public static class NetworkModelEquality
{
    /// <summary>Whether the two bodies are structurally equal.</summary>
    public static bool Equal(NetworkBody a, NetworkBody b) => FirstDifference(a, b) is null;

    /// <summary>The first place the two bodies differ, as a path plus both values (e.g.
    /// <c>Networks[2].Trees[0].Value.Inputs[1].Flags: … vs …</c>), or null when they are equal. A test asserts
    /// on this rather than on <see cref="Equal"/> so a failure names WHAT was lost, not just that something was.</summary>
    public static string? FirstDifference(NetworkBody a, NetworkBody b)
    {
        if (a.Language != b.Language) return Diff("Language", a.Language, b.Language);
        return Lists("Networks", a.Networks, b.Networks, NetworkDiff);
    }

    static string? NetworkDiff(string at, Network a, Network b)
    {
        if (a.Order != b.Order) return Diff(at + ".Order", a.Order, b.Order);
        if (a.Title != b.Title) return Diff(at + ".Title", a.Title, b.Title);
        if (a.Label != b.Label) return Diff(at + ".Label", a.Label, b.Label);
        if (a.Comment != b.Comment) return Diff(at + ".Comment", a.Comment, b.Comment);
        if (a.Disabled != b.Disabled) return Diff(at + ".Disabled", a.Disabled, b.Disabled);
        return Lists(at + ".Trees", a.Trees, b.Trees, NodeDiff);
    }

    static string? NodeDiff(string at, Node? a, Node? b)
    {
        if (a is null || b is null)
            return a is null && b is null ? null : Diff(at, Describe(a), Describe(b));
        if (a.GetType() != b.GetType()) return Diff(at, Describe(a), Describe(b));
        if (a.Flags != b.Flags) return Diff(at + ".Flags", a.Flags, b.Flags);

        switch (a, b)
        {
            case (Leaf x, Leaf y):
                return x.Operand == y.Operand ? null : Diff(at + ".Operand", x.Operand, y.Operand);

            case (Assign x, Assign y):
                return NodeDiff(at + ".Value", x.Value, y.Value)
                    ?? Lists(at + ".Targets", x.Targets, y.Targets, OperandDiff);

            case (Box x, Box y):
                if (x.Type != y.Type) return Diff(at + ".Type", x.Type, y.Type);
                if (x.Instance != y.Instance) return Diff(at + ".Instance", x.Instance, y.Instance);
                if (x.Kind != y.Kind) return Diff(at + ".Kind", x.Kind, y.Kind);
                if (x.StCode != y.StCode) return Diff(at + ".StCode", x.StCode, y.StCode);
                if (x.MainOutputIndex != y.MainOutputIndex)
                    return Diff(at + ".MainOutputIndex", x.MainOutputIndex, y.MainOutputIndex);
                if (x.ConnectedSlot != y.ConnectedSlot)
                    return Diff(at + ".ConnectedSlot", x.ConnectedSlot, y.ConnectedSlot);
                if (x.HasEnoOutput != y.HasEnoOutput)
                    return Diff(at + ".HasEnoOutput", x.HasEnoOutput, y.HasEnoOutput);
                if ((x.OutputTypes is null) != (y.OutputTypes is null))
                    return Diff(at + ".OutputTypes", Describe(x.OutputTypes), Describe(y.OutputTypes));
                return (x.OutputTypes is null ? null
                           : Lists(at + ".OutputTypes", x.OutputTypes, y.OutputTypes!, Scalar))
                    ?? NodeDiff(at + ".Enable", x.Enable, y.Enable)
                    ?? Lists(at + ".Inputs", x.Inputs, y.Inputs, InputDiff)
                    ?? Lists(at + ".Outputs", x.Outputs, y.Outputs, OutputDiff);

            case (Parallel x, Parallel y):
                if (x.Mode != y.Mode) return Diff(at + ".Mode", x.Mode, y.Mode);
                return NodeDiff(at + ".Input", x.Input, y.Input)
                    ?? Lists(at + ".Branches", x.Branches, y.Branches, NodeDiff);

            case (Terminator, Terminator):
                return null;

            case (Demux x, Demux y):
                if (x.VarId != y.VarId) return Diff(at + ".VarId", x.VarId, y.VarId);
                if (x.Type != y.Type) return Diff(at + ".Type", x.Type, y.Type);
                return NodeDiff(at + ".Input", x.Input, y.Input);

            default:
                // A new Node subclass must be taught here; comparing it by record equality would silently
                // compare its lists by reference and call every pair different (or, with no lists, hide nothing
                // yet and everything later).
                throw new System.NotSupportedException($"NetworkModelEquality does not know node {a.GetType().Name}");
        }
    }

    static string? InputDiff(string at, Input a, Input b)
    {
        if (a.Formal != b.Formal) return Diff(at + ".Formal", a.Formal, b.Formal);
        if (a.Flags != b.Flags) return Diff(at + ".Flags", a.Flags, b.Flags);
        return NodeDiff(at + ".Value", a.Value, b.Value);
    }

    // Output and Operand hold no list, so record equality IS structural for them; each is compared whole.
    static string? OutputDiff(string at, Output a, Output b) => a == b ? null : Diff(at, a, b);
    static string? OperandDiff(string at, Operand a, Operand b) => a == b ? null : Diff(at, a, b);
    static string? Scalar(string at, string? a, string? b) => a == b ? null : Diff(at, a, b);

    static string? Lists<T>(string at, IReadOnlyList<T> a, IReadOnlyList<T> b, System.Func<string, T, T, string?> item)
    {
        if (a.Count != b.Count) return Diff(at + ".Count", a.Count, b.Count);
        for (int i = 0; i < a.Count; i++)
            if (item($"{at}[{i}]", a[i], b[i]) is { } d) return d;
        return null;
    }

    static string Describe(object? o) => o switch
    {
        null => "null",
        Node n => n.GetType().Name,
        IReadOnlyList<string?> l => $"[{string.Join(", ", l)}]",
        _ => o.ToString() ?? "",
    };

    static string Diff(string at, object? a, object? b) => $"{at}: {a ?? "null"} vs {b ?? "null"}";
}
