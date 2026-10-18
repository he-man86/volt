using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using Volt.Engine.Item;
using Volt.Ide.Twincat;
using Xunit;
using static Volt.Ide.Twincat.Tests.TcComTree;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// NAMING A BUILD'S DIAGNOSTICS BY PATH IS DECORATION, NOT THE BUILD (openspec multi-application-tree, design §6; gate
/// review of step 3a). The driver names a diagnostic by its item's path through a walk and the PLC projects'
/// directories — COM reads that fault on an everyday XAE (<c>RPC_E_CALL_REJECTED</c>). A fault there must leave the
/// compiler's diagnostics with their bare names (which the engine resolves where unique), never replace them: the build
/// ran, and "nameless diagnostics beat no diagnostics".
/// </summary>
public class TcBuildDiagnosticNamingTests
{
    public sealed class EditPoint { private readonly string _t; public EditPoint(string t) => _t = t; public string GetText(object end) => _t; }
    public sealed class Point { private readonly string _t; public Point(string t) => _t = t; public EditPoint CreateEditPoint() => new(_t); }
    public sealed class TextDocument
    {
        public TextDocument(string t) { StartPoint = new Point(t); }
        public Point StartPoint { get; }
        public object EndPoint => new();
    }
    public sealed class Pane { public Pane(string t) => TextDocument = new TextDocument(t); public TextDocument TextDocument { get; } }
    public sealed class Panes
    {
        private readonly Pane[] _panes;
        public Panes(params Pane[] panes) => _panes = panes;
        public int Count => _panes.Length;
        public Pane Item(int i) => _panes[i - 1];
    }
    public sealed class Output { public Output(Panes p) => OutputWindowPanes = p; public Panes OutputWindowPanes { get; } }
    public sealed class Window { public Window(Output o) => Object = o; public Output Object { get; } }
    public sealed class Windows { private readonly Window _w; public Windows(Window w) => _w = w; public Window Item(string guid) => _w; }

    /// <summary>The PLC project item, naming a <c>.plcproj</c> in the temp folder — the directory the compiler's paths lie in.</summary>
    public sealed class Plc
    {
        public sealed class Nested { public string Name => "Untitled2 Project"; }
        public Nested NestedProject { get; } = new();
        public string Name => "Untitled2";
        public static readonly string Directory = System.IO.Path.GetTempPath().TrimEnd(System.IO.Path.DirectorySeparatorChar);
        public string ProduceXml(bool recursive) =>
            $"<TreeItem><PlcProjectDef><ProjectPath>{Directory}\\Untitled2.plcproj</ProjectPath></PlcProjectDef></TreeItem>";
    }

    [Fact]
    public void A_fault_while_naming_by_path_keeps_every_compiler_diagnostic_with_its_bare_name()
    {
        var pane = $"1>{Plc.Directory}\\MAIN.TcPOU(3,1) : error : Identifier 'a' not defined\r\n" +
                   $"1>{Plc.Directory}\\MAIN.TcPOU(4,1) : error : Identifier 'b' not defined\r\n";
        var window = new TcAttachTests.Dte(new TcAttachTests.Project("TwinCAT Project14", new SysManager(new Tipc(new Plc()))))
        {
            Windows = new Windows(new Window(new Output(new Panes(new Pane(pane))))),
        };
        var model = new TcObjectModel
        {
            BindWindow = _ => window,
            // the walk the naming needs faults, as XAE's hierarchy does when it rejects a call
            ReadExplorer = (_, _) => throw new COMException("Call was rejected by callee.", unchecked((int)0x80010001)),
        };
        var driver = new BeckhoffDriver(model);
        driver.Connect(xaePid: 1);

        var diagnostics = driver.GetBuildDiagnostics(driver.WalkItems);

        Assert.Equal(new[] { "Identifier 'a' not defined", "Identifier 'b' not defined" }, diagnostics.Select(d => d.Message));
        Assert.All(diagnostics, d => Assert.Equal("MAIN", d.Name));
    }
}
