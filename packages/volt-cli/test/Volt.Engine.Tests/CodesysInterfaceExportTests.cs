using System.IO;
using System.Linq;
using Volt.Engine.Body;
using Xunit;
using Volt.Engine.PlcOpen;

namespace Volt.Cli.Tests;

/// <summary>
/// IDE GROUND TRUTH: what CODESYS's own <c>export_xml</c> produces for an INTERFACE, captured live from
/// 3.5.21.40 against the corpus project.
/// <para>
/// This retired <c>CodesysObjectModel.ExportInterfaceXml</c>, a hand-built PLCopen document justified by
/// "CODESYS export_xml REJECTS IInterfaceObject — it only accepts IPOUObject". That is false: all 31
/// interfaces in the corpus export, and re-import with their children intact. The replacement then survived
/// one round as a thin wrapper making the same call under its own name, and an interface-only fork in
/// <c>ReadXml</c> to reach it; BOTH are now gone too, so an interface has no separate read path at all —
/// every kind goes through <c>ExportXmlWithChildren</c>. These fixtures are what makes that safe to assert.
/// Two consequences they pin, because both were stated the other way round in the code:
/// </para>
/// <list type="number">
/// <item><description>CODESYS emits an interface with <b>NO <c>&lt;pou&gt;</c> element at all</b> — it is
/// <c>&lt;addData&gt;/&lt;data&gt;/&lt;Interface&gt;</c> with <c>&lt;Methods&gt;</c>/<c>&lt;Properties&gt;</c>.
/// <see cref="PouReader"/> already handles exactly this, via the branch documented as
/// "TwinCAT … so this fallback is TC-only and never changes the CODESYS path". It is NOT TC-only: both
/// vendors emit the same shape, which is why the parser needs no change to serve the real export.</description></item>
/// <item><description>The real export CARRIES interface properties and their accessors
/// (<c>&lt;Property&gt;</c> + <c>&lt;GetAccessor&gt;</c>). The hand-built document deliberately omitted them
/// ("A &lt;Property&gt; element here would be written and never read"), which is what forced the separate COM
/// read. Reading the real export is therefore strictly MORE information, not less.</description></item>
/// </list>
/// <para>Recursion is load-bearing: the same interface exported non-recursively contains 0 methods and
/// 0 properties. The fixtures are the RECURSIVE exports, which is what the driver must ask for.</para>
/// </summary>
public class CodesysInterfaceExportTests
{
    private static string Fixture(string name) =>
        File.ReadAllText(Path.Combine(System.AppContext.BaseDirectory, "fixtures", "codesys-itf", name));

    /// <summary>`IModuleManager` — two methods and one get-only property, straight off the live IDE.</summary>
    [Fact]
    public void Real_codesys_interface_export_parses_without_a_pou_element()
    {
        var xml = Fixture("IModuleManager.plcopen.xml");
        Assert.DoesNotContain("<pou ", xml);           // the shape claim: CODESYS emits no <pou> for an interface

        var parsed = PouReader.Parse(xml);

        Assert.NotNull(parsed.Declaration);
        Assert.Contains("INTERFACE", parsed.Declaration!);
        var methods = parsed.Children.Where(c => c.PouType == "method").Select(c => c.Name).ToList();
        Assert.Contains("Register", methods);
        Assert.Contains("Unregister", methods);
    }

    /// <summary>Method DECLARATIONS survive — they are what the LSP resolves an interface call against.</summary>
    [Fact]
    public void Interface_method_declarations_come_through_the_export()
    {
        var parsed = PouReader.Parse(Fixture("IModuleManager.plcopen.xml"));
        var register = parsed.Children.Single(c => c.Name == "Register");
        Assert.NotNull(register.Declaration);
        Assert.Contains("METHOD Register", register.Declaration!);
        Assert.Contains("thingToRegister", register.Declaration!);   // the input var, not just the signature line
    }

    /// <summary>The accessor shape the hand-built document dropped — asserted through the PRODUCTION reader
    /// (<see cref="PouReader"/>), which is what materialize now uses. A null accessor means ABSENT; an
    /// empty one means present-but-bodiless, which is what an interface accessor is. Collapsing those two would
    /// make a push delete the user's getter, so the distinction is asserted, not assumed.</summary>
    [Fact]
    public void Interface_property_accessors_are_in_the_real_export()
    {
        var props = PouReader.Parse(Fixture("IModuleManager.plcopen.xml")).Properties;
        var moduleHandler = props.Single(p => p.Name == "ModuleHandler");
        Assert.NotNull(moduleHandler.GetterCode);   // declares a getter...
        Assert.Equal("", moduleHandler.GetterCode); // ...that is declaration-only, as interface accessors are
        Assert.Null(moduleHandler.SetterCode);      // and NO setter — the get-only case the Beckhoff bug was about
    }

    /// <summary>A methods-only interface: seven methods, no properties. Guards the property-less path.</summary>
    [Fact]
    public void A_methods_only_interface_yields_all_of_them()
    {
        var parsed = PouReader.Parse(Fixture("methods-only.plcopen.xml"));
        var methods = parsed.Children.Where(c => c.PouType == "method").ToList();
        Assert.Equal(7, methods.Count);
        Assert.All(methods, m => Assert.False(string.IsNullOrWhiteSpace(m.Declaration)));
    }
}
