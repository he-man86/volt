using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace VoltBridge.Core;

public static class BodyTranspiler
{
    public static TranspileResult TranspileGraphicalBodyToSt(string bodyXml, string bodyLanguage)
    {
        if (bodyLanguage is not ("FBD" or "LD"))
        {
            var placeholder = bodyLanguage switch
            {
                "SFC" => "(* Graphical SFC body — SFC transpiler not yet implemented. *)\n",
                "CFC" => "(* Graphical CFC body — CFC transpiler not yet implemented. *)\n",
                _ => "(* Graphical body — transpiler not yet ported to C#. *)\n",
            };
            return new TranspileResult(true, placeholder, new List<string>());
        }

        var networks = SplitIntoNetworks(bodyXml, bodyLanguage);
        var lines = new List<string>();
        var tempDeclarations = new List<string>();

        for (var i = 0; i < networks.Count; i++)
        {
            var network = networks[i];
            var nodes = ParseNodes(network.Inner);
            if (nodes.Count == 0) continue;

            var validation = ValidateNetwork(nodes);
            if (validation is not null)
                return new TranspileResult(false, "", new List<string>(), $"network {i + 1}: {validation}");

            var networkResult = TranspileNetwork(nodes, bodyLanguage);
            if (!networkResult.Ok)
                return new TranspileResult(false, "", new List<string>(), $"network {i + 1}: {networkResult.Reason}");

            if (networks.Count > 1)
            {
                var header = network.Label is not null && network.Label.Length > 0
                    ? $"(* Network {i + 1}: {network.Label} *)"
                    : $"(* Network {i + 1} *)";
                lines.Add(header);
            }
            lines.AddRange(networkResult.Lines);
            tempDeclarations.AddRange(networkResult.TempDeclarations);
            if (i < networks.Count - 1) lines.Add("");
        }

        return new TranspileResult(true,
            lines.Count == 0 ? "" : string.Join("\n", lines) + "\n",
            tempDeclarations);
    }

    public static string MaterializeGraphicalPouAsSt(string name, string sourceText, string bodyXml, string bodyLanguage)
    {
        var cleaned = StripVendorMarkup(bodyXml);
        var transpiled = TranspileGraphicalBodyToSt(cleaned, bodyLanguage);
        if (!transpiled.Ok)
        {
            throw new InvalidOperationException(
                $"transpile {name}: {transpiled.ErrorReason} — cannot produce ST. " +
                "Either restructure the body in the IDE so it transpiles, or extend " +
                "packages/volt-bridges/src/VoltBridge.Core/BodyTranspiler.cs to handle this pattern.");
        }
        return SpliceTranspiledBody(sourceText, transpiled.St, transpiled.TempDeclarations);
    }

    private static string SpliceTranspiledBody(string declaration, string body, List<string> tempDeclarations)
    {
        var endRe = new Regex(
            @"^END_(?:PROGRAM|FUNCTION_BLOCK|FUNCTION)\b[^\n]*\n?",
            RegexOptions.Multiline);
        var endMatch = endRe.Match(declaration);
        if (!endMatch.Success)
            return declaration + "\n" + body;

        var prefix = declaration.Substring(0, endMatch.Index);
        var endLine = endMatch.Value.Trim();
        var suffix = declaration.Substring(endMatch.Index + endMatch.Length).Trim();

        var tempSection = tempDeclarations.Count == 0
            ? ""
            : "\nVAR_TEMP\n" + string.Join("\n", tempDeclarations) + "\nEND_VAR\n";

        var bodyBlock = body.Length == 0 ? "" : "\n" + body.Trim() + "\n";
        var afterBlock = suffix.Length == 0 ? "" : "\n" + suffix + "\n";

        return prefix.TrimEnd() + "\n" + tempSection + bodyBlock + "\n" + endLine + "\n" + afterBlock;
    }

    // ── Data structures ──────────────────────────────────────────────

    private enum NodeKind
    {
        InVariable,
        OutVariable,
        InOutVariable,
        Block,
        LeftPowerRail,
        RightPowerRail,
        Contact,
        Coil,
        Label,
        Jump,
        Return,
        Comment,
    }

    private sealed class Edge
    {
        public string FromLocalId { get; }
        public string? FromPort { get; }
        public Edge(string fromLocalId, string? fromPort = null)
        {
            FromLocalId = fromLocalId;
            FromPort = fromPort;
        }
    }

