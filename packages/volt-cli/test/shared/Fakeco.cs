using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Format.Task;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Volt.Engine.Library;
using Volt.Engine.Seam;

namespace Volt.Tests.Shared;

/// <summary>
/// THE THIRD TEST VENDOR (openspec <c>volt-cli-rework</c> design step 4): a vendor OUTSIDE the CODESYS family that
/// implements ONLY the new contract (<see cref="IVendorDriver"/>). Its own kinds (<c>.blk</c> a block with a body,
/// <c>.typ</c> a type, <c>.stn</c> a read-only station descriptor), its own text language (<c>IMPLEMENTATION FKL</c>,
/// plain text) and a hidden one (<c>LAD</c>), its own property keys (<c>%RETAIN</c>, <c>%NOTE</c>), its own file layout
/// (<see cref="FakecoFormat"/>), an in-memory tree — and no NWL, no numeric kind code, no IEC header anywhere.
///
/// <para>Tree: <c>&lt;root&gt;</c> → container <c>Station1</c> (an application; holds items) → folders <c>Blocks</c> and
/// <c>Types</c>, and the descriptor <c>Station1.stn</c>. A block whose code holds <c>??</c> fails the build.</para>
/// </summary>
public sealed class Fakeco : VendorDriverBase, IVendorDriver
{
    public const string Id = "fakeco";
    public const string Block = "block";
    public const string Type = "type";
    public const string Station = "station";
    public const string Fkl = "FKL";

    public static readonly FakecoFormat Format = new();

    public static VendorDeclaration DeclarationOf() => new(
        new VendorRow(Id, "Fakeco"),
        new[]
        {
            KindRow.Source(Block, "blk", new KindShape(Members: true, Body: true, AccessorShape.None, Signature: false), Format),
            KindRow.Source(Type, "typ", new KindShape(Members: false, Body: false, AccessorShape.None, Signature: false), Format),
            KindRow.Descriptor(Station, "stn"),
        },
        new[] { LanguageRow.Shown(Fkl, PlainTextReader.Instance), LanguageRow.Hidden("LAD") },
        new[] { new PropertyKey("RETAIN", PropertyGrammar.Flag), new PropertyKey("NOTE", PropertyGrammar.Text) });

    /// <summary>One node of the in-memory tree; an <see cref="ItemRef"/> wraps it.</summary>
    public sealed class Node
    {
        public Node(string name, NodeClass cls) { Name = name; Class = cls; }
        public string Name { get; set; }
        public NodeClass Class { get; }
        public Node? Parent { get; set; }
        public List<Node> Children { get; } = new();
        public string Declaration { get; set; } = "";
        public BodyText? Body { get; set; }
        public PropertySet Properties { get; set; } = PropertySet.Empty;
        public string? Manifest { get; set; }

        public Node Add(Node child) { child.Parent = this; Children.Add(child); return child; }
    }

    private readonly object _ide = new();
    public Node RootNode { get; } = new("<root>", NodeClass.Container(holdsItems: false));
    public List<BridgeDiagnostic> LastDiagnostics { get; } = new();

    public Fakeco()
    {
        var station = RootNode.Add(new Node("Station1", NodeClass.Container(holdsItems: true)));
        var blocks = station.Add(new Node("Blocks", NodeClass.Folder));
        var types = station.Add(new Node("Types", NodeClass.Folder));
        blocks.Add(new Node("Motor", NodeClass.Item(Block))
        {
            Declaration = "BLOCK Motor\nIN start\nOUT lamp",
            Body = BodyText.Shown(Fkl, "lamp = start\n"),
        });
        types.Add(new Node("Speed", NodeClass.Item(Type)) { Declaration = "TYPE Speed\nFIELD rpm" });
        station.Add(new Node("Station1", NodeClass.Item(Station)) { Manifest = "station Station1\ncycle 10ms\n" });
    }

    /// <summary>The node at <paramref name="path"/> (<c>Station1/Blocks/Motor</c>, bare names), or null.</summary>
    public Node? At(string path)
    {
        var node = RootNode;
        foreach (var part in path.Split('/'))
        {
            var next = node.Children.FirstOrDefault(c => string.Equals(c.Name, part, StringComparison.OrdinalIgnoreCase));
            if (next is null) return null;
            node = next;
        }
        return node;
    }

    private static Node N(ItemRef r) => (Node)r.Native;

