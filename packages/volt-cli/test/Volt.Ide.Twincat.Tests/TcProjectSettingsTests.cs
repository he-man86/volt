using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using Volt.Engine.Format.Settings;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Volt.Ide.Twincat;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// TwinCAT materializes the read-only <c>Project Settings.projectsettings</c> descriptor (openspec
/// <c>twincat-project-settings</c> 2.1-2.3), from the settings TwinCAT itself stores.
///
/// <para><b>Every vendor document here is MEASURED</b> (TcXaeShell 15.0 / TwinCAT 3.1.4024.74, a copy of the Project14
/// fixture, 2026-10-03, <c>scripts/probe-tc-project-settings.ps1</c> + <c>probe-tc-project-settings-gui.ps1</c>):</para>
/// <list type="bullet">
/// <item><c>untouched.plcproj.xml</c> — the committed Project14 <c>Untitled2.plcproj</c>, as TwinCAT wrote it: no warning
/// key, no compile-option key (the copy every measurement started from).</item>
/// <item><c>c0371.plcproj.xml</c> / <c>c0033-c0371.plcproj.xml</c> — that project after unchecking C0371, then C0033, on the
/// Compiler Warnings page and Save All: the <c>{8F99A816-..}</c> OptionKey appears with
/// <c>DisabledWarningIds</c> = <c>371</c>, then <c>33,371</c> (DIALECT D37).</item>
/// <item><c>nested-project.xml</c> — <c>ProduceXml()</c> of the PLC project's <c>NestedProject</c> (type 600),
/// identical before and after the clicks: <c>CompilerSettings</c> answers ReplaceConstants=false, MaxWarnings=100,
/// empty CompilerDefines (D38).</item>
/// <item><c>nested-project-defines.xml</c> — the same <c>ProduceXml()</c> after <c>probe-tc-compile-options.ps1</c> set ReplaceConstants=true and CompilerDefines=<c>A, B</c> (task 3.4).</item>
/// <item><c>plc-project-item.xml</c> — <c>ProduceXml()</c> of the PLC project item (<c>TIPC^Untitled2</c>, type 56),
/// whose <c>PlcProjectDef/ProjectPath</c> names the <c>.plcproj</c>. The one edit: the measured path (a temp dir under
/// the user's profile) is replaced by <c>%PROJECT_PATH%</c>, which the driver test fills with a copy it owns.</item>
/// </list>
/// <para>The three <c>.plcproj</c> documents carry a <c>.xml</c> suffix: they are file CONTENT, not openable projects,
/// and <c>Volt.Repo.Gates</c> rightly requires every <c>*.plcproj</c> under <c>test/</c> to resolve its Compile items.</para>
/// </summary>
public class TcProjectSettingsTests
{
    private static string Fixture(string name) => File.ReadAllText(Fixtures.Path("tc-project-settings", name));

    // ── the vendor translation ──────────────────────────────────────────

    [Fact]
    public void Disabled_warnings_are_read_from_the_plcproj_archive()
    {
        Assert.Equal(new[] { 371 }, TcProjectSettings.DisabledWarningIds(Fixture("c0371.plcproj.xml")));
        Assert.Equal(new[] { 33, 371 }, TcProjectSettings.DisabledWarningIds(Fixture("c0033-c0371.plcproj.xml")));
    }

    /// <summary>No <c>{8F99A816-..}</c> key is TwinCAT's representation of "nothing disabled" — the baseline project
    /// has none, and its page shows every warning checked (D37). Not a missing value.</summary>
    [Fact]
    public void A_project_with_no_warning_key_disables_nothing()
    {
        Assert.Empty(TcProjectSettings.DisabledWarningIds(Fixture("untouched.plcproj.xml")));
    }

    /// <summary>A value the vendor never writes (it stores bare integers) is refused by name, not skipped: skipping
    /// would silently drop a disabled warning and the LSP would report it again.</summary>
    [Fact]
    public void A_warning_id_that_is_not_an_integer_is_refused_by_name()
    {
        var bad = Fixture("c0371.plcproj.xml").Replace("<v>371</v>", "<v>C0371</v>");
        var ex = Assert.Throws<InvalidOperationException>(() => TcProjectSettings.DisabledWarningIds(bad));
        Assert.Contains("C0371", ex.Message);
        Assert.Contains("DisabledWarningIds", ex.Message);
    }

    [Fact]
    public void The_three_live_rows_come_from_the_automation_interface()
    {
        var s = TcProjectSettings.CompilerSettings(Fixture("nested-project.xml"));
        Assert.False(s.ReplaceConstants);
        Assert.Equal("100", s.MaxWarnings);
        Assert.Equal("", s.Defines);
    }

