using System;
using System.Runtime.InteropServices;
using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Format.Network;
using Volt.Engine.Item;
using Xunit;
using XaeNode = Volt.Ide.Twincat.Tests.TcUntouchablePouTests.Node;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// WHAT THE IDE WOULD NOT DO IS UNSUPPORTED, NOT A VOLT BUG (openspec <c>bridge-refusal-review</c> V.1). Each of these was an
/// uncoded <c>InvalidOperationException</c> (or a coded <c>INTERNAL_ERROR</c>), which the push reports as Volt's own broken
/// invariant: a PLCopen import the IDE accepted and built nothing from. The IDE did not take what was sent;
/// <c>UNSUPPORTED</c> is that situation. Messages unchanged — they name what the IDE did not do.
///
/// <para>A save the IDE refused is NOT that situation (review of step V): the applied writes are in the IDE and not on
/// disk, and saving again is exactly the remedy, where UNSUPPORTED says "no retry will change it". It is its own code,
/// <c>IDE_SAVE_FAILED</c>, declared on push and build, the frames it arrives on.</para>
/// </summary>
public class TcIdeRefusalCodeTests
{
    /// <summary>An XAE window whose <c>File.SaveAll</c> the IDE refuses.</summary>
    public sealed class RefusingSaveDte
    {
        public RefusingSaveDte(params TcAttachTests.Project[] projects) { Solution.Projects.Items.AddRange(projects); }
        public TcAttachTests.Solution Solution { get; } = new();
        public string Version => "15.0";
        public void ExecuteCommand(string command) =>
            throw new COMException($"Command \"{command}\" is not available.", unchecked((int)0x80004005));
    }

    [Fact]
    public void A_save_the_IDE_refused_is_IDE_SAVE_FAILED_and_keeps_the_IDE_exception()
    {
        var window = new RefusingSaveDte(new TcAttachTests.Project("TwinCAT Project14", new TcAttachTests.SysManager()));
        var model = new TcObjectModel { BindWindow = _ => window };
        new BeckhoffDriver(model).Connect(xaePid: 1);

        var ex = Assert.Throws<BridgeException>(() => model.FlushPendingWrites());

        Assert.Equal(BridgeErrorCodes.IdeSaveFailed, ex.ErrorCode);
        Assert.Contains("could not save", ex.Message);
        Assert.Contains("File.SaveAll", ex.Message);
        Assert.Contains("Save All", ex.Message);                    // the remedy: save, or retry
        Assert.IsType<COMException>(ex.InnerException);           // so a dead channel still degrades the session
    }

    [Fact]
    public void A_PLCopen_import_that_built_no_POU_is_UNSUPPORTED()
    {
        var (_, model, _, _) = TcUntouchablePouTests.Project(x => new XaeNode(x, "Untitled2 Project", ItemKind.PlcFolder));
        var and = new Box("AND", null, CallKind.Operator,
            new[] { new Input(null, new Leaf(new Operand("a"), Flags.None), Flags.None),
                    new Input(null, new Leaf(new Operand("b"), Flags.None), Flags.None) },
            Array.Empty<Output>(), null, null, Flags.None);
        var body = new NetworkBody(BodyLanguage.Fbd,
            new[] { new Network(0, null, null, null, false, new Volt.Engine.Format.Network.Node[] { new Assign(and, new[] { new Operand("out") }, Flags.None) }) });

        var ex = Assert.Throws<BridgeException>(() => model.ResolveGraphicalBody(body, viewMode: "FBD"));

        Assert.Equal(BridgeErrorCodes.Unsupported, ex.ErrorCode);
        Assert.Contains("produced no POU", ex.Message);
    }
}