    // ── session ──
    public VendorDeclaration Declaration { get; } = DeclarationOf();
    public bool IsConnected => true;
    public string Vendor => Id;
    public string? ServedProjectName => "Plant";
    public string? IdeVersion => "1.0";
    public string? ProductName => "Fakeco Studio";
    public string? ProductVersion => "1.0";
    public string? ProductVendor => "Fakeco";
    public string? Unsupported => null;
    public string? NotServedBecause => null;
    public void Disconnect() { }
    public bool ShouldMarkDegraded(Exception ex) => false;
    public void Recover() { }
    public T MarshalToIdeThread<T>(Func<T> fn) { lock (_ide) return fn(); }
    public IReadOnlyList<ProjectEntry> ProjectRows() => new[] { new ProjectEntry(Id, "1.0", "Plant", HealthStatus.Healthy, false) };
    public long HealthProbeFloorMs => 1000;
    public void SelectProject(ConnectRequest sel) { }

    public bool Build(IReadOnlyCollection<string>? applications)
    {
        LastDiagnostics.Clear();
        foreach (var item in Walk().Items.Where(i => i.Kind == Block))
        {
            var code = N(item.Item).Body?.Code ?? "";
            var lines = code.Split('\n');
            for (var i = 0; i < lines.Length; i++)
                if (lines[i].Contains("??"))
                    LastDiagnostics.Add(new BridgeDiagnostic
                    {
                        Name = item.Name, Code = "FK1", Severity = Severity.Error, Message = "'??' is no FKL expression", Line = i + 1, Column = 1,
                    });
        }
        return LastDiagnostics.Count == 0;
    }

    public IReadOnlyList<BridgeDiagnostic> GetBuildDiagnostics(Func<HostWalk> walk) =>
        LastDiagnostics.Select(d => new BridgeDiagnostic
        {
            Name = d.Name, Code = d.Code, Severity = d.Severity, Message = d.Message, Line = d.Line, Column = d.Column,
        }).ToList();

    public IReadOnlyList<LibSignature> ExtractLibrarySignatures() => Array.Empty<LibSignature>();

    // ── tree ──
    public HostWalk Walk(WalkObserver? observer = null)
    {
        var items = new List<WalkedItem>();
        var applications = new List<string>();
        void Visit(Node node, string folder)
        {
            foreach (var child in node.Children)
            {
                var path = folder.Length == 0 ? child.Name : folder + "/" + child.Name;
                switch (child.Class.Role)
                {
                    case NodeRole.Item: items.Add(new WalkedItem(child.Name, new ItemRef(child), child.Class.Kind!, folder)); break;
                    case NodeRole.Container when child.Class.HoldsItems && node == RootNode:
                        applications.Add(path);
                        Visit(child, path);
                        break;
                    case NodeRole.Container or NodeRole.Folder: Visit(child, path); break;
                }
            }
        }
        Visit(RootNode, "");
        return new HostWalk(items, Array.Empty<string>(), Array.Empty<UnreadableObject>(), applications);
    }

    public ItemRef Root => new(RootNode);
    public IReadOnlyList<ItemRef> Children(ItemRef node) => N(node).Children.Select(c => new ItemRef(c)).ToList();
    public ItemRef Parent(ItemRef node) => new(N(node).Parent ?? throw new InvalidOperationException("the root has no parent"));
    public string Name(ItemRef node) => N(node).Name;
    public NodeClass Classify(ItemRef node) => N(node).Class;
    public bool HandlesSurviveStructureChange => true;

    public ItemRef CreateFolder(ItemRef parent, string name) => new(Holder(parent, name).Add(new Node(name, NodeClass.Folder)));

    public ItemRef CreateChild(ItemRef parent, string name, string kind, CreateArgs args)
    {
        if (Declaration.Kinds.FirstOrDefault(k => k.Kind == kind) is not { Role: KindRole.Source } row)
            throw new ChildRefusedException($"Fakeco creates no '{kind}': its source kinds are {Block} and {Type}", ChildRefusalCause.Kind);
        if (args.Language is { } language && language != Fkl)
            throw new ChildRefusedException($"Fakeco writes no {language} body", ChildRefusalCause.Kind);
        var node = new Node(name, NodeClass.Item(kind)) { Body = row.Shape!.Value.Body ? BodyText.Shown(Fkl, "") : null };
        return new ItemRef(Holder(parent, name).Add(node));
    }

    private Node Holder(ItemRef parent, string name)
    {
        var p = N(parent);
        if (!p.Class.HoldsItems) throw new ChildRefusedException($"'{p.Name}' holds no items, so '{name}' cannot go there", ChildRefusalCause.Kind);
        if (p.Children.Any(c => string.Equals(c.Name, name, StringComparison.OrdinalIgnoreCase)))
            throw new ChildRefusedException($"'{p.Name}' already holds '{name}'", ChildRefusalCause.Name);
        return p;
    }

    public void Delete(ItemRef parent, string name)
    {
        var p = N(parent);
        var child = p.Children.FirstOrDefault(c => string.Equals(c.Name, name, StringComparison.OrdinalIgnoreCase))
            ?? throw new InvalidOperationException($"'{p.Name}' holds no '{name}'");
        p.Children.Remove(child);
    }