    /// <summary>The automation interface ALWAYS answers CompilerSettings (D38); a document without it is not the
    /// NestedProject's, and saying so beats rendering a file with two rows silently missing.</summary>
    [Fact]
    public void A_nested_project_without_compiler_settings_is_refused()
    {
        var ex = Assert.Throws<InvalidOperationException>(() =>
            TcProjectSettings.CompilerSettings("<TreeItem><ItemName>X</ItemName></TreeItem>"));
        Assert.Contains("CompilerSettings", ex.Message);
    }

    [Fact]
    public void The_plcproj_path_comes_from_the_plc_project_item()
    {
        Assert.Equal("%PROJECT_PATH%", TcProjectSettings.ProjectPath(Fixture("plc-project-item.xml")));
    }

    /// <summary>The four rows TwinCAT has no source for (D39) are NULL — omitted — never a default.</summary>
    [Fact]
    public void Rows_with_no_twincat_source_are_omitted_not_defaulted()
    {
        var s = TcProjectSettings.Read(Fixture("c0371.plcproj.xml"), Fixture("nested-project.xml"));
        Assert.Null(s.WarningsAsErrors);
        Assert.Null(s.UnicodeIdentifiers);
        Assert.Null(s.Utf8Encoding);
        Assert.Null(s.BreakpointLogging);
    }

    // ── the driver: walk + manifest (2.1, 2.2) ──────────────────────────

    /// <summary>A PLC project with C0371 disabled: the walk names <c>Project Settings</c> at the project root, as the
    /// CODESYS walk does, and its manifest is the descriptor — the Disabled warnings line byte-identical to the one the
    /// CODESYS bridge wrote for pro2193.</summary>
    [Fact]
    public void A_project_with_C0371_disabled_materializes_the_descriptor()
    {
        using var project = new SettingsProject("c0371.plcproj.xml");
        var driver = project.Driver();

        var walk = driver.WalkItems();
        var item = Assert.Single(walk.Items, i => i.KindCode == ItemKind.PlcProjectSettings);
        Assert.Equal(("Project Settings", ""), (item.Name, item.Folder));
        Assert.Equal(ItemKind.Kinds.ProjectSettings, ItemKind.Map(driver.KindCode(item.Item)));
        Assert.Equal("Project Settings", driver.Name(item.Item));

        Assert.Equal(
            "Disabled warnings:     C0371\n" +
            "Replace constants:     off\n" +
            "Max compiler warnings: 100\n",
            driver.ReadManifest(item.Item, ItemKind.Kinds.ProjectSettings));
    }

    /// <summary>The descriptor reads the SAVED file on every pull — a warning disabled and saved after the first read
    /// is in the next one, so nothing is cached across operations.</summary>
    [Fact]
    public void Each_read_sees_the_saved_file_as_it_is_now()
    {
        using var project = new SettingsProject("untouched.plcproj.xml");
        var driver = project.Driver();
        var item = driver.WalkItems().Items.Single(i => i.KindCode == ItemKind.PlcProjectSettings);

        Assert.DoesNotContain("Disabled warnings", driver.ReadManifest(item.Item, ItemKind.Kinds.ProjectSettings));
        project.Save("c0033-c0371.plcproj.xml");
        Assert.StartsWith("Disabled warnings:     C0033, C0371\n",
            driver.ReadManifest(item.Item, ItemKind.Kinds.ProjectSettings));
    }

    /// <summary>Read-only, like on CODESYS: the kind is a reference kind no push writes, and nothing looks it up as
    /// a push target.</summary>
    [Fact]
    public void The_descriptor_is_read_only()
    {
        Assert.True(ItemKind.IsReadOnlyKind(ItemKind.Kinds.ProjectSettings));
        Assert.False(ItemKind.IsSourceKind(ItemKind.Kinds.ProjectSettings));
        Assert.False(ItemKind.IsAddressableItem(ItemKind.PlcProjectSettings));
        Assert.Contains((ItemKind.Kinds.ProjectSettings, "projectsettings"), ItemKind.ReferenceKindExtensions);
        Assert.DoesNotContain(ItemKind.Kinds.ProjectSettings, ItemKind.WritableReferenceKinds);
    }

    // ── parity (2.3) ────────────────────────────────────────────────────

    /// <summary>Same settings → same rows as the CODESYS driver (<see cref="ProjectSettingsFacts"/>; the CODESYS suite
    /// asserts its own double against the same facts).</summary>
    [Fact]
    public void The_shared_rows_match_the_cross_driver_facts()
    {
        using var project = new SettingsProject("c0371.plcproj.xml");
        var driver = project.Driver();
        var item = driver.WalkItems().Items.Single(i => i.KindCode == ItemKind.PlcProjectSettings);
        var text = driver.ReadManifest(item.Item, ItemKind.Kinds.ProjectSettings);

        Assert.Equal(ProjectSettingsFacts.SharedRows, ProjectSettingsFacts.SharedRowsOf(text));
        foreach (var label in ProjectSettingsFacts.CodesysOnlyRows)
            Assert.DoesNotContain(label + ":", text);
    }

