using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Volt.Ide.Twincat;
using Xunit;
using Volt.Tests.Shared;
using static Volt.Ide.Twincat.Tests.TcComTree;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// A TWINCAT POU WHOSE TEXT THE IDE DOES NOT READ AS A POU IS NEVER TOUCHED (openspec <c>push-without-header-check</c>
/// 5.H, DIALECT C2i).
///
/// <para>After a solution load, the first <c>Child(i)</c> or <c>LookupChild</c> on such a POU's tree item kills
/// TcXaeShell (RPC <c>0x800706BE</c>, access violation in <c>TwinCAT System Manager.dll</c>; reproduced 4×, and on 5 of
/// 5 such POUs). The double below behaves like that: touching the poisoned child throws the vendor's HRESULT and
/// KILLS the double — every later call on any node throws the same, as a dead XAE does. A <c>try</c> around the read
/// cannot help (the walk's per-node catch would swallow the first throw and then fail on everything after it), so the
/// only passing implementation is one that never makes the call: it learns which child it is from the Solution
/// Explorer hierarchy (its caption carries no <c>(PRG|FB|FUN)</c> suffix) and addresses that folder's other children by
/// name.</para>
/// </summary>
public class TcUntouchablePouTests
{
    /// <summary>The XAE the doubles live in: dead after a poisoned touch, and a log of the calls that matter.</summary>
    public sealed class Xae
    {
        public bool Dead;
        public int PathReads;
        public readonly List<string> Lookups = new();
        public readonly List<string> Deleted = new();
        /// <summary>How often each node's <c>ItemType</c> and <c>Name</c> were read, by node name, and the PLC project
        /// item's <c>NestedProject</c> — the COM reads an operation pays per node.</summary>
        public readonly Dictionary<string, int> TypeReads = new();
        public readonly Dictionary<string, int> NameReads = new();
        public int NestedReads;
        public void Alive()
        {
            if (Dead) throw new COMException("The remote procedure call failed.", unchecked((int)0x800706BE));
        }
    }

    public sealed class Children
    {
        private readonly Node _owner;
        public Children(Node owner) => _owner = owner;
        public Node this[int i] => _owner.Touch(_owner.Kids[i - 1]);
    }

    public sealed class Node
    {
        private readonly Xae _xae;
        private readonly int _type;
        public Node(Xae xae, string name, int type, bool poisoned = false, params Node[] kids)
        {
            _xae = xae; _name = name; _type = type; Poisoned = poisoned; Kids = kids.ToList();
            foreach (var k in Kids) k.Owner = this;
            Child = new Children(this);
        }
        public Node? Owner;
        public readonly List<Node> Kids;
        /// <summary>Loaded broken: a touch kills XAE. Settable, so a test can model XAE loading the project again.</summary>
        public bool Poisoned { get; set; }
        /// <summary>The IDE does not read this POU's text as a POU (its caption is bare) — set by a text write whose
        /// opening comment never closes. Touching it kills XAE only once it is <see cref="Poisoned"/> (loaded so).</summary>
        public bool Unparsed;
        private string _declaration = "";
        public string DeclarationText
        {
            get { _xae.Alive(); return _declaration; }
            set { _xae.Alive(); _declaration = value; Unparsed = value.TrimStart().StartsWith("(*") && !value.Contains("*)"); }
        }
        public string ImplementationText { get; set; } = "";
        /// <summary>A POU created in this session: a new tree item, appended, as TwinCAT does.</summary>
        public Node CreateChild(string name, int kind, string before, object? vInfo)
        {
            _xae.Alive();
            var kid = new Node(_xae, name, kind) { Owner = this };
            Kids.Add(kid);
            return kid;
        }
        /// <summary>The tree item's name. Setting it renames the tree item only: the item's DOCUMENT keeps the name it was
        /// last saved under until a save (<see cref="Persisted"/>, DIALECT D4f, vendor-facts `tc-rename-then-move`).</summary>
        public string Name
        {
            get { _xae.Alive(); _xae.NameReads[_name] = _xae.NameReads.GetValueOrDefault(_name) + 1; return _name; }
            set { _xae.Alive(); if (Persisted is null) Persisted = _name; _name = value; Renames.Add(value); }
        }
        private string _name = "";
        /// <summary>Every name the item was given, in order.</summary>
        public readonly List<string> Renames = new();
        /// <summary>The name the item's saved document carries — what an export serializes. Null: its current name.</summary>
        public string? Persisted;
        /// <summary>File > Save All: every document carries its tree item's name again.</summary>
        public void SaveAll() { Persisted = null; foreach (var k in Kids) k.SaveAll(); }
        public int ItemType { get { _xae.Alive(); _xae.TypeReads[_name] = _xae.TypeReads.GetValueOrDefault(_name) + 1; return _type; } }
        public Xae X => _xae;
        public int ChildCount { get { _xae.Alive(); return Kids.Count; } }
        public Children Child { get; }
        public string PathName
        {
            get { _xae.Alive(); _xae.PathReads++; return Path; }
        }
        private string Path => Owner is null ? "TIPC^Untitled2^Untitled2 Project" : Owner.Path + "^" + _name;
        public Node LookupChild(string name)
        {
            _xae.Alive();
            _xae.Lookups.Add(name);
            return Touch(Kids.First(k => string.Equals(k._name, name, StringComparison.OrdinalIgnoreCase)));
        }
        /// <summary>The PLCopen import as a document the importer accepted and built nothing from: no POU appears (the
        /// refusal <c>ResolveGraphicalBody</c> then answers; openspec <c>bridge-refusal-review</c> V.1).</summary>
        public void PlcOpenImport(string file, int options) => _xae.Alive();
        public void DeleteChild(string name)
        {
            _xae.Alive();
            _xae.Deleted.Add(name);
            Kids.RemoveAll(k => k._name == name);
        }
        public Node? Parent { get { _xae.Alive(); return Owner; } }
        /// <summary>The child's own <c>.TcPOU</c> bytes, for the archive round trip (<c>ExportChild</c>).</summary>
        public byte[]? Document;
        public void ExportChild(string name, string zipPath)
        {
            var kid = Touch(Kids.First(k => k._name == name));
            using var zip = System.IO.Compression.ZipFile.Open(zipPath, System.IO.Compression.ZipArchiveMode.Create);
            using var entry = zip.CreateEntry($@"POUs\{kid.Persisted ?? name}.TcPOU").Open();
            entry.Write(kid.Document!, 0, kid.Document!.Length);
        }
        /// <summary>The re-import recreates the child — a NEW tree item, appended, as TwinCAT does — named and filled from
        /// the document it imports: its object element's <c>Name</c> (else the entry's), its declaration and ST body.</summary>
        public void ImportChild(string zipPath, object a, bool b, object c)
        {
            _xae.Alive();
            using var zip = System.IO.Compression.ZipFile.OpenRead(zipPath);
            var entry = Assert.Single(zip.Entries);
            using var bytes = new System.IO.MemoryStream();
            using (var input = entry.Open()) input.CopyTo(bytes);
            var obj = System.Xml.Linq.XDocument.Parse(System.Text.Encoding.UTF8.GetString(bytes.ToArray()).TrimStart('\uFEFF'))
                .Root?.Elements().FirstOrDefault();
            var name = (string?)obj?.Attribute("Name") ?? System.IO.Path.GetFileNameWithoutExtension(entry.Name);
            var kid = new Node(_xae, name, ItemKind.PlcPou) { Owner = this, Document = bytes.ToArray() };
            if (obj?.Elements().FirstOrDefault(e => e.Name.LocalName == "Declaration") is { } d) kid._declaration = d.Value;
            if (obj?.Descendants().FirstOrDefault(e => e.Name.LocalName == "ST") is { } st) kid.ImplementationText = st.Value;
            Kids.Add(kid);
        }