    private sealed class Node
    {
        public string LocalId { get; }
        public NodeKind Kind { get; }
        public string? TypeName { get; }
        public string? InstanceName { get; }
        public string? Expression { get; }
        public bool Negated { get; }
        public string? EdgeAttribute { get; }
        public string? Storage { get; }
        public Dictionary<string, Edge> Incoming { get; }
        public List<string> OutputPorts { get; }

        public Node(string localId, NodeKind kind, string? typeName, string? instanceName,
            string? expression, bool negated, string? edgeAttribute, string? storage,
            Dictionary<string, Edge> incoming, List<string> outputPorts)
        {
            LocalId = localId;
            Kind = kind;
            TypeName = typeName;
            InstanceName = instanceName;
            Expression = expression;
            Negated = negated;
            EdgeAttribute = edgeAttribute;
            Storage = storage;
            Incoming = incoming;
            OutputPorts = outputPorts;
        }
    }

    private sealed class RawNetwork
    {
        public string Inner { get; }
        public string? Label { get; }
        public RawNetwork(string inner, string? label = null)
        {
            Inner = inner;
            Label = label;
        }
    }

    private sealed class NetworkResult
    {
        public bool Ok { get; }
        public List<string> Lines { get; }
        public List<string> TempDeclarations { get; }
        public string? Reason { get; }
        private NetworkResult(bool ok, List<string> lines, List<string> tempDeclarations, string? reason)
        {
            Ok = ok;
            Lines = lines;
            TempDeclarations = tempDeclarations;
            Reason = reason;
        }
        public static NetworkResult Success(List<string> lines, List<string> tempDecls) =>
            new(true, lines, tempDecls, null);
        public static NetworkResult Failure(string reason) =>
            new(false, new List<string>(), new List<string>(), reason);
    }

    private sealed class LdContext
    {
        public Dictionary<string, Node> ById { get; }
        public HashSet<string> CycleGuard { get; }
        public List<string> TempDeclarations { get; }
        public List<string> RungPrelude { get; set; }
        public HashSet<string> EmittedBlockCalls { get; }

        public LdContext(Dictionary<string, Node> byId)
        {
            ById = byId;
            CycleGuard = new HashSet<string>();
            TempDeclarations = new List<string>();
            RungPrelude = new List<string>();
            EmittedBlockCalls = new HashSet<string>();
        }
    }

    // ── Constants ─────────────────────────────────────────────────────

    private static readonly string[] RenderableKinds =
    {
        "inVariable", "outVariable", "inOutVariable", "block",
        "leftPowerRail", "rightPowerRail", "contact", "coil",
        "label", "jump", "return", "comment",
    };

    private static readonly Dictionary<string, string> InfixOperators = new()
    {
        ["AND"] = "AND", ["OR"] = "OR", ["XOR"] = "XOR",
        ["ADD"] = "+", ["SUB"] = "-", ["MUL"] = "*", ["DIV"] = "/",
        ["MOD"] = "MOD",
        ["GT"] = ">", ["LT"] = "<", ["GE"] = ">=", ["LE"] = "<=",
        ["EQ"] = "=", ["NE"] = "<>",
    };

    private static readonly Dictionary<string, string> UnaryOperators = new()
    {
        ["NOT"] = "NOT", ["NEG"] = "-",
    };

    private static readonly HashSet<string> FunctionOperators = new()
    {
        "SEL", "MUX", "MIN", "MAX", "LIMIT",
        "SHL", "SHR", "ROL", "ROR",
        "ABS", "SQRT", "LN", "LOG", "EXP",
        "SIN", "COS", "TAN", "ASIN", "ACOS", "ATAN",
    };

    private static readonly HashSet<string> PassthroughOperators = new() { "MOVE" };

    private static readonly Regex AttrPattern =
        new(@"([A-Za-z_][\w.-]*)\s*=\s*""([^""]*)""", RegexOptions.Compiled);

    // ── XML / network parsing ─────────────────────────────────────────

    private static string? ExtractLanguageRoot(string bodyXml, string bodyLanguage)
    {
        var re = new Regex(
            $@"<\s*(?:[A-Za-z_][\w.-]*:)?{bodyLanguage}\b[^>]*>([\s\S]*?)</\s*(?:[A-Za-z_][\w.-]*:)?{bodyLanguage}\s*>");
        var m = re.Match(bodyXml);
        return m.Success ? m.Groups[1].Value : null;
    }