    /// <summary>Task 3.4: the defines row from the MEASURED <c>NestedProject</c> of a project whose defines were set to
    /// <c>A, B</c> (<c>nested-project-defines.xml</c>, TcXaeShell 15.0 / 4024.74, 2026-10-03,
    /// <c>probe-tc-compile-options.ps1</c>) — the line the CODESYS bridge served for the same string.</summary>
    [Fact]
    public void The_defines_row_matches_the_cross_driver_fact()
    {
        using var project = new SettingsProject("untouched.plcproj.xml", "nested-project-defines.xml");
        var driver = project.Driver();
        var item = driver.WalkItems().Items.Single(i => i.KindCode == ItemKind.PlcProjectSettings);
        Assert.Contains(ProjectSettingsFacts.DefinesRow + "\n", driver.ReadManifest(item.Item, ItemKind.Kinds.ProjectSettings));
    }

    // ── doubles ─────────────────────────────────────────────────────────

    /// <summary>A TwinCAT window with one PLC project whose <c>.plcproj</c> is a temp copy of a measured fixture.
    /// The doubles are plain C# objects reached through <c>dynamic</c>, as the driver reaches the COM ones.</summary>
    private sealed class SettingsProject : IDisposable
    {
        private readonly string _dir = Path.Combine(Path.GetTempPath(), "volt-tc-settings-" + Guid.NewGuid().ToString("N"));
        private readonly string _plcproj;

        private readonly string _nested;

        public SettingsProject(string fixture, string nested = "nested-project.xml")
        {
            _nested = nested;
            Directory.CreateDirectory(_dir);
            _plcproj = Path.Combine(_dir, "Untitled2.plcproj");
            Save(fixture);
        }

        /// <summary>What Save All does: the file on disk changes, the automation interface does not (D37).</summary>
        public void Save(string fixture) => File.Copy(Fixtures.Path("tc-project-settings", fixture), _plcproj, overwrite: true);

        public BeckhoffDriver Driver()
        {
            var root = new Node("Untitled2 Project", ItemKind.PlcFolder, Fixture(_nested),
                new Node("PLC_PRG", ItemKind.PlcPou, ""));
            var plc = new Plc(root, Fixture("plc-project-item.xml").Replace("%PROJECT_PATH%", _plcproj));
            var window = new TcAttachTests.Dte(new TcAttachTests.Project("TwinCAT Project14", new SysManager(new Tipc(plc))));
            var driver = new BeckhoffDriver(new TcObjectModel { BindWindow = _ => window, ReadExplorer = (_, _) => root.Explorer() });
            driver.Connect(xaePid: 1);
            return driver;
        }

        public void Dispose() { try { Directory.Delete(_dir, recursive: true); } catch (IOException) { } }
    }

    public sealed class Children
    {
        private readonly Node[] _nodes;
        public Children(Node[] nodes) => _nodes = nodes;
        public Node this[int i] => _nodes[i - 1];
    }

    public sealed class Node
    {
        private readonly Node[] _children;
        private readonly string _xml;
        private Node? _owner;
        public Node(string name, int type, string xml, params Node[] children)
        {
            Name = name; ItemType = type; _xml = xml; _children = children;
            Child = new Children(children); ChildCount = children.Length;
            foreach (var c in children) c._owner = this;
        }
        public string Name { get; }
        public string PathName => _owner is null ? "TIPC^Untitled2^" + Name : _owner.PathName + "^" + Name;
        internal ExplorerNode Explorer() => new(Name, "", Name, _children.Select(c => c.Explorer()).ToList());
        public int ItemType { get; }
        public int ChildCount { get; }
        public Children Child { get; }
        public string ProduceXml(bool recursive) => _xml;
    }

    public sealed class Plc
    {
        private readonly string _xml;
        public Plc(Node nested, string xml) { NestedProject = nested; _xml = xml; }
        public Node NestedProject { get; }
        public string Name => "Untitled2";
        public string ProduceXml(bool recursive) => _xml;
    }

    public sealed class Tipc
    {
        public Tipc(Plc plc) => Child = new PlcList(plc);
        public int ChildCount => 1;
        public PlcList Child { get; }
        public sealed class PlcList { private readonly Plc _p; public PlcList(Plc p) => _p = p; public Plc this[int _] => _p; }
    }

    public sealed class SysManager
    {
        private readonly Tipc _tipc;
        public SysManager(Tipc tipc) => _tipc = tipc;
        public object LookupTreeItem(string path) => path == "TIPC"
            ? _tipc
            : throw new COMException($"Item '{path}' not found", unchecked((int)0x98510001));
    }
}
