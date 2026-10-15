using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Xml.Linq;

namespace Volt.Tests.Shared;

/// <summary>
/// AN NWL ARCHIVE AS DATA (openspec <c>ld-fbd-coverage</c> 1b.3): the vendor's own member tree of a graphical body —
/// every archived member of every node, by its ARCHIVE name — which the completeness oracle compares before and after
/// NWL → network text → NWL. Both vendors' archives become this one shape (the schema is identical, census 1b.1):
/// CODESYS from the recorded corpus (<c>test/fixtures/nwl-corpus/*.nwl.xml</c>, <c>scripts/record-nwl-corpus.py</c>),
/// TwinCAT from the <c>&lt;NWL&gt;&lt;XmlArchive&gt;</c> of a <c>.TcPOU</c>.
///
/// <para>A member's value is an <see cref="ArchiveScalar"/>, an <see cref="ArchiveNode"/>, an <see cref="ArchiveList"/>
/// or null. A member named <c>api.&lt;X&gt;</c> is not archived: it is what the live object answered through its API
/// where the archive holds nothing the reader could use (the recorder's file format names them).</para>
/// </summary>
public sealed class ArchiveScalar
{
    public ArchiveScalar(char kind, string text) { Kind = kind; Text = text; }

    /// <summary><c>s</c> string, <c>b</c> bool, <c>i</c> Int32, <c>l</c> Int64, <c>e</c> an enum member.</summary>
    public char Kind { get; }
    public string Text { get; }

    public override string ToString() => Kind + ":" + Text;
    public override bool Equals(object? obj) => obj is ArchiveScalar s && s.Kind == Kind && s.Text == Text;
    public override int GetHashCode() => Kind ^ Text.GetHashCode();
}

public sealed class ArchiveList
{
    public ArchiveList(IEnumerable<object?> items) { Items = items.ToList(); }
    public List<object?> Items { get; }
}

public sealed class ArchiveNode
{
    public ArchiveNode(string cls) { Class = cls; }

    public string Class { get; }

    /// <summary>The members in the order the source holds them.</summary>
    public List<KeyValuePair<string, object?>> Members { get; } = new();

    public bool Has(string member) => Members.Any(m => m.Key == member);

    public object? this[string member] => Members.FirstOrDefault(m => m.Key == member).Value;

    public ArchiveNode Set(string member, object? value)
    {
        var at = Members.FindIndex(m => m.Key == member);
        if (at >= 0) Members[at] = new(member, value);
        else Members.Add(new(member, value));
        return this;
    }

    public string? Str(string member) => (this[member] as ArchiveScalar)?.Text;
}

/// <summary>One LD/FBD body of a recorded corpus.</summary>
public sealed class CorpusBody
{
    public CorpusBody(string guid, string path, string owner, ArchiveNode impl) { Guid = guid; Path = path; Owner = owner; Impl = impl; }
    public string Guid { get; }
    /// <summary>The object names from the application down (<c>Device/Plc Logic/Application/FB/Method</c>).</summary>
    public string Path { get; }
    /// <summary>The owning object's class (<c>POUObject</c>, <c>ActionObject</c>, <c>POUMethodObject</c>, …).</summary>
    public string Owner { get; }
    public ArchiveNode Impl { get; }
}

/// <summary>A shape of API answer the recorder COUNTED: the API member answered <see cref="Answered"/> where the archive
/// member held no value (<see cref="ArchiveHeld"/>: <c>empty</c>, <c>null</c> or <c>sentinel</c>).</summary>
public sealed class ApiAnswer
{
    public string Class { get; set; } = "";
    public string Member { get; set; } = "";
    public string Api { get; set; } = "";
    public string ArchiveHeld { get; set; } = "";
    public string Answered { get; set; } = "";
    public int Count { get; set; }
    public override string ToString() => $"{Class}.{Member} ({ArchiveHeld}) -> {Api} = '{Answered}' ×{Count}";
}

/// <summary>One node where the API answered other than the archive holds a VALUE (listed by path).</summary>
public sealed class ApiMismatch
{
    public string Path { get; set; } = "";
    public string Class { get; set; } = "";
    public string Member { get; set; } = "";
    public string Api { get; set; } = "";
    public string Archive { get; set; } = "";
    public string Answered { get; set; } = "";
    public string DeclaredBy { get; set; } = "";
    public string Interface { get; set; } = "";
    public override string ToString() => $"{Path} {Class}.{Member}: archive '{Archive}', {Api} answered '{Answered}' ({DeclaredBy}; {Interface})";
}