    private static List<RawNetwork> SplitIntoNetworks(string bodyXml, string bodyLanguage)
    {
        var root = ExtractLanguageRoot(bodyXml, bodyLanguage);
        if (root is null) return new List<RawNetwork>();

        var networkRe = new Regex(
            @"<\s*(?:[A-Za-z_][\w.-]*:)?network\b([^>]*)>([\s\S]*?)</\s*(?:[A-Za-z_][\w.-]*:)?network\s*>");
        var matches = networkRe.Matches(root);
        if (matches.Count > 0)
        {
            var networks = new List<RawNetwork>(matches.Count);
            foreach (Match m in matches)
            {
                var attrs = ParseAttrs(m.Groups[1].Value);
                var label = attrs.TryGetValue("label", out var l) ? l : null;
                networks.Add(new RawNetwork(m.Groups[2].Value, label));
            }
            return networks;
        }

        return new List<RawNetwork> { new(root) };
    }

    private static List<Node> ParseNodes(string networkInner)
    {
        var kinds = string.Join("|", RenderableKinds);
        var elementRe = new Regex(
            $@"<\s*(?:[A-Za-z_][\w.-]*:)?({kinds})\b([^>]*)(?:/>|>([\s\S]*?)</\s*(?:[A-Za-z_][\w.-]*:)?\1\s*>)");
        var nodes = new List<Node>();
        foreach (Match m in elementRe.Matches(networkInner))
        {
            var kindStr = m.Groups[1].Value;
            var kind = MapNodeKind(kindStr);
            var attrs = ParseAttrs(m.Groups[2].Value);
            var inner = m.Groups[3].Success ? m.Groups[3].Value : "";
            var localId = attrs.TryGetValue("localId", out var lid) ? lid : null;
            if (string.IsNullOrEmpty(localId)) continue;
            nodes.Add(BuildNode(kind, attrs, inner, localId));
        }
        return nodes;
    }

    private static NodeKind MapNodeKind(string kind)
    {
        return kind switch
        {
            "inVariable" => NodeKind.InVariable,
            "outVariable" => NodeKind.OutVariable,
            "inOutVariable" => NodeKind.InOutVariable,
            "block" => NodeKind.Block,
            "leftPowerRail" => NodeKind.LeftPowerRail,
            "rightPowerRail" => NodeKind.RightPowerRail,
            "contact" => NodeKind.Contact,
            "coil" => NodeKind.Coil,
            "label" => NodeKind.Label,
            "jump" => NodeKind.Jump,
            "return" => NodeKind.Return,
            "comment" => NodeKind.Comment,
            _ => NodeKind.Comment,
        };
    }

    private static Node BuildNode(NodeKind kind, Dictionary<string, string> attrs,
        string inner, string localId)
    {
        var expression = kind switch
        {
            NodeKind.InVariable or NodeKind.OutVariable or NodeKind.InOutVariable
                => ExtractInnerText(inner, "expression"),
            NodeKind.Contact or NodeKind.Coil
                => ExtractInnerText(inner, "variable"),
            NodeKind.Jump or NodeKind.Label
                => attrs.TryGetValue("label", out var lbl) ? lbl : null,
            _ => null,
        };

        var negatedRaw = attrs.TryGetValue("negated", out var neg) && (neg == "true" || neg == "1");
        var edgeAttribute = attrs.TryGetValue("edge", out var edgeVal) &&
                            (edgeVal == "rising" || edgeVal == "falling") ? edgeVal : null;
        var storage = attrs.TryGetValue("storage", out var stor) &&
                      (stor == "set" || stor == "reset") ? stor : null;
        var incoming = CollectIncoming(kind, inner);
        var outputPorts = CollectOutputPorts(kind, inner);

        return new Node(localId, kind,
            attrs.TryGetValue("typeName", out var tn) ? tn : null,
            attrs.TryGetValue("instanceName", out var in_) ? in_ : null,
            expression, negatedRaw, edgeAttribute, storage, incoming, outputPorts);
    }

    private static string? ExtractInnerText(string inner, string tag)
    {
        var re = new Regex(
            $@"<\s*(?:[A-Za-z_][\w.-]*:)?{tag}\b[^>]*>([\s\S]*?)</\s*(?:[A-Za-z_][\w.-]*:)?{tag}\s*>");
        var m = re.Match(inner);
        return m.Success ? m.Groups[1].Value.Trim() : null;
    }