    public void Rename(ItemRef node, string newName) => N(node).Name = newName;

    public void Move(ItemRef node, ItemRef target)
    {
        var n = N(node);
        var t = Holder(target, n.Name);
        n.Parent!.Children.Remove(n);
        t.Add(n);
    }

    // ── store ──
    public Content Read(ItemRef item)
    {
        var n = N(item);
        return Content.Of(n.Class.Kind!, n.Declaration, n.Body, n.Properties);
    }

    public void Write(ItemRef item, Content content, IReadOnlyList<PushedBody> bodies)
    {
        var n = N(item);
        if (content.Kind != n.Class.Kind) throw new InvalidOperationException($"'{n.Name}' is a {n.Class.Kind}, not a {content.Kind}");
        n.Declaration = content.Declaration;
        n.Properties = content.Properties;
        if (content.Body is { Form: BodyForm.Shown } body)
        {
            // The body arrives READ ONCE by its language's reader (FKL: plain text, the model is the code).
            var pushed = bodies.SingleOrDefault(b => b.Site == BodySite.Item)
                ?? throw new InvalidOperationException($"'{n.Name}': a shown {body.Language} body reached the write without its model");
            if (pushed.Language != body.Language || (string)pushed.Model != body.Code)
                throw new InvalidOperationException($"'{n.Name}': the model is not the body's");
            n.Body = body;
        }
    }

    public string ReadManifest(ItemRef item, string kind) => N(item).Manifest ?? kind + "\n";

    public void WriteTask(ItemRef task, TaskSettings settings) =>
        throw new BridgeException(BridgeErrorCodes.Unsupported, "Fakeco declares no task");

    public override string? RefusedLanguageChange(string site, string from, string to) =>
        $"Fakeco writes {Fkl} only; it cannot change a body from {from} to {to}";
}

/// <summary>Fakeco's own FILE layout — not the IEC one. Property lines first, then the declaration verbatim, then (for a
/// kind with a body) the <c>IMPLEMENTATION</c> line and the code verbatim:
/// <code>
/// %RETAIN
/// BLOCK Motor
/// IN start
/// IMPLEMENTATION FKL
/// lamp = start
/// </code>
/// A kind with no body ends with one newline after its declaration. One line grammar (<see cref="ImplementationLine"/>),
/// the languages from the registry, the keys from the registry: the format itself names none.</summary>
public sealed class FakecoFormat : IItemFormat
{
    public string Name => "fakeco";

    public string Write(Content content, string name)
    {
        var sb = new StringBuilder();
        foreach (var p in content.Properties.Items) sb.Append(p).Append('\n');
        sb.Append(content.Declaration);
        if (content.Body is { } body) sb.Append('\n').Append(ImplementationLine.For(body)).Append('\n').Append(body.Code);
        else sb.Append('\n');
        return sb.ToString();
    }

    public Content Read(string text, string kind, string name, Catalog catalog, string vendor)
    {
        var shape = catalog.Kinds.Require(kind).Shape!.Value;
        var lines = text.Split('\n');
        var at = 0;
        var props = new List<string>();
        while (at < lines.Length && lines[at].StartsWith("%", StringComparison.Ordinal)) props.Add(lines[at++]);
        var properties = catalog.PropertyKeys.ParseAll(props);
        var rest = lines.Skip(at).ToList();
        var marker = rest.FindIndex(ImplementationLine.Is);

        if (!shape.Body)
        {
            if (marker >= 0)
                throw new BridgeException(BridgeErrorCodes.InvalidSt, $"'{name}': line {at + marker + 1}: a {kind} has no body, so no {ImplementationLine.Keyword} line");
            var declaration = string.Join("\n", rest);
            if (declaration.EndsWith("\n", StringComparison.Ordinal)) declaration = declaration.Substring(0, declaration.Length - 1);
            return Content.Of(kind, declaration, null, properties);
        }

        if (marker < 0)
            throw new BridgeException(BridgeErrorCodes.InvalidSt, $"'{name}': a {kind} states its body's language on an {ImplementationLine.Keyword} line, and this text has none");
        var stated = ImplementationLine.Parse(rest[marker], catalog.Languages, vendor);
        var code = string.Join("\n", rest.Skip(marker + 1));
        if (rest.Skip(marker + 1).Any(ImplementationLine.Is))
            throw new BridgeException(BridgeErrorCodes.InvalidSt, $"'{name}': a {kind} has one body, and this text states two");
        if (stated.Form != BodyForm.Shown && code.Length > 0)
            throw new BridgeException(BridgeErrorCodes.InvalidSt, $"'{name}': '{rest[marker].Trim()}' states a body Volt does not show, and code follows it");
        var body = stated.Form == BodyForm.Shown ? stated with { Code = code } : stated;
        return Content.Of(kind, string.Join("\n", rest.Take(marker)), body, properties);
    }
}
