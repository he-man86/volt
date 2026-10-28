using System;
using System.Collections.Generic;
using Volt.Engine.Format.Network;
using Parallel = Volt.Engine.Format.Network.Parallel;

namespace Volt.Tests.Shared;

/// <summary>
/// THE SCOPE A MODEL'S TEXT IS READ BACK AGAINST, for a source that comes without a parsed VAR block (the TwinCAT
/// archives, the CODESYS reader doubles, test models): the names the body spells, the POUs it calls and its FB instances,
/// what the POU's declarations would say of each.
/// </summary>
internal static class NetworkModelScopes
{
    /// <summary>The declarations a vendor model's text is read back against: every name it spells as an operand,
    /// target or instance, the POUs it calls (its box types), and its FB instances with their types
    /// (<see cref="Instances"/>). Taken from the model
    /// because these sources (archives, test models, corpus bodies) come without a parsed VAR block — and every
    /// operand of a body the vendor holds IS a name in scope (a variable, a global, a member), which is what the
    /// reader's "a wire-shaped name in no scope" refusal relies on.</summary>
    /// <param name="signatures">The callees whose declaration the test states (what a push's scope reads from the project and
    /// the libraries): none where null, every callee then unstated (openspec network-output-member).</param>
    public static NetworkScope ScopeOf(NetworkBody body, NetworkScope? declared = null,
                                       IReadOnlyDictionary<string, CalleeSignature>? signatures = null)
    {
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var pous = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        void Words(string text) => names.UnionWith(NetworkSpelling.Words(text));
        void Walk(Node? n)
        {
            switch (n)
            {
                case Leaf l: Words(l.Operand.Text); break;
                case Box b:
                    Words(b.Type);
                    pous.Add(b.Type);   // a function or FB type is a POU in scope
                    if (b.Instance is { } i) Words(i.Text);
                    foreach (var o in b.Outputs) Words(o.Value.Text);
                    Walk(b.Enable);
                    foreach (var p in b.Inputs) Walk(p.Value);
                    break;
                case Assign a: foreach (var t in a.Targets) Words(t.Text); Walk(a.Value); break;
                case Demux d: Walk(d.Input); break;
                case Parallel p: Walk(p.Input); foreach (var br in p.Branches) Walk(br); break;
            }
        }
        foreach (var net in body.Networks) foreach (var t in net.Trees) Walk(t);
        return new NetworkScope(names, pous, Instances(body, declared), signatures: signatures);
    }

    /// <summary>What the scope holds of a model when no VARIABLE is declared: its POUs (box types) and its FB
    /// instances with their types — the facts the text needs to read a call back — and nothing else.</summary>
    public static NetworkScope CallablesOf(NetworkBody body, NetworkScope? declared = null)
    {
        var pous = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        void Walk(Node? n)
        {
            switch (n)
            {
                case Box b:
                    pous.Add(b.Type);
                    Walk(b.Enable);
                    foreach (var p in b.Inputs) Walk(p.Value);
                    break;
                case Assign a: Walk(a.Value); break;
                case Demux d: Walk(d.Input); break;
                case Parallel p: Walk(p.Input); foreach (var br in p.Branches) Walk(br); break;
            }
        }
        foreach (var net in body.Networks) foreach (var t in net.Trees) Walk(t);
        return new NetworkScope(Array.Empty<string>(), pous, Instances(body, declared));
    }

    /// <summary>A model's FB instances with their types — what the POU's declarations would say of each, and
    /// ONLY what they can say. An identifier is a name a declaration makes. A QUALIFIED path
    /// (<c>Mach1_AuxData.IEC_TIMERS.OffDelayLockDrives</c>) is one only when the declarations resolve it through a GVL
    /// and its structs — the push reads it against the same <c>NetworkScope.FromDeclarations</c> the pull wrote it
    /// with — so it is declared here exactly when <paramref name="declared"/>, the scope the body was read against,
    /// says so; a source with no declarations has no such answer and declares none. An array element or
    /// <c>SUPER^</c> (census 1.12) is no name at all. Declaring more than the declarations do would make the oracle
    /// pass a body the push path loses; declaring less refuses one it keeps.</summary>
    public static Dictionary<string, string> Instances(NetworkBody body, NetworkScope? declared = null)
    {
        var instances = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        void Walk(Node? n)
        {
            switch (n)
            {
                case Box b:
                    if (b.Instance is { } i
                        && (NetworkSpelling.Identifier.IsMatch(i.Text) || declared?.InstanceType(i.Text) is not null))
                        instances[i.Text] = b.Type;
                    Walk(b.Enable);
                    foreach (var p in b.Inputs) Walk(p.Value);
                    break;
                case Assign a: Walk(a.Value); break;
                case Demux d: Walk(d.Input); break;
                case Parallel p: Walk(p.Input); foreach (var br in p.Branches) Walk(br); break;
            }
        }
        foreach (var net in body.Networks) foreach (var t in net.Trees) Walk(t);
        return instances;
    }
}