    private static Dictionary<string, Edge> CollectIncoming(NodeKind kind, string inner)
    {
        var result = new Dictionary<string, Edge>();
        if (kind == NodeKind.Block)
        {
            var variableBlockRe = new Regex(
                @"<\s*(?:[A-Za-z_][\w.-]*:)?variable\b([^>]*)>([\s\S]*?)</\s*(?:[A-Za-z_][\w.-]*:)?variable\s*>");
            var inputRegion = ExtractInnerText(inner, "inputVariables") ?? "";
            var inOutRegion = ExtractInnerText(inner, "inOutVariables") ?? "";
            var combined = inputRegion + "\n" + inOutRegion;
            foreach (Match m in variableBlockRe.Matches(combined))
            {
                var attrs = ParseAttrs(m.Groups[1].Value);
                var formal = attrs.TryGetValue("formalParameter", out var fp) ? fp : "";
                var cpIn = ExtractInnerText(m.Groups[2].Value, "connectionPointIn") ?? "";
                var edge = ParseFirstConnection(cpIn);
                if (edge is not null) result[formal] = edge;
            }
            return result;
        }

        var cpInSingle = ExtractInnerText(inner, "connectionPointIn");
        if (cpInSingle is not null)
        {
            var edge = ParseFirstConnection(cpInSingle);
            if (edge is not null) result[""] = edge;
        }
        return result;
    }

    private static List<string> CollectOutputPorts(NodeKind kind, string inner)
    {
        if (kind != NodeKind.Block) return new List<string> { "" };
        var outputRegion = ExtractInnerText(inner, "outputVariables") ?? "";
        var variableBlockRe = new Regex(
            @"<\s*(?:[A-Za-z_][\w.-]*:)?variable\b([^>]*)>([\s\S]*?)</\s*(?:[A-Za-z_][\w.-]*:)?variable\s*>");
        var ports = new List<string>();
        foreach (Match m in variableBlockRe.Matches(outputRegion))
        {
            var attrs = ParseAttrs(m.Groups[1].Value);
            var formal = attrs.TryGetValue("formalParameter", out var fp) ? fp : null;
            if (!string.IsNullOrEmpty(formal)) ports.Add(formal);
        }
        return ports;
    }

    private static Edge? ParseFirstConnection(string connectionPointInner)
    {
        var re = new Regex(@"<\s*(?:[A-Za-z_][\w.-]*:)?connection\b([^>]*?)/?\s*>");
        var m = re.Match(connectionPointInner);
        if (!m.Success) return null;
        var attrs = ParseAttrs(m.Groups[1].Value);
        var fromLocalId = attrs.TryGetValue("refLocalId", out var rli) ? rli : null;
        if (fromLocalId is null) return null;
        var fromPort = attrs.TryGetValue("formalParameter", out var fp) ? fp : null;
        return new Edge(fromLocalId, fromPort);
    }

    private static Dictionary<string, string> ParseAttrs(string attrsText)
    {
        var result = new Dictionary<string, string>();
        foreach (Match m in AttrPattern.Matches(attrsText))
            result[m.Groups[1].Value] = m.Groups[2].Value;
        return result;
    }

    // ── Validation ────────────────────────────────────────────────────

    private static string? ValidateNetwork(List<Node> nodes)
    {
        var seen = new HashSet<string>();
        foreach (var n in nodes)
        {
            if (!seen.Add(n.LocalId))
                return $"duplicate localId '{n.LocalId}' (each node must be unique)";
        }

        var byId = new HashSet<string>();
        foreach (var n in nodes) byId.Add(n.LocalId);

        foreach (var n in nodes)
        {
            foreach (var kvp in n.Incoming)
            {
                var port = kvp.Key;
                var edge = kvp.Value;
                if (!byId.Contains(edge.FromLocalId))
                {
                    var portHint = port.Length == 0 ? "" : $" (port '{port}')";
                    return $"dangling connection from localId '{edge.FromLocalId}' to '{n.LocalId}'{portHint} — no such node in this network";
                }
            }
        }

        var labels = new HashSet<string>();
        foreach (var n in nodes)
        {
            if (n.Kind == NodeKind.Label && n.Expression is not null)
                labels.Add(n.Expression);
        }

        foreach (var n in nodes)
        {
            if (n.Kind == NodeKind.Jump)
            {
                var target = n.Expression;
                if (string.IsNullOrEmpty(target))
                    return $"jump node '{n.LocalId}' has no target label";
                if (!labels.Contains(target!))
                    return $"jump to undefined label '{target}'";
            }
        }

        return null;
    }

