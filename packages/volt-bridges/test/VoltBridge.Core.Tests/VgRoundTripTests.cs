using VoltBridge.Core.Fbd.Vg;
using Xunit;

namespace VoltBridge.Core.Tests;

public class VgRoundTripTests
{
    private static string Round(string vg) => VgWriter.Write(VgParser.Parse(vg));

    [Theory]
    [InlineData("%LANG FBD\nNETWORK\n  Config(xFASTSystemInTaskMidPrio := FALSE, xLogErrorTypeInformation := TRUE, xLogErrorTypeWarning := TRUE);\n")]
    [InlineData("%LANG FBD\nNETWORK\n  g1 := (A AND B);\n  g2 := (g1 OR C);\n  result := g2;\n")]
    [InlineData("%LANG FBD\nNETWORK\n  t1(IN := start, PT := pt);\n  running := t1.Q;\n  elapsed := t1.ET;\n")]
    [InlineData("%LANG FBD\nNETWORK \"my label\"\n  g1 := (a OR b);\n  out := g1;\n")]
    public void Vg_text_is_a_fixed_point(string vg) => Assert.Equal(vg, Round(vg));

    [Theory]
    [InlineData("%LANG FBD\nNETWORK\n  result := A AND B OR C;\n")]   // multi-operator in one statement
    [InlineData("%LANG FBD\n  x := y;\n")]                            // statement before any NETWORK
    public void Non_convertible_input_is_rejected(string vg)
        => Assert.ThrowsAny<System.Exception>(() => VgParser.Parse(vg));
}
