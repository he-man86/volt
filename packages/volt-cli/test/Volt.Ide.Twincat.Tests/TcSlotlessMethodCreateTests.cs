using Volt.Engine.Ide;
using Volt.Engine.Item;
using Volt.Engine.Seam;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// TWINCAT CREATES NO METHOD WITHOUT A BODY SLOT (openspec <c>language-line</c>, DIALECT C2n): a <c>METHOD ABSTRACT</c> that
/// states no <c>%LANGUAGE</c> line asks for the vendor's abstract method class (<c>ObjectClass.AbstractMethod</c>, derived by
/// <c>PushService.CreateClass</c>). CODESYS constructs one (C2r); TwinCAT has one method class (609), which always has a
/// slot, so a create would land a member whose next pull states a line its text did not. Refused by name — by the push
/// pre-flight, before the batch's first write, and by the create itself for every other caller.
/// </summary>
public class TcSlotlessMethodCreateTests
{
    private static BeckhoffDriver Driver() => new(new TcObjectModel());

    [Fact]
    public void The_pre_flight_refuses_a_method_with_no_slot_by_name()
    {
        var why = Driver().RefusedMemberCreate(ItemKind.Kinds.Method, "Take", new CreateArgs(Class: ObjectClass.AbstractMethod));

        Assert.NotNull(why);
        Assert.Contains("no METHOD without a body slot", why);
        Assert.Contains("%LANGUAGE ST", why);
    }

    [Fact]
    public void A_method_with_a_slot_passes_the_pre_flight() =>
        Assert.Null(Driver().RefusedMemberCreate(ItemKind.Kinds.Method, "Take", new CreateArgs()));

    [Fact]
    public void The_create_refuses_it_before_the_IDE_is_touched()
    {
        // The parent is no tree item: reaching TcObjectModel at all would fail on it, so the refusal proves nothing was
        // asked of the IDE.
        var ex = Assert.Throws<ChildRefusedException>(() =>
            Driver().CreateChild(new ItemRef(new object()), "Take", ItemKind.PlcMethod, null, ObjectClass.AbstractMethodClass));

        Assert.Contains("no METHOD without a body slot", ex.Message);
    }
}