    // ── Network transpilation dispatch ────────────────────────────────

    private static NetworkResult TranspileNetwork(List<Node> nodes, string bodyLanguage)
    {
        var byId = new Dictionary<string, Node>();
        foreach (var n in nodes) byId[n.LocalId] = n;
        return bodyLanguage == "LD" ? TranspileLD(nodes, byId) : TranspileFBD(nodes, byId);
    }

    // ── FBD transpilation ─────────────────────────────────────────────

    private static NetworkResult TranspileFBD(List<Node> nodes, Dictionary<string, Node> byId)
    {
        var lines = new List<string>();
        var renderedCalls = new HashSet<string>();
        var cycleGuard = new HashSet<string>();

        var callsForInstances = nodes
            .Where(n => n.Kind == NodeKind.Block && !string.IsNullOrEmpty(n.InstanceName))
            .OrderBy(n => n.LocalId, StringComparer.Ordinal)
            .ToList();

        foreach (var block in callsForInstances)
        {
            var callLine = RenderFbInstanceCall(block, byId, cycleGuard);
            if (callLine is null)
                return NetworkResult.Failure($"cannot transpile FB call '{block.InstanceName}'");
            if (renderedCalls.Add(block.LocalId))
                lines.Add(callLine);
        }

        var outVars = nodes
            .Where(n => n.Kind == NodeKind.OutVariable)
            .OrderBy(n => n.LocalId, StringComparer.Ordinal)
            .ToList();

        foreach (var outVar in outVars)
        {
            if (string.IsNullOrEmpty(outVar.Expression))
                return NetworkResult.Failure($"outVariable {outVar.LocalId} missing <expression>");

            var incoming = outVar.Incoming.TryGetValue("", out var inc) ? inc : null;
            if (incoming is null)
                return NetworkResult.Failure($"outVariable '{outVar.Expression}' has no incoming connection");

            var rhs = ExpressionForEdge(incoming, byId, cycleGuard);
            if (rhs is null)
                return NetworkResult.Failure($"cannot resolve source expression for outVariable '{outVar.Expression}'");

            lines.Add($"{outVar.Expression} := {rhs};");
        }

        var consumed = new HashSet<string>();
        foreach (var n in nodes)
        {
            foreach (var edge in n.Incoming.Values)
                consumed.Add(edge.FromLocalId);
        }

        var stateless = nodes
            .Where(n => n.Kind == NodeKind.Block && string.IsNullOrEmpty(n.InstanceName))
            .OrderBy(n => n.LocalId, StringComparer.Ordinal)
            .ToList();

        foreach (var block in stateless)
        {
            if (consumed.Contains(block.LocalId)) continue;
            var expr = RenderOperatorExpression(block, byId, new HashSet<string>());
            if (expr is null) continue;
            lines.Add($"(* unused: {expr} *)");
        }

        return NetworkResult.Success(lines, new List<string>());
    }

    // ── LD transpilation ─────────────────────────────────────────────

    private static NetworkResult TranspileLD(List<Node> nodes, Dictionary<string, Node> byId)
    {
        var coils = nodes.Where(n => n.Kind == NodeKind.Coil).ToList();
        if (coils.Count == 0)
            return NetworkResult.Success(new List<string>(), new List<string>());

        var lines = new List<string>();
        var ctx = new LdContext(byId);

        foreach (var coil in coils)
        {
            if (string.IsNullOrEmpty(coil.Expression))
                return NetworkResult.Failure($"coil {coil.LocalId} missing <variable>");

            var incoming = coil.Incoming.TryGetValue("", out var inc) ? inc : null;
            if (incoming is null)
                return NetworkResult.Failure($"coil '{coil.Expression}' has no incoming connection");

            ctx.RungPrelude = new List<string>();
            var condition = LdConditionFromEdge(incoming, ctx);
            if (condition is null)
                return NetworkResult.Failure($"cannot resolve condition for coil '{coil.Expression}'");

            lines.AddRange(ctx.RungPrelude);
            lines.Add(FormatCoilStatement(coil, condition));
        }

        return NetworkResult.Success(lines, ctx.TempDeclarations);
    }

    // ── Expression resolution ─────────────────────────────────────────