public sealed class NwlCorpus
{
    public string Name { get; set; } = "";
    public string Source { get; set; } = "";
    public string Ide { get; set; } = "";
    public List<CorpusBody> Bodies { get; } = new();
    public List<ApiAnswer> ApiAnswers { get; } = new();
    public List<ApiMismatch> ApiMismatches { get; } = new();
}

/// <summary>The live CODESYS recording of gate 1b-3 (<c>scripts/record-nwl-live.py</c>).</summary>
public sealed class NwlLive
{
    public string Ide { get; set; } = "";
    /// <summary>A fresh object of each class the shipped writer constructs, made as it makes it, by class.</summary>
    public Dictionary<string, ArchiveNode> Fresh { get; } = new(StringComparer.Ordinal);
    public string ReaderCorpus { get; set; } = "";
    public List<LiveRead> Reads { get; } = new();
}

/// <summary>One network that stores a symbol comment, as the shipped reader read it in a live CODESYS: the stored
/// comment count, what the reader read (operand, comment), and the shipped rebuild refusal's answer for that model.</summary>
public sealed class LiveRead
{
    public string Path { get; set; } = "";
    public int Index { get; set; }
    public int Stored { get; set; }
    public string? ReadRefused { get; set; }
    public string? Refusal { get; set; }
    public List<(string Operand, string Text)> Comments { get; set; } = new();
}

public static class NwlArchive
{
    /// <summary>The recorded corpora, <c>test/fixtures/nwl-corpus/&lt;corpus&gt;.nwl.xml</c>, under the CLI root.</summary>
    public static string CorpusDir(string cliRoot) => Path.Combine(cliRoot, "test", "fixtures", "nwl-corpus");

    /// <summary>Read one recorded corpus file (format: <c>scripts/record-nwl-corpus.py</c>).</summary>
    public static NwlCorpus ReadCorpus(string file)
    {
        var root = XDocument.Load(file, LoadOptions.PreserveWhitespace).Root
                   ?? throw new InvalidDataException(file + ": no root element");
        var corpus = new NwlCorpus
        {
            Name = Required(root, "corpus"),
            Source = Required(root, "source"),
            Ide = Required(root, "ide"),
        };
        foreach (var e in root.Elements())
        {
            switch (e.Name.LocalName)
            {
                case "body":
                    corpus.Bodies.Add(new CorpusBody(Required(e, "guid"), Required(e, "path"), Required(e, "owner"),
                        Node(e.Elements("o").Single())));
                    break;
                case "api-answers":
                    corpus.ApiAnswers.Add(new ApiAnswer
                    {
                        Class = Required(e, "class"), Member = Required(e, "member"), Api = Required(e, "api"),
                        ArchiveHeld = Required(e, "archive"), Answered = Required(e, "answered"),
                        Count = int.Parse(Required(e, "count"), CultureInfo.InvariantCulture),
                    });
                    break;
                case "api-mismatch":
                    corpus.ApiMismatches.Add(new ApiMismatch
                    {
                        Path = Required(e, "path"), Class = Required(e, "class"), Member = Required(e, "member"),
                        Api = Required(e, "api"), Archive = Required(e, "archive"), Answered = Required(e, "answered"),
                        DeclaredBy = (string?)e.Attribute("declared-by") ?? "", Interface = (string?)e.Attribute("interface") ?? "",
                    });
                    break;
                default:
                    throw new InvalidDataException($"{file}: an element <{e.Name.LocalName}> the format does not have");
            }
        }
        var stated = int.Parse(Required(root, "bodies"), CultureInfo.InvariantCulture);
        if (stated != corpus.Bodies.Count)
            throw new InvalidDataException($"{file}: states {stated} bodies and holds {corpus.Bodies.Count}");
        return corpus;
    }

