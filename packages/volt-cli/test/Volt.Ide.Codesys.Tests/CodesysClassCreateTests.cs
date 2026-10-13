using Volt.Engine.Ide;
using Volt.Engine.Item;
using Xunit;

namespace Volt.Ide.Codesys.Tests;

/// <summary>
/// A CLASS THE TEXT NAMES IS MADE AT THE CREATE, OR THE CREATE IS REFUSED BY NAME (openspec <c>bridge-one-to-one</c> §3,
/// DIALECT C2r) — the refusals, offline: the NVL (its factory needs its wizard), a class on a kind that has no such class,
/// and a check whose name the vendor's enum does not hold. None of them touches the IDE: each is refused before the
/// object manager is asked for anything.
/// </summary>
public class CodesysClassCreateTests
{
    private static ChildRefusedException Refused(int kindCode, ObjectClass cls) =>
        Assert.Throws<ChildRefusedException>(() =>
            new CodesysDriver(projects: null).CreateChild(new ItemRef(new object()), "X", kindCode, null, cls));

    [Fact]
    public void An_nvl_create_is_refused_naming_the_class_and_its_wizard()
    {
        var ex = Refused(ItemKind.PlcGvl, new ObjectClass(ObjectClass.Nvl, null));
        Assert.Contains("%CLASS NVL", ex.Message);
        Assert.Contains("wizard", ex.Message);
    }

    [Theory]
    [InlineData(ItemKind.PlcDut, ObjectClass.Check, "CheckBounds")]
    [InlineData(ItemKind.PlcPou, ObjectClass.TextListEnum, null)]
    [InlineData(ItemKind.PlcPou, ObjectClass.Persistent, null)]
    public void A_class_on_a_kind_that_has_none_is_refused_by_name(int kindCode, string word, string? argument)
    {
        var ex = Refused(kindCode, new ObjectClass(word, argument));
        Assert.Contains($"%CLASS {word}", ex.Message);
    }

    /// <summary>Outside a live IDE the vendor's check enum is not loaded — the create is refused naming it, never made
    /// as a plain POU.</summary>
    [Fact]
    public void A_check_function_whose_vendor_types_are_not_loaded_is_refused_by_name()
    {
        var ex = Refused(ItemKind.PlcPou, new ObjectClass(ObjectClass.Check, "CheckBounds"));
        Assert.Contains("%CLASS CHECK CheckBounds", ex.Message);
        Assert.Contains("CheckFunctionSelection", ex.Message);
    }

    /// <summary>A persistent list is created only once the completeness oracle reproduces a re-created one (design §1.1
    /// <c>VarPersistentObject</c>: its <c>dymmattributecount</c> is unmeasured) — until then the create is refused by name,
    /// never made through the factory on an unmeasured member (gate review of step 3, finding 7b).</summary>
    [Fact]
    public void A_persistent_list_create_is_refused_by_name_until_the_oracle_reproduces_one()
    {
        var ex = Refused(ItemKind.PlcGvl, new ObjectClass(ObjectClass.Persistent, null));
        Assert.Contains("%CLASS PERSISTENT", ex.Message);
        Assert.Contains("dymmattributecount", ex.Message);
    }

    /// <summary>A <c>METHOD ABSTRACT</c> with no code is created as the vendor's abstract class (§1.1, C2r: constructed, as
    /// <c>create-each-class</c> measured) — never the scripting create's plain <c>POUMethodObject</c>. Outside a live IDE the
    /// class is not loaded, so the create is refused naming it (gate review of step 3, finding 7a).</summary>
    [Fact]
    public void An_abstract_method_is_created_as_the_vendors_abstract_class()
    {
        var ex = Refused(ItemKind.PlcMethod, ObjectClass.AbstractMethodClass);
        Assert.Contains("AbstractPOUMethodObject", ex.Message);
    }
}

