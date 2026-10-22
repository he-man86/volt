using System;
using System.IO;
using Volt.Ide.Twincat;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// A MANIFEST WINDOWS WILL NOT ACTIVATE IS NOT A FAILED READ (environment audit of the x86-helper fix). XAE's own
/// <c>Automation\msenvp.dll.manifest</c> is activated around every hierarchy read (DIALECT C2t); when <c>CreateActCtx</c>
/// refuses it, the read used to throw a plain <c>COMException</c> — which <c>TcObjectModel.Explorer</c> answers
/// <c>ITEM_UNVERIFIED</c>, "a folder could not be read", the very misreading the field bug produced. It goes on with
/// the proxy COM has registered; only when THAT is absent too is the IDE unsupported, with both reasons named.
/// </summary>
public class TcProxyActivationTests
{
    [Fact]
    public void A_manifest_the_OS_cannot_activate_does_not_end_the_read_it_goes_on_with_the_registered_proxy()
    {
        var ide = Path.Combine(Path.GetTempPath(), "volt-actctx-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(ide, "Automation"));
        File.WriteAllText(Path.Combine(ide, "Automation", "msenvp.dll.manifest"), "not a manifest");
        try
        {
            // The DTE is a plain object, no OLE service provider: a read that got past the activation fails on that cast.
            var ex = Record.Exception(() => TcSolutionExplorer.ReadSystem(new object(), "P", ide, new TcSolutionExplorer.Roots()));
            Assert.IsType<InvalidCastException>(ex);
        }
        finally { Directory.Delete(ide, recursive: true); }
    }
}