    /// <summary>Read <c>test/fixtures/nwl-corpus/live.codesys.xml</c> (format: <c>scripts/record-nwl-live.py</c>): every
    /// NWL object the shipped writer constructs, fresh, by class; and the shipped reader's reads of the networks that
    /// store a symbol comment.</summary>
    public static NwlLive ReadLive(string file)
    {
        var root = XDocument.Load(file, LoadOptions.PreserveWhitespace).Root
                   ?? throw new InvalidDataException(file + ": no root element");
        var live = new NwlLive { Ide = Required(root, "ide") };
        foreach (var o in root.Element("fresh")?.Elements("o") ?? throw new InvalidDataException(file + ": no <fresh>"))
        {
            var node = Node(o);
            if (live.Fresh.ContainsKey(node.Class)) throw new InvalidDataException($"{file}: two fresh '{node.Class}'");
            live.Fresh[node.Class] = node;
        }
        var reader = root.Element("reader") ?? throw new InvalidDataException(file + ": no <reader>");
        live.ReaderCorpus = Required(reader, "corpus");
        foreach (var n in reader.Elements("network"))
            live.Reads.Add(new LiveRead
            {
                Path = Required(n, "path"),
                Index = int.Parse(Required(n, "index"), CultureInfo.InvariantCulture),
                Stored = int.Parse(Required(n, "stored"), CultureInfo.InvariantCulture),
                ReadRefused = (string?)n.Attribute("read-refused"),
                Refusal = (string?)n.Attribute("refusal"),
                Comments = n.Elements("comment").Select(c => (Required(c, "operand"), Required(c, "text"))).ToList(),
            });
        return live;
    }

    private static string Required(XElement e, string attribute) =>
        (string?)e.Attribute(attribute) ?? throw new InvalidDataException($"<{e.Name.LocalName}> without '{attribute}'");

    private static ArchiveNode Node(XElement o)
    {
        var node = new ArchiveNode(Required(o, "t"));
        foreach (var a in o.Attributes())
            if (a.Name.LocalName is not ("t" or "m")) node.Members.Add(new(a.Name.LocalName, Typed(a.Value)));
        foreach (var c in o.Elements())
        {
            var member = Required(c, "m");
            node.Members.Add(new(member, c.Name.LocalName switch
            {
                "o" => Node(c),
                "l" => new ArchiveList(c.Elements().Select(Item)),
                _ => throw new InvalidDataException($"a member element <{c.Name.LocalName}> the format does not have"),
            }));
        }
        return node;
    }

    private static object? Item(XElement x) => x.Name.LocalName switch
    {
        "o" => Node(x),
        "null" => null,
        "x" => Typed(Required(x, "v")),
        _ => throw new InvalidDataException($"a list item <{x.Name.LocalName}> the format does not have"),
    };

    /// <summary>A typed scalar (<c>s:…</c>, <c>b:…</c>, <c>i:…</c>, <c>l:…</c>, <c>e:…</c>), or null for <c>null</c>.</summary>
    public static ArchiveScalar? Typed(string v)
    {
        if (v == "null") return null;
        if (v.Length < 2 || v[1] != ':' || "sbile".IndexOf(v[0]) < 0)
            throw new InvalidDataException($"an untyped scalar '{v}'");
        return new ArchiveScalar(v[0], v.Substring(2));
    }

    public static ArchiveScalar S(string? s) => new('s', s ?? throw new ArgumentNullException(nameof(s)));
    public static ArchiveScalar B(bool b) => new('b', b ? "true" : "false");
    public static ArchiveScalar I(int i) => new('i', i.ToString(CultureInfo.InvariantCulture));
    public static ArchiveScalar L(long l) => new('l', l.ToString(CultureInfo.InvariantCulture));
    public static ArchiveScalar E(string member) => new('e', member);

    /// <summary>A value as one line of a finding.</summary>
    public static string Show(object? v) => v switch
    {
        null => "null",
        ArchiveScalar s => s.Kind == 's' ? "'" + s.Text.Replace("\r", "\\r").Replace("\n", "\\n") + "'" : s.Text,
        ArchiveNode n => "<" + n.Class + ">",
        // A short list of scalars or nulls shows its items (a parameter list, an output slot list); anything else its size.
        ArchiveList l when l.Items.Count <= 8 && l.Items.All(x => x is null or ArchiveScalar) =>
            "[" + string.Join(", ", l.Items.Select(Show)) + "]",
        ArchiveList l when l.Items.Count <= 8 && l.Items.All(x => x is null or ArchiveNode { Class: "Operand" }) =>
            "[" + string.Join(", ", l.Items.Select(x => x is ArchiveNode o ? Show(o["Operand"]) : "null")) + "]",
        ArchiveList l => "[" + l.Items.Count + "]",
        _ => v.ToString() ?? "",
    };
}