    private static string? ExpressionForEdge(Edge edge, Dictionary<string, Node> byId,
        HashSet<string> cycleGuard)
    {
        if (!cycleGuard.Add(edge.FromLocalId)) return null;
        try
        {
            if (!byId.TryGetValue(edge.FromLocalId, out var source)) return null;

            if (source.Kind is NodeKind.InVariable or NodeKind.InOutVariable)
                return source.Expression;

            if (source.Kind == NodeKind.OutVariable)
                return source.Expression;

            if (source.Kind == NodeKind.Block)
            {
                if (!string.IsNullOrEmpty(source.InstanceName))
                {
                    var port = edge.FromPort ?? (source.OutputPorts.Count > 0 ? source.OutputPorts[0] : null);
                    if (string.IsNullOrEmpty(port)) return null;
                    return $"{source.InstanceName}.{port}";
                }
                return RenderOperatorExpression(source, byId, cycleGuard);
            }

            return null;
        }
        finally
        {
            cycleGuard.Remove(edge.FromLocalId);
        }
    }

    private static string? RenderOperatorExpression(Node block, Dictionary<string, Node> byId,
        HashSet<string> cycleGuard)
    {
        var typeName = block.TypeName?.ToUpperInvariant();
        if (typeName is null) return null;

        var ports = block.Incoming
            .Where(kv => kv.Key.Length > 0)
            .OrderBy(kv => kv.Key, StringComparer.Ordinal)
            .Select(kv => kv.Value)
            .ToList();

        var operands = new List<string>();
        foreach (var e in ports)
        {
            var expr = ExpressionForEdge(e, byId, cycleGuard);
            if (expr is null) return null;
            operands.Add(expr);
        }

        if (PassthroughOperators.Contains(typeName))
            return operands.Count == 0 ? null : operands[0];

        if (UnaryOperators.TryGetValue(typeName, out var uop))
        {
            if (operands.Count == 0) return null;
            var operand = operands[0];
            return uop == "NOT" ? $"NOT {ParenIfComplex(operand)}" : $"{uop}{ParenIfComplex(operand)}";
        }

        if (InfixOperators.TryGetValue(typeName, out var iop))
        {
            if (operands.Count < 2) return null;
            return string.Join($" {iop} ", operands.Select(ParenIfComplex));
        }

        if (FunctionOperators.Contains(typeName))
            return $"{typeName}({string.Join(", ", operands)})";

        return $"{block.TypeName}({string.Join(", ", operands)})";
    }

    private static string? RenderFbInstanceCall(Node block, Dictionary<string, Node> byId,
        HashSet<string> cycleGuard)
    {
        if (string.IsNullOrEmpty(block.InstanceName)) return null;

        var argParts = new List<string>();
        var sortedPorts = block.Incoming
            .Where(kv => kv.Key.Length > 0)
            .OrderBy(kv => kv.Key, StringComparer.Ordinal);

        foreach (var kvp in sortedPorts)
        {
            var port = kvp.Key;
            var edge = kvp.Value;
            if (IsUnconnectedInput(edge, byId)) continue;
            var expr = ExpressionForEdge(edge, byId, cycleGuard);
            if (expr is null) return null;
            argParts.Add($"{port} := {expr}");
        }

        return $"{block.InstanceName}({string.Join(", ", argParts)});";
    }

    private static bool IsUnconnectedInput(Edge edge, Dictionary<string, Node> byId)
    {
        if (!byId.TryGetValue(edge.FromLocalId, out var source)) return false;
        if (source.Kind is not NodeKind.InVariable and not NodeKind.InOutVariable) return false;
        return string.IsNullOrEmpty(source.Expression);
    }

    private static readonly Regex ParenTestRe = new(@"[\s+\-*/<>=]", RegexOptions.Compiled);

    private static string ParenIfComplex(string expr)
    {
        if (ParenTestRe.IsMatch(expr) && !expr.StartsWith("(") && !expr.EndsWith(")"))
            return $"({expr})";
        return expr;
    }

    // ── LD condition walking ──────────────────────────────────────────

