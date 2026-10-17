using System;
using System.Runtime.InteropServices;
using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Item;
using Xunit;
using XaeNode = Volt.Ide.Twincat.Tests.TcUntouchablePouTests.Node;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// WHAT THE IDE WOULD NOT DO IS UNSUPPORTED, NOT A VOLT BUG (openspec <c>bridge-refusal-review</c> V.1). Each of these was an
/// uncoded <c>InvalidOperationException</c> (or a coded <c>INTERNAL_ERROR</c>), which the push reports as Volt's own broken
/// invariant. (Its case here was a PLCopen import the IDE accepted and built nothing from — deleted with the import,
/// openspec twincat-inproc-host.)
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
        var window = new RefusingSaveDte(new TcAttachTests.Project("TwinCAT Project14", new TcComTree.SysManager()));
        var model = new TcObjectModel { BindWindow = _ => window };
        new BeckhoffDriver(model).Connect(xaePid: 1);

        var ex = Assert.Throws<BridgeException>(() => model.FlushPendingWrites());

        Assert.Equal(BridgeErrorCodes.IdeSaveFailed, ex.ErrorCode);
        Assert.Contains("could not save", ex.Message);
        Assert.Contains("File.SaveAll", ex.Message);
        Assert.Contains("Save All", ex.Message);                    // the remedy: save, or retry
        Assert.IsType<COMException>(ex.InnerException);           // so a dead channel still degrades the session
    }
}