        /// <summary>A POU document as TwinCAT saves it, carrying <paramref name="name"/>, a declaration and an ST body.</summary>
        public static byte[] PouDocument(string name, string declaration, string body) => System.Text.Encoding.UTF8.GetBytes(
            $"<?xml version=\"1.0\" encoding=\"utf-8\"?><TcPlcObject Version=\"1.1.0.1\"><POU Name=\"{name}\" Id=\"{{1}}\">" +
            $"<Declaration><![CDATA[{declaration}]]></Declaration><Implementation><ST><![CDATA[{body}]]></ST></Implementation>" +
            $"<LineIds Name=\"{name}\"><LineId Id=\"1\" Count=\"1\" /></LineIds></POU></TcPlcObject>");
        internal Node Touch(Node k)
        {
            _xae.Alive();
            if (k.Poisoned) { _xae.Dead = true; _xae.Alive(); }
            return k;
        }
        public string Caption => Poisoned || Unparsed ? _name : _type switch
        {
            ItemKind.PlcPouProg => _name + " (PRG)", ItemKind.PlcPou => _name + " (FB)", ItemKind.PlcPouFunc => _name + " (FUN)",
            _ => _name,
        };
        public string Canonical => _type switch
        {
            ItemKind.PlcPouProg or ItemKind.PlcPou or ItemKind.PlcPouFunc => $@"C:\p\{_name}.TcPOU",
            ItemKind.PlcFolder => $@"C:\p\{_name}\",
            ItemKind.PlcGvl => $@"C:\p\{_name}.TcGVL",
            _ => $@"C:\p\{_name}.TcDUT",
        };
        /// <summary>The Solution Explorer's view of this node — read WITHOUT any touch, as the real hierarchy is.</summary>
        internal ExplorerNode Explorer() =>
            new(_name, Canonical, Caption, Kids.Select(k => k.Explorer()).ToList());
    }