    private static string? LdConditionFromEdge(Edge edge, LdContext ctx)
    {
        if (!ctx.CycleGuard.Add(edge.FromLocalId)) return null;
        try
        {
            if (!ctx.ById.TryGetValue(edge.FromLocalId, out var source)) return null;

            if (source.Kind == NodeKind.LeftPowerRail)
                return "TRUE";

            if (source.Kind is NodeKind.InVariable or NodeKind.InOutVariable)
                return source.Expression;

            if (source.Kind == NodeKind.Contact)
            {
                if (string.IsNullOrEmpty(source.Expression)) return null;
                var contactExpr = RenderContactExpression(source.Expression, source, ctx);
                if (contactExpr is null) return null;

                var upstreamEdge = source.Incoming.TryGetValue("", out var ue) ? ue : null;
                var upstream = upstreamEdge is not null
                    ? LdConditionFromEdge(upstreamEdge, ctx)
                    : null;

                if (upstream is null || upstream == "TRUE") return contactExpr;
                return $"{upstream} AND {contactExpr}";
            }

            if (source.Kind == NodeKind.Block)
                return LdBlockInRung(source, ctx);

            return null;
        }
        finally
        {
            ctx.CycleGuard.Remove(edge.FromLocalId);
        }
    }

    private static string? LdBlockInRung(Node block, LdContext ctx)
    {
        if (string.IsNullOrEmpty(block.InstanceName)) return null;

        var args = new List<string>();
        var sortedPorts = block.Incoming
            .Where(kv => kv.Key.Length > 0)
            .OrderBy(kv => kv.Key, StringComparer.Ordinal);

        foreach (var kvp in sortedPorts)
        {
            var port = kvp.Key;
            var edge = kvp.Value;
            var expr = LdConditionFromEdge(edge, ctx);
            if (expr is null) return null;
            args.Add($"{port} := {expr}");
        }

        if (ctx.EmittedBlockCalls.Add(block.LocalId))
            ctx.RungPrelude.Add($"{block.InstanceName}({string.Join(", ", args)});");

        var outPort = block.OutputPorts.Count > 0 ? block.OutputPorts[0] : null;
        if (string.IsNullOrEmpty(outPort)) return null;
        return $"{block.InstanceName}.{outPort}";
    }

    private static string? RenderContactExpression(string operand, Node contact, LdContext ctx)
    {
        if (contact.EdgeAttribute is "rising" or "falling")
        {
            var fbType = contact.EdgeAttribute == "rising" ? "R_TRIG" : "F_TRIG";
            var tempName = $"_volt_edge_{contact.LocalId}";
            var decl = $"\t{tempName} : {fbType};";
            if (!ctx.TempDeclarations.Contains(decl))
                ctx.TempDeclarations.Add(decl);
            ctx.RungPrelude.Add($"{tempName}(CLK := {operand});");
            return $"{tempName}.Q";
        }
        if (contact.Negated) return $"NOT {operand}";
        return operand;
    }

    private static string FormatCoilStatement(Node coil, string condition)
    {
        var operand = coil.Expression!;
        if (coil.Storage == "set")
            return $"IF {condition} THEN {operand} := TRUE; END_IF;";
        if (coil.Storage == "reset")
            return $"IF {condition} THEN {operand} := FALSE; END_IF;";
        if (coil.Negated)
            return $"{operand} := NOT ({condition});";
        return $"{operand} := {condition};";
    }

    // ── Vendor markup stripping ───────────────────────────────────────

    private static readonly Regex VendorElementRe = new(
        @"[ \t]*<(?:[A-Za-z_][\w.-]*:)?vendorElement\b[\s\S]*?</(?:[A-Za-z_][\w.-]*:)?vendorElement>\s*\n?",
        RegexOptions.Compiled);
    private static readonly Regex AddDataRe = new(
        @"[ \t]*<(?:[A-Za-z_][\w.-]*:)?addData\b[\s\S]*?</(?:[A-Za-z_][\w.-]*:)?addData>\s*\n?",
        RegexOptions.Compiled);
    private static readonly Regex CollapseBlankLines = new(
        @"\n[ \t]*\n[ \t]*\n+", RegexOptions.Compiled);

    private static string StripVendorMarkup(string bodyXml)
    {
        var result = VendorElementRe.Replace(bodyXml, "");
        result = AddDataRe.Replace(result, "");
        result = CollapseBlankLines.Replace(result, "\n\n");
        return result;
    }
}

public class TranspileResult
{
    public bool Success { get; }
    public string St { get; }
    public List<string> TempDeclarations { get; }
    public string? ErrorReason { get; }

    public bool Ok => Success;

    public TranspileResult(bool success, string st, List<string> tempDeclarations, string? errorReason = null)
    {
        Success = success;
        St = st;
        TempDeclarations = tempDeclarations;
        ErrorReason = errorReason;
    }
}
