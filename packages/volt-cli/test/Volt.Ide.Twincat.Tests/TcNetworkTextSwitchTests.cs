using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Format.Network;
using Volt.Engine.Item;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>The switch flips a process-wide flag, so no test of this suite may run beside one that turns it off.</summary>
[CollectionDefinition(Name, DisableParallelization = true)]
public sealed class NetworkTextSwitchCollection
{
    public const string Name = "network text switch";
}

/// <summary>
/// THE TWINCAT READ OBEYS THE PRODUCTION SWITCH (openspec <c>implementation-keyword</c> 3c): with <c>VOLT_GRAPHICAL</c>
/// unset, <see cref="BeckhoffDriver.ReadContent"/> hands up a ladder the text COULD spell as
/// <c>IMPLEMENTATION LD UNSUPPORTED</c>, with the switch's reason — the driver asks the engine
/// (<see cref="NetworkText.Pulled"/>) before it reads a single network. With the switch on, the same archive is network
/// text. Driven through the driver itself, over a plain node <c>dynamic</c> binds to as it binds to the COM object
/// (<see cref="TcHiddenBodyWriteTests.Node"/>), holding the vendor's own archive.
/// </summary>
[Collection(NetworkTextSwitchCollection.Name)]
public class TcNetworkTextSwitchTests
{
    /// <summary>The NWL body of a vendor-written .TcPOU, exactly as it sits in the file.</summary>
    private static string Ladder() =>
        XDocument.Load(Fixtures.Path("tc-pou", "ladder.TcPOU"), LoadOptions.PreserveWhitespace)
            .Descendants("NWL").Single().ToString(SaveOptions.DisableFormatting);

    private static ItemContent Read() =>
        new BeckhoffDriver(new TcObjectModel()).ReadContent(new ItemRef(
            new TcHiddenBodyWriteTests.Node("PRG_Ladder", ItemKind.PlcPouProg, "PROGRAM PRG_Ladder\nVAR\nEND_VAR", Ladder())));

    [Fact]
    public void Off_a_ladder_is_read_as_its_UNSUPPORTED_line_with_the_switchs_reason()
    {
        var was = NetworkTextSwitch.Enabled;
        NetworkTextSwitch.Enabled = false;
        try
        {
            var content = Read();

            Assert.Equal("IMPLEMENTATION LD UNSUPPORTED", content.Body);
            Assert.Equal("LD and FBD are not enabled in this build", content.Unsupported);
        }
        finally { NetworkTextSwitch.Enabled = was; }
    }

    [Fact]
    public void On_the_same_ladder_is_network_text()
    {
        var content = Read();

        Assert.StartsWith("IMPLEMENTATION LD\nNETWORK", content.Body);
        Assert.Null(content.Unsupported);
    }
}