    /// <summary>The PLC project item: its nested project, and its own XML naming its <c>.plcproj</c> — one that lists no
    /// <c>Compile</c> entry (a project whose objects carry no build entry, the corpus's state: 13 of 13 hold only
    /// <c>SubType</c>), written once to the temp folder.</summary>
    public sealed class Plc
    {
        /// <param name="projectPath">The <c>.plcproj</c> the item names — the shared empty one unless a test writes its own.</param>
        public Plc(Node nested, string? projectPath = null)
        {
            _nested = nested;
            _project = projectPath ?? Project;
        }
        private readonly Node _nested;
        public Node NestedProject { get { _nested.X.NestedReads++; return _nested; } }
        /// <summary>The PLC project's name, as the solution names it (<c>TIPC^Untitled2</c>).</summary>
        public string Name => "Untitled2";
        private readonly string _project;
        private static readonly string Project = WriteProject();
        private static string WriteProject()
        {
            var path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "volt-tc-tests-empty.plcproj");
            System.IO.File.WriteAllText(path, "<Project xmlns=\"http://schemas.microsoft.com/developer/msbuild/2003\"><ItemGroup /></Project>");
            return path;
        }
        public string ProduceXml(bool recursive) =>
            $"<TreeItem><PlcProjectDef><ProjectPath>{_project}</ProjectPath></PlcProjectDef></TreeItem>";
    }

    public sealed class Empty { public int ChildCount => 0; public int ItemType => 0; }

    public sealed class SysManager
    {
        private readonly Tipc _tipc;
        public SysManager(Tipc tipc) => _tipc = tipc;
        /// <summary>The system project's I/O devices node (<c>TIID</c>), or none.</summary>
        public Node? Tiid { get; set; }
        public object LookupTreeItem(string path) => path switch
        {
            "TIPC" => _tipc,
            "TIID" => Tiid ?? (object)new Empty(),
            _ => Resolve(path) ?? throw new COMException($"Item '{path}' not found", unchecked((int)0x98510001)),
        };

        /// <summary>A PLC tree path, as XAE resolves one: a POU LOADED broken is not in its path index — "not found",
        /// and no harm (measured live 2026-10-04, DIALECT C2i) — while every other node, one written broken in this load
        /// included, is found.</summary>
        private Node? Resolve(string path)
        {
            const string root = "TIPC^Untitled2^Untitled2 Project^";
            if (!path.StartsWith(root, StringComparison.Ordinal)) return null;
            Node? node = ((Plc)_tipc.Child[1]).NestedProject;
            foreach (var name in path.Substring(root.Length).Split('^'))
                node = node?.Kids.FirstOrDefault(k => string.Equals(k.Caption.Split(' ')[0], name, StringComparison.OrdinalIgnoreCase));
            return node is { Poisoned: false } ? node : null;
        }
    }

    /// <summary>The system project's hierarchy holding the PLC project <paramref name="plc"/> — what one read answers.</summary>
    internal static ExplorerNode SystemOf(Node plc) => SystemAround(plc.Explorer());

    /// <summary>The system project's hierarchy around the PLC project's node <paramref name="plc"/>.</summary>
    internal static ExplorerNode SystemAround(ExplorerNode plc) =>
        new("TwinCAT Project14", "", "TwinCAT Project14", new List<ExplorerNode> { plc });

    /// <summary>The XAE window of the last <see cref="Project"/>: its <c>Commands</c> say what was asked of the shell.</summary>
    [ThreadStatic] internal static TcAttachTests.Dte? LastWindow;

    internal static (BeckhoffDriver Driver, TcObjectModel Model, Xae Xae, Node Root) Project(
        Func<Xae, Node> build, Func<object, string, ExplorerNode?>? explorer = null, string? plcproj = null,
        Func<Xae, Node>? tiid = null)
    {
        var xae = new Xae();
        var root = build(xae);
        var window = new TcAttachTests.Dte(new TcAttachTests.Project("TwinCAT Project14",
            new SysManager(new Tipc(new Plc(root, plcproj))) { Tiid = tiid?.Invoke(xae) })) { OnSaveAll = root.SaveAll };
        LastWindow = window;
        var model = new TcObjectModel
        {
            BindWindow = _ => window,
            // The read is of the system project: two systems may hold a PLC project of one name.
            ReadExplorer = explorer ?? ((_, system) => system == "TwinCAT Project14" ? SystemOf(root) : null),
        };
        var driver = new BeckhoffDriver(model);
        driver.Connect(xaePid: 1);
        TcRefs.Bound = model.Plcs()[0];
        return (driver, model, xae, root);
    }

    /// <summary>A driver bound to an empty PLC project whose Solution Explorer flags nothing — the state every
    /// production write runs in. For offline tests that drive a POU double directly: every child access goes through
    /// the C2i guard, which reads the bound project's hierarchy.</summary>
    /// <summary>The PLC project's application root — where its items' paths start (openspec multi-application-tree).</summary>
    internal const string App = "TwinCAT Project14/PLC/Untitled2/Untitled2 Project";

    /// <summary>The system project's <c>.device</c> descriptor — the walk's first item, before the PLC project's.</summary>
    internal const string SystemDescriptor = "TwinCAT Project14";

    internal static BeckhoffDriver BoundDriver(string? plcproj = null) =>
        Project(x => new Node(x, "Untitled2 Project", ItemKind.PlcFolder), plcproj: plcproj).Driver;

    /// <summary>The census shape (probe-5h): a folder holding a POU whose text declares nothing, beside a GVL, a DUT,
    /// a parsed FB and an interface — and a second folder, clean, which must take the fast path.</summary>
    private static Node Census(Xae x) =>
        new(x, "Untitled2 Project", ItemKind.PlcFolder, false,
            new Node(x, "VltCensus", ItemKind.PlcFolder, false,
                new Node(x, "VltX_EG", ItemKind.PlcGvl),
                new Node(x, "VltX_UCFB", ItemKind.PlcPou, poisoned: true),
                new Node(x, "VltX_FP", ItemKind.PlcPouProg),
                new Node(x, "VltX_UCI", ItemKind.PlcItf)),
            new Node(x, "Clean", ItemKind.PlcFolder, false,
                new Node(x, "Motor", ItemKind.PlcPou)),
            new Node(x, "PLC_PRG", ItemKind.PlcPouProg));

    [Fact]
    public void The_walk_never_touches_the_POU_names_it_unreadable_and_emits_every_sibling()
    {
        var (driver, _, xae, _) = Project(Census);

        var walk = driver.WalkItems().Gated();

        Assert.False(xae.Dead);
        Assert.Equal(new[] { SystemDescriptor, "VltX_EG", "VltX_FP", "VltX_UCI", "Motor", "PLC_PRG", "Project Settings" }, walk.Items.Select(i => i.Name));
        var named = Assert.Single(walk.UnreadableObjects);
        Assert.Equal(("VltX_UCFB", App + "/VltCensus"), (named.Name, named.Folder));
        Assert.Contains("crashes TcXaeShell", named.Reason);
        Assert.Equal(ItemKind.Kinds.Pou, named.Kind);
        Assert.True(walk.Complete, string.Join(",", walk.UnwalkedFolders));   // a POU is no container: its folder was walked whole
        Assert.DoesNotContain("VltX_UCFB", xae.Lookups);
    }

    /// <summary>The POU is named on the wire by its PATH, ending in its kind's extension — the name a forced
    /// <c>deleteItem</c> addresses it by (openspec <c>unreadable-name-carries-kind</c>).</summary>
    [Fact]
    public void The_unopened_POU_is_listed_by_its_path()
    {
        var (driver, _, _, _) = Project(Census);

        var (items, nodes) = Volt.Engine.Sync.Versioning.CountUnclassifiable(driver.WalkItems().Gated(), new Dictionary<string, string>());

        Assert.Equal(new[] { App + "/VltCensus/VltX_UCFB.pou" }, items.Select(u => u.Name));
        Assert.Empty(nodes);
    }

    [Fact]
    public void A_lookup_finds_a_sibling_and_refuses_the_POU_by_name_without_touching_it()
    {
        var (driver, _, xae, _) = Project(Census);

        Assert.NotNull(ItemLookup.Find(driver, App + "/VltCensus/VltX_UCI.itf"));
        var refusal = Assert.Throws<BridgeException>(() => ItemLookup.Find(driver, App + "/VltCensus/VltX_UCFB.pou"));

        Assert.Equal(BridgeErrorCodes.Unreadable, refusal.ErrorCode);
        Assert.Contains("'VltX_UCFB'", refusal.Message);
        Assert.False(xae.Dead);
    }

    /// <summary>The repair route: the parent's DeleteChild, by name — measured to leave XAE alive. The task scan that
    /// precedes a delete (a task takes its system task with it) must pass the POU over, not touch it.</summary>
    [Fact]
    public void A_delete_goes_through_the_parent_by_name_only()
    {
        var (driver, _, xae, root) = Project(Census);
        var (_, untouchable) = ItemLookup.Locate(driver, App + "/VltCensus/VltX_UCFB.pou");

        driver.Delete(untouchable!.Parent, untouchable.Name);

        Assert.False(xae.Dead);
        Assert.Equal(new[] { "VltX_UCFB" }, xae.Deleted);
        Assert.DoesNotContain(root.Kids[0].Kids, k => k.Poisoned);
    }

    /// <summary>A STRUCTURAL WRITE INSIDE ONE OPERATION DOES NOT MAKE THE HIERARCHY "SHORT". The snapshot is read once per
    /// operation; a push that deletes (or creates) a child and then looks another one up in the same folder — a
    /// create + update + delete batch, a member create followed by the re-find — met a snapshot that still listed the
    /// old count, and was refused "holds 2 children in the PLC tree, and the Solution Explorer lists 3" (live e2e
    /// 2026-10-02, 5Qa review: `push.test.ts`, `build-diagnostics.test.ts`, `fetch.test.ts`). The count check is about a
    /// hierarchy read that came back short, not one Volt itself made stale: after a structural write it reads afresh.</summary>
    [Fact]
    public void A_lookup_after_a_delete_in_the_same_operation_reads_the_hierarchy_afresh()
    {
        var (driver, _, xae, _) = Project(x => new Node(x, "Untitled2 Project", ItemKind.PlcFolder, false,
            new Node(x, "POUs", ItemKind.PlcFolder, false,
                new Node(x, "Motor1", ItemKind.PlcPou), new Node(x, "Motor2", ItemKind.PlcPou), new Node(x, "Motor3", ItemKind.PlcPou)),
            new Node(x, "PLC_PRG", ItemKind.PlcPouProg)));
        var motor1 = ItemLookup.Find(driver, App + "/POUs/Motor1.pou")!.Value;

        driver.Delete(driver.Parent(motor1), "Motor1");

        Assert.NotNull(ItemLookup.Find(driver, App + "/POUs/Motor3.pou"));
        Assert.False(xae.Dead);
    }

    /// <summary>A DUT AND A FOLDER OF THE SAME NAME (legal, DIALECT D34) are two hierarchy nodes at one path. The DUT's
    /// "0 children" overwrote the folder's count, so the folder was refused "holds 1 … lists 0" and its POU vanished from
    /// refs (live e2e `name-clash.test.ts`, 2026-10-02).</summary>
    [Fact]
    public void A_DUT_beside_a_folder_of_its_name_does_not_hide_the_folders_children()
    {
        var (driver, _, xae, _) = Project(x => new Node(x, "Untitled2 Project", ItemKind.PlcFolder, false,
            new Node(x, "Clash", ItemKind.PlcFolder, false, new Node(x, "Inner", ItemKind.PlcPou)),
            new Node(x, "Clash", ItemKind.PlcDutStruct),
            new Node(x, "PLC_PRG", ItemKind.PlcPouProg)));

        var walk = driver.WalkItems().Gated();

        Assert.Empty(walk.UnwalkedFolders);
        Assert.Contains("Inner", walk.Items.Select(i => i.Name));
        Assert.False(xae.Dead);
    }

    /// <summary>THE SAME SHARED PATH IN A GUARDED FOLDER (5Qa review). Its children are addressed by NAME, and a DUT and a
    /// folder named <c>X</c> are one name: <c>LookupChild("X")</c> answered the same node for both indices, so one was
    /// read twice and the other never — the folder's POUs missing from the walk, in silence. A guarded folder whose
    /// children cannot each be addressed by their own name is refused by name (unwalked: nothing in it reads as
    /// deleted). Niche: 0 such folders in the corpora.</summary>
    [Fact]
    public void A_guarded_folder_with_two_children_of_one_name_is_refused_not_read_twice()
    {
        var (driver, _, xae, _) = Project(x => new Node(x, "Untitled2 Project", ItemKind.PlcFolder, false,
            new Node(x, "F", ItemKind.PlcFolder, false,
                new Node(x, "U", ItemKind.PlcPou, poisoned: true),
                new Node(x, "X", ItemKind.PlcDutStruct),
                new Node(x, "X", ItemKind.PlcFolder, false, new Node(x, "P", ItemKind.PlcPou))),
            new Node(x, "PLC_PRG", ItemKind.PlcPouProg)));

        var walk = driver.WalkItems().Gated();

        Assert.False(xae.Dead);
        Assert.Contains(App + "/F", walk.UnwalkedFolders);
        Assert.Contains("PLC_PRG", walk.Items.Select(i => i.Name));
    }

    // ── what reaches a CLIENT from each C2i refusal (openspec bridge-refusal-review 7.1) ───────────────────────────
    // A walk takes a refused folder into `unwalked` (above); a push's apply-time LOOKUP meets the same refusal and it
    // becomes that op's conflict. It is an IDE state — the hierarchy did not vouch for the folder — not a Volt bug, so it
    // answers ITEM_UNVERIFIED, the code the pre-apply gate gives an item in a folder the walk skipped: one code for one
    // situation, whichever phase meets it. It answered INTERNAL_ERROR, and the lookup re-coded every coded refusal as
    // INTERNAL_ERROR on top.

    /// <summary>TcObjectModel.ChildAt: a guarded folder whose children cannot each be addressed by name (DIALECT D34).</summary>
    [Fact]
    public void A_lookup_into_a_guarded_folder_with_two_children_of_one_name_answers_ITEM_UNVERIFIED_naming_it()
    {
        var (driver, _, xae, _) = Project(x => new Node(x, "Untitled2 Project", ItemKind.PlcFolder, false,
            new Node(x, "F", ItemKind.PlcFolder, false,
                new Node(x, "U", ItemKind.PlcPou, poisoned: true),
                new Node(x, "X", ItemKind.PlcDutStruct),
                new Node(x, "X", ItemKind.PlcFolder, false, new Node(x, "P", ItemKind.PlcPou))),
            new Node(x, "PLC_PRG", ItemKind.PlcPouProg)));

        var refusal = Assert.Throws<BridgeException>(() => ItemLookup.Find(driver, App + "/F/X/P.pou"));

        Assert.Equal(ConflictCodes.ItemUnverified, refusal.ErrorCode);
        Assert.Contains("Untitled2 Project^F'", refusal.Message);
        Assert.Contains("DIALECT D34", refusal.Message);
        Assert.False(xae.Dead);
    }

    /// <summary>TcObjectModel.ChildAt: a guarded node whose child count moved after the hierarchy was read (a POU added in
    /// the IDE during the operation). Only a node that is not a PLC folder reaches this check — a folder is held to the
    /// hierarchy's count before any child is asked for — so the guarded node here is the PLC project itself.</summary>
    [Fact]
    public void A_lookup_into_a_guarded_node_whose_child_count_moved_answers_ITEM_UNVERIFIED_naming_it()
    {
        var (driver, _, xae, root) = Project(x => new Node(x, "Untitled2 Project", ItemKind.PlcSystemRoot, false,
            new Node(x, "U", ItemKind.PlcPou, poisoned: true),
            new Node(x, "PLC_PRG", ItemKind.PlcPouProg)));
        driver.WalkItems().Gated();
        root.Kids.Add(new Node(xae, "Added", ItemKind.PlcPou) { Owner = root });

        var refusal = Assert.Throws<BridgeException>(() => ItemLookup.Find(driver, App + "/PLC_PRG.pou"));

        Assert.Equal(ConflictCodes.ItemUnverified, refusal.ErrorCode);
        Assert.Contains("'TIPC^Untitled2^Untitled2 Project'", refusal.Message);
        Assert.Contains("lists 3 of them where the Solution Explorer lists 2", refusal.Message);
        Assert.False(xae.Dead);
    }

    /// <summary>TcObjectModel.RequireListed: a PLC folder the hierarchy lists short.</summary>
    [Fact]
    public void A_lookup_through_a_folder_the_hierarchy_lists_short_answers_ITEM_UNVERIFIED_naming_it()
    {
        var hierarchy = (ExplorerNode?)null;
        var (driver, _, xae, root) = Project(Census, (_, _) => hierarchy is null ? null : SystemAround(hierarchy));
        var census = root.Explorer();
        hierarchy = census with
        {
            Children = new[] { census.Children[0] with { Children = Array.Empty<ExplorerNode>() } }
                .Concat(census.Children.Skip(1)).ToList(),
        };

        // A lookup THROUGH the folder: an item's path names the folders it descends (openspec multi-application-tree).
        var refusal = Assert.Throws<BridgeException>(() => ItemLookup.Find(driver, App + "/VltCensus/VltX_EG.gvl"));

        Assert.Equal(ConflictCodes.ItemUnverified, refusal.ErrorCode);
        Assert.Contains("'VltCensus' holds 4 children", refusal.Message);
        Assert.False(xae.Dead);
    }

    /// <summary>ExplorerSnapshot.From: a node whose canonical name was not read cannot be classified as a POU or not.</summary>
    [Fact]
    public void A_node_without_its_canonical_name_answers_ITEM_UNVERIFIED_naming_it()
    {
        var refusal = Assert.Throws<BridgeException>(() => ExplorerSnapshot.From(new ExplorerNode("P", "", "P",
            new[] { new ExplorerNode("F", @"C:\p\F\", "F", new[] { new ExplorerNode("Q", null, "Q", Array.Empty<ExplorerNode>()) }) })));

        Assert.Equal(ConflictCodes.ItemUnverified, refusal.ErrorCode);
        Assert.Contains("canonical name of 'F^Q'", refusal.Message);
    }

    /// <summary>A POU BESIDE A FOLDER OF ITS NAME (5Qa review): the folder's path is the POU's, and "inside a POU" (whose
    /// members the hierarchy does not list) waved the folder through the count check — so a folder the hierarchy lists
    /// short was read anyway, a POU it does not list among its children. The hierarchy LISTS that folder, so it is held
    /// to the count like any other. Niche: 0 POU/folder pairs in the corpora.</summary>
    [Fact]
    public void A_folder_beside_a_POU_of_its_name_is_still_held_to_the_hierarchys_count()
    {
        Node? built = null;
        var (driver, _, xae, _) = Project(x => built = new Node(x, "Untitled2 Project", ItemKind.PlcFolder, false,
                new Node(x, "X", ItemKind.PlcPou),
                new Node(x, "X", ItemKind.PlcFolder, false, new Node(x, "P", ItemKind.PlcPou), new Node(x, "Hidden", ItemKind.PlcPou)),
                new Node(x, "PLC_PRG", ItemKind.PlcPouProg)),
            (_, system) =>
            {
                if (system != "TwinCAT Project14") return null;
                var full = built!.Explorer();
                var folder = full.Children[1];
                return SystemAround(full with
                {
                    Children = new[] { full.Children[0], folder with { Children = folder.Children.Take(1).ToList() }, full.Children[2] },
                });
            });

        var walk = driver.WalkItems().Gated();

        Assert.False(xae.Dead);
        Assert.Contains(App + "/X", walk.UnwalkedFolders);
        Assert.DoesNotContain("Hidden", walk.Items.Select(i => i.Name));
    }

    /// <summary>Every real project: nothing flagged, so every child is opened by index — no LookupChild. The one
    /// added read is a folder's path, once per folder SCAN (the hierarchy must vouch for its child count), never once
    /// per child.</summary>
    [Fact]
    public void A_project_with_nothing_flagged_takes_the_fast_path()
    {
        var motors = Enumerable.Range(1, 8).Select(i => $"Motor{i}").ToArray();
        var (driver, _, xae, _) = Project(x => new Node(x, "Untitled2 Project", ItemKind.PlcFolder, false,
            new Node(x, "POUs", ItemKind.PlcFolder, false, motors.Select(m => new Node(x, m, ItemKind.PlcPou)).ToArray()),
            new Node(x, "PLC_PRG", ItemKind.PlcPouProg)));

        var walk = driver.WalkItems().Gated();
        var pathReadsInTheWalk = xae.PathReads;

        Assert.Equal(motors.Prepend(SystemDescriptor).Append("PLC_PRG").Append("Project Settings"), walk.Items.Select(i => i.Name));
        Assert.InRange(pathReadsInTheWalk, 1, 3);   // the PLC root once, and each of its two folders' scans
        Assert.NotNull(ItemLookup.Find(driver, App + "/POUs/Motor8.pou"));
        Assert.Empty(xae.Lookups);
    }

    /// <summary>Name addressing depends on the names matching; a folder whose child count disagrees with the hierarchy
    /// is not read at all (unwalked: nothing beneath it reads as deleted) — and still nothing is touched.</summary>
    [Fact]
    public void A_child_count_that_disagrees_with_the_hierarchy_leaves_the_folder_unwalked()
    {
        var hierarchy = (ExplorerNode?)null;
        var (driver, _, xae, root) = Project(Census, (_, _) => hierarchy is null ? null : SystemAround(hierarchy));
        var census = root.Explorer();
        var folder = census.Children[0];
        hierarchy = census with
        {
            Children = new[] { folder with { Children = folder.Children.Take(3).ToList() } }
                .Concat(census.Children.Skip(1)).ToList(),
        };

        var walk = driver.WalkItems().Gated();

        Assert.False(xae.Dead);
        Assert.Contains(App + "/VltCensus", walk.UnwalkedFolders);
        Assert.Contains("PLC_PRG", walk.Items.Select(i => i.Name));
    }

    /// <summary>THE SNAPSHOT CAN ONLY FLAG WHAT IT LISTS. A folder the hierarchy lists with no children — a read that came
    /// back short, or a project system that fills a collapsed folder lazily — must not pass for a folder with nothing to
    /// avoid: it is refused (unwalked), and its broken POU is never opened.</summary>
    [Fact]
    public void A_folder_the_hierarchy_lists_short_is_not_read_and_its_POU_is_never_opened()
    {
        var hierarchy = (ExplorerNode?)null;
        var (driver, _, xae, root) = Project(Census, (_, _) => hierarchy is null ? null : SystemAround(hierarchy));
        var census = root.Explorer();
        hierarchy = census with
        {
            Children = new[] { census.Children[0] with { Children = Array.Empty<ExplorerNode>() } }
                .Concat(census.Children.Skip(1)).ToList(),
        };

        var walk = driver.WalkItems().Gated();

        Assert.False(xae.Dead);
        Assert.Contains(App + "/VltCensus", walk.UnwalkedFolders);
        Assert.Equal(new[] { SystemDescriptor, "Motor", "PLC_PRG", "Project Settings" }, walk.Items.Select(i => i.Name));
    }

    /// <summary>A folder the hierarchy does not list at all leaves the PLC project short of a child: the whole tree is
    /// refused, named — nothing is opened.</summary>
    [Fact]
    public void A_project_the_hierarchy_lists_short_is_refused_and_nothing_is_opened()
    {
        var hierarchy = (ExplorerNode?)null;
        var (driver, _, xae, root) = Project(Census, (_, _) => hierarchy is null ? null : SystemAround(hierarchy));
        var census = root.Explorer();
        hierarchy = census with { Children = census.Children.Skip(1).ToList() };

        var failure = Assert.Throws<BridgeException>(() => driver.WalkItems());

        Assert.Equal(ConflictCodes.ItemUnverified, failure.ErrorCode);
        Assert.Contains("'Untitled2 Project'", failure.Message);
        Assert.False(xae.Dead);
    }

    /// <summary>A Solution Explorer node as <c>IVsHierarchy</c> answers it, with any one property read made to FAIL.</summary>
    private sealed class Hierarchy : TcSolutionExplorer.IVsHierarchy
    {
        private const uint Nil = 0xFFFFFFFF;
        // item id → (name, canonical, caption, first child, next sibling)
        private readonly Dictionary<uint, (string Name, string Canonical, string Caption, uint First, uint Next)> _nodes;
        public (uint Item, int Prop)? Fails;
        public Hierarchy(Dictionary<uint, (string, string, string, uint, uint)> nodes) => _nodes = nodes;

        public int GetProperty(uint itemid, int propid, out object? pvar)
        {
            pvar = null;
            if (Fails == (itemid, propid)) return unchecked((int)0x80004005);
            var n = _nodes[itemid];
            pvar = propid switch
            {
                -2003 => n.Caption, -2012 => n.Name,
                -2041 => unchecked((int)n.First), -2042 => unchecked((int)n.Next),
                _ => null,
            };
            return 0;
        }
        public int GetCanonicalName(uint itemid, out string? pbstrName)
        {
            pbstrName = null;
            if (Fails == (itemid, 0)) return unchecked((int)0x80004005);
            pbstrName = _nodes[itemid].Canonical;
            return 0;
        }
        public int GetNestedHierarchy(uint itemid, ref Guid iid, out IntPtr nested, out uint nestedId)
        { nested = IntPtr.Zero; nestedId = Nil; return unchecked((int)0x80004001); }
        public int SetSite(IntPtr psp) => 0;
        public int GetSite(out IntPtr ppsp) { ppsp = IntPtr.Zero; return 0; }
        public int QueryClose(out int pfCanClose) { pfCanClose = 1; return 0; }
        public int Close() => 0;
        public int GetGuidProperty(uint itemid, int propid, out Guid pguid) { pguid = Guid.Empty; return 0; }
        public int SetGuidProperty(uint itemid, int propid, ref Guid rguid) => 0;
        public int SetProperty(uint itemid, int propid, object var) => 0;

        /// <summary>A folder (1) holding a parsed POU (2) and a broken one (3), under the root (0).</summary>
        public static Hierarchy Folder() => new(new Dictionary<uint, (string, string, string, uint, uint)>
        {
            [0xFFFFFFFE] = ("P", "", "P", 1, Nil),
            [1] = ("F", @"C:\p\F\", "F", 2, Nil),
            [2] = ("Ok", @"C:\p\F\Ok.TcPOU", "Ok (FB)", Nil, 3),
            [3] = ("Broken", @"C:\p\F\Broken.TcPOU", "Broken", Nil, Nil),
        });
    }

    [Fact]
    public void The_hierarchy_read_lists_every_node_and_flags_the_broken_POU()
    {
        var unread = new List<string>();
        var nodes = TcSolutionExplorer.Children(Hierarchy.Folder(), 0xFFFFFFFE, 0, unread);

        Assert.Empty(unread);
        var snapshot = ExplorerSnapshot.From(new ExplorerNode("P", "", "P", nodes));
        Assert.Equal(new[] { "Broken" }, snapshot.At("F")!.Untouchable);
    }

    /// <summary>EVERY HIERARCHY READ IS CHECKED. A caption read as "" would differ from the name — the broken POU would
    /// pass for a parsed one; a sibling or canonical read that ends the list would drop it. Each is recorded on the node,
    /// and the snapshot refuses that node by name: never a shorter list, never a stand-in value. (Recorded, not thrown:
    /// other projects in a real solution refuse reads Volt never needs — GetCanonicalName answered E_NOTIMPL on
    /// Project14's, measured.)</summary>
    [Theory]
    [InlineData(3u, -2003)]   // the broken POU's caption
    [InlineData(3u, -2012)]   // its name
    [InlineData(3u, 0)]       // its canonical name (0 = GetCanonicalName)
    [InlineData(2u, -2042)]   // the sibling link that reaches it
    [InlineData(1u, -2041)]   // the folder's first-child link
    public void A_failed_hierarchy_read_fails_the_read_rather_than_shortening_it(uint item, int prop)
    {
        var h = Hierarchy.Folder();
        h.Fails = (item, prop);

        var unread = new List<string>();
        var nodes = TcSolutionExplorer.Children(h, 0xFFFFFFFE, 0, unread);

        var refusal = Assert.Throws<BridgeException>(() => ExplorerSnapshot.From(new ExplorerNode("P", "", "P", nodes, unread.Count == 0 ? null : string.Join("; ", unread))));
        Assert.Equal(ConflictCodes.ItemUnverified, refusal.ErrorCode);
        Assert.Contains("did not read", refusal.Message);
        Assert.Contains("'F", refusal.Message);   // named by where it sits (its own name may be the read that failed)
    }

    /// <summary>REPAIRED IN PLACE IS NOT PROVEN SAFE. A POU flagged at load that the engineer then fixes in the XAE
    /// editor gets its kind suffix back — but it is the SAME tree item, and nothing measured says the crash follows the
    /// caption rather than the item's state at load (the measured repairs all made a new item: delete + create). So a
    /// POU flagged once in this session stays unopened until Volt itself deletes it through its parent; it is then a
    /// new item, and opens normally. Refused by name meanwhile — a forced push repairs it — never a crash.</summary>
    [Fact]
    public void A_POU_flagged_once_stays_unopened_after_its_caption_heals_until_Volt_deletes_it()
    {
        var hierarchy = (ExplorerNode?)null;
        var (driver, model, xae, root) = Project(Census, (_, _) => hierarchy is null ? null : SystemAround(hierarchy));
        hierarchy = root.Explorer();
        Assert.Equal("VltX_UCFB", Assert.Single(driver.WalkItems().Gated().UnreadableObjects).Name);

        // The engineer fixes its text in the editor: the caption heals, the tree item is the one loaded broken.
        var healed = root.Explorer();
        var census = healed.Children[0];
        hierarchy = healed with
        {
            Children = new[] { census with { Children = census.Children
                .Select(c => c.Name == "VltX_UCFB" ? c with { Caption = "VltX_UCFB (FB)" } : c).ToList() } }
                .Concat(healed.Children.Skip(1)).ToList(),
        };
        model.ForgetExplorer();   // a new operation
        var walk = driver.WalkItems().Gated();

        Assert.False(xae.Dead);
        Assert.Equal("VltX_UCFB", Assert.Single(walk.UnreadableObjects).Name);

        // Volt deletes it through its parent and creates a new item of the name: that one opens.
        var (_, untouchable) = ItemLookup.Locate(driver, App + "/VltCensus/VltX_UCFB.pou");
        driver.Delete(untouchable!.Parent, untouchable.Name);
        var fresh = new Node(xae, "VltX_UCFB", ItemKind.PlcPou) { Owner = root.Kids[0] };
        root.Kids[0].Kids.Add(fresh);
        hierarchy = root.Explorer();
        model.ForgetExplorer();

        var after = driver.WalkItems().Gated();
        Assert.False(xae.Dead);
        Assert.Empty(after.UnreadableObjects);
        Assert.Contains("VltX_UCFB", after.Items.Select(i => i.Name));
    }

    private const string BrokenFb = "(* Motor\n *\nFUNCTION_BLOCK VltX_W\nVAR\n\tn : INT;\nEND_VAR";

    /// <summary>A POU WRITTEN BROKEN IN THIS LOAD IS READ AS CODESYS READS IT (openspec bridge-refusal-review 8.4,
    /// owner decision C2i). Its caption is bare — the IDE does not read the text as a POU — but it is a tree item of
    /// this load, which XAE survives a touch of and the system manager resolves by path (measured live: ItemType 604,
    /// XAE alive). So the walk lists it as an item, a lookup finds it (a create over it then answers ITEM_EXISTS), and
    /// nothing dies.</summary>
    [Fact]
    public void A_POU_written_broken_in_this_load_is_read_like_any_POU()
    {
        var (driver, model, xae, root) = Project(Census);
        var created = (Node)model.CreateChild(root, "VltX_W", ItemKind.PlcPou);
        model.WriteText(created, BrokenFb, "n := n + 1;");
        Assert.Equal("VltX_W", created.Caption);   // premise: the IDE does not read it as a POU
        model.ForgetExplorer();                    // a new operation

        var walk = driver.WalkItems().Gated();

        Assert.False(xae.Dead);
        Assert.Contains("VltX_W", walk.Items.Select(i => i.Name));
        Assert.Equal(new[] { "VltX_UCFB" }, walk.UnreadableObjects.Select(u => u.Name));   // the one loaded broken stays
        var (found, untouchable) = ItemLookup.Locate(driver, App + "/VltX_W.pou");
        Assert.Null(untouchable);
        Assert.Same(created, ((BeckhoffDriver.TcNode)found!.Value.Native).Com);
    }

    /// <summary>…AND ONLY IN THIS LOAD. XAE loading the project again — a solution close + reopen, and a project
    /// reload-from-disk, which leaves the worker's PLC node WORKING (measured) — loads the POU broken: touching it then
    /// kills XAE. The system manager's path lookup no longer resolves it (measured: "not found", XAE alive), so it is
    /// named <c>unreadable</c> again — the accepted irreducible state (owner, 2026-10-04) — with the node never
    /// re-acquired, and nothing touched.</summary>
    [Fact]
    public void A_POU_written_broken_is_unreadable_once_XAE_has_loaded_it_again()
    {
        var (driver, model, xae, root) = Project(Census);
        var created = (Node)model.CreateChild(root, "VltX_W", ItemKind.PlcPou);
        model.WriteText(created, BrokenFb, "n := n + 1;");

        created.Poisoned = true;   // XAE loaded the project again (from disk): the item is loaded broken now
        model.ForgetExplorer();
        var walk = driver.WalkItems().Gated();

        Assert.False(xae.Dead);
        Assert.DoesNotContain("VltX_W", walk.Items.Select(i => i.Name));
        Assert.Equal(new[] { "VltX_UCFB", "VltX_W" }, walk.UnreadableObjects.Select(u => u.Name).OrderBy(n => n, StringComparer.Ordinal));
    }

    [Fact]
    public void An_unreadable_hierarchy_fails_the_walk_and_touches_nothing()
    {
        var (driver, _, xae, _) = Project(Census, (_, _) => throw new COMException("QueryService failed", unchecked((int)0x80004002)));

        var failure = Assert.Throws<BridgeException>(() => driver.WalkItems());

        Assert.Equal(ConflictCodes.ItemUnverified, failure.ErrorCode);
        Assert.Contains("Solution Explorer hierarchy is unreadable", failure.Message);
        Assert.False(xae.Dead);
    }

    [Fact]
    public void A_hierarchy_without_the_PLC_project_fails_the_walk()
    {
        var (driver, _, xae, _) = Project(Census, (_, _) => null);

        var failure = Assert.Throws<BridgeException>(() => driver.WalkItems());

        Assert.Equal(ConflictCodes.ItemUnverified, failure.ErrorCode);
        Assert.Contains("'Untitled2 Project'", failure.Message);
        Assert.False(xae.Dead);
    }

    /// <summary>A graphical member body goes in through the POU's archive, which deletes the POU and re-imports it — and
    /// the driver then re-finds it by scanning its FOLDER. A folder that also holds an untouchable POU must not fail
    /// that scan: the write has landed, so a throw there reports a partial write as a refusal.</summary>
    [Fact]
    public void Re_finding_a_POU_after_its_member_bodies_are_written_passes_an_untouchable_sibling_over()
    {
        var document = System.IO.File.ReadAllBytes(Fixtures.Path("tc-pou", "MembersHidden.TcPOU"));
        var (driver, _, xae, root) = Project(x => new Node(x, "Untitled2 Project", ItemKind.PlcFolder, false,
            new Node(x, "F", ItemKind.PlcFolder, false,
                new Node(x, "Broken", ItemKind.PlcPou, poisoned: true),
                new Node(x, "VltProbe_Hidden", ItemKind.PlcPou) { Document = document })));
        var pou = root.Kids[0].Kids[1];
        var ladder = Fixtures.Pou("ladder.TcPOU");
        var start = ladder.IndexOf("<NWL>", StringComparison.Ordinal);
        var nwl = ladder.Substring(start, ladder.IndexOf("</NWL>", StringComparison.Ordinal) + "</NWL>".Length - start);

        var live = driver.WriteMemberBodies(TcRefs.Ref(pou), new List<(string[], string)> { (new[] { "M_Ladder" }, nwl) });

        Assert.False(xae.Dead);
        Assert.Equal("VltProbe_Hidden", driver.Name(live));
        Assert.NotSame(pou, live.Native);   // the re-imported tree item, not the dead handle
    }

    /// <summary>The flag: a <c>.TcPOU</c> captioned with its bare name. Measured on 26 census items: 5 of 5 such POUs
    /// crash, and none of the 21 others — a GVL, a DUT and an interface never carry a suffix, a member is reached only
    /// through its POU, and a POU whose text declares the OTHER POU kind still has one.</summary>
    [Fact]
    public void Only_a_POU_without_its_kind_suffix_is_flagged()
    {
        ExplorerNode N(string name, string canonical, string caption, params ExplorerNode[] kids) =>
            new(name, canonical, caption, kids);
        var snapshot = ExplorerSnapshot.From(N("Untitled2 Project", "", "Untitled2 Project",
            N("VltCensus", @"C:\p\VltCensus\", "VltCensus",
                N("VltX_EG", @"C:\p\VltCensus\VltX_EG.TcGVL", "VltX_EG"),
                N("VltX_EP", @"C:\p\VltCensus\VltX_EP.TcPOU", "VltX_EP"),
                N("VltX_FP", @"C:\p\VltCensus\VltX_FP.TcPOU", "VltX_FP (PRG)"),
                N("VltX_MB", @"C:\p\VltCensus\VltX_MB.TcPOU", "VltX_MB (FB)",
                    N("M", @"C:\p\VltCensus\VltX_MB.TcPOU;VltX_MB.M", "M")),
                N("VltX_UCI", @"C:\p\VltCensus\VltX_UCI.TcIO", "VltX_UCI"),
                N("VltK_BC", @"C:\p\VltCensus\VltK_BC.TcDUT", "VltK_BC")),
            N("POUs", @"C:\p\POUs\", "POUs", N("Main", @"C:\p\POUs\Main.TcPOU", "Main (PRG)")),
            N("Untitled2.tmc", @"C:\p\Untitled2.tmc", "Untitled2.tmc")));

        Assert.False(snapshot.Clean);
        var census = snapshot.At("VltCensus")!;
        Assert.Equal(new[] { "VltX_EP" }, census.Untouchable);
        Assert.Equal(6, census.Names.Count);
        Assert.Null(snapshot.At(""));
        Assert.Null(snapshot.At("POUs"));
    }
}
