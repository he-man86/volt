using System.Globalization;
using System.Reflection;
using System.Text.RegularExpressions;
using Volt.Engine.Format.St;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// A VAR BLOCK OPENS UNDER A TURKISH CULTURE TOO (environment audit, 2026-10-13). <c>StReader</c>'s <c>VarOpener</c>
/// (<c>^\s*VAR(_[A-Z]+)?\b</c>, IgnoreCase) decides whether a line inside a property accessor opens a VAR block — and so
/// whether a variable named <c>SET</c> or <c>GET</c> in it reads as an accessor keyword. Folded by the tr-TR culture,
/// <c>[A-Z]</c> pairs <c>I</c> with dotless <c>ı</c> and <c>i</c> with dotted <c>İ</c>, so a lowercase
/// <c>var_input</c> / <c>var_inst</c> (legal ST) is not a VAR line on a Turkish machine. The regex is rebuilt here
/// from the reader's own pattern and options under tr-TR, the way its static initializer would on such a machine.
/// (Gate for every other site: <c>Volt.Repo.Gates/CaseInsensitiveRegexIsCultureInvariantTests</c>.)
/// </summary>
public class TurkishCultureVarOpenerTests
{
    [Theory]
    [InlineData("var_input")]
    [InlineData("var_inst")]
    [InlineData("VAR_IN_OUT")]
    [InlineData("VAR")]
    public void A_VAR_line_is_a_VAR_line_under_tr_TR(string line)
    {
        var field = typeof(StReader).GetField("VarOpener", BindingFlags.NonPublic | BindingFlags.Static)!;
        var shipped = (Regex)field.GetValue(null)!;
        var before = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo("tr-TR");
            var onTurkishWindows = new Regex(shipped.ToString(), shipped.Options);
            Assert.Matches(onTurkishWindows, line);
        }
        finally { CultureInfo.CurrentCulture = before; }
    }
}
