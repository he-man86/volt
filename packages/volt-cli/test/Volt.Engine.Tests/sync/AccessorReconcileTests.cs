using System.Linq;
using Xunit;
using Volt.Contracts;
using Volt.Engine.Sync;
using Volt.Engine.Item;

namespace Volt.Engine.Tests;

/// <summary>
/// A PROPERTY'S ACCESSORS ARE RECONCILED TO THE PUSHED SOURCE — presence is the object.
///
/// <para><c>PushService.ReconcileAccessor</c> is the only thing that makes a GET or a SET come into existence,
/// or stop existing, to match what the engineer wrote. It had no offline test on any layer. That matters more
/// than most gaps because BOTH of its failure modes are SILENT: a dropped accessor that is not deleted leaves
/// the property running its old code while the push reports "updated", and an added accessor that is not
/// created leaves TwinCAT's property empty — it makes properties with no accessors at all, so a pushed
/// <c>GET … END_GET</c> has nothing to be written into.</para>
///
/// <para>The two vendors differ here on purpose (the divergence `ReconcileAccessor`'s own doc-comment names):
/// TwinCAT NEEDS the create, CODESYS makes both accessors with the property and exposes no call to add one,
/// so its driver refuses the create by name. That asymmetry is below this layer — what these pin is that the
/// engine ASKS for the right thing, which is the half a driver cannot compensate for.</para>
/// </summary>
public class AccessorReconcileTests
{
    private const string Decl = "FUNCTION_BLOCK FB_Prop\nVAR\n\t_v : INT;\nEND_VAR";

    /// <summary>A POU carrying one property, with whichever accessors are named.</summary>
    private static FakeIde WithProperty(params string[] accessors)
    {
        var items = new System.Collections.Generic.List<FakeIde.Item>
        {
            new("FB_Prop", ItemKind.PlcPouFb, "", true, Decl, "", null, null, Children: new[] { "Val" }),
            new("Val", ItemKind.PlcProp, "", false, "PROPERTY Val : INT", null, null, null,
                Children: accessors.Length == 0 ? null : accessors),
        };
        items.AddRange(accessors.Select(a =>
            new FakeIde.Item(a, a == "Get" ? ItemKind.PlcPropGet : ItemKind.PlcPropSet, "", false,
                             $"VAR\nEND_VAR", a == "Get" ? "Val := _v;" : "_v := Val;", null, null)));
        return new FakeIde(items.ToArray());
    }

    /// <summary>The pushed document: a POU whose property declares exactly the accessors given.</summary>
    private static string Source(bool get, bool set)
    {
        var body = $"{Decl}\nEND_FUNCTION_BLOCK\n\nPROPERTY Val : INT\n";
        if (get) body += "GET\nVAR\nEND_VAR\nVal := _v;\nEND_GET\n";
        if (set) body += "SET\nVAR\nEND_VAR\n_v := Val;\nEND_SET\n";
        return body + "END_PROPERTY\n";
    }

    private static PushResponse Push(FakeIde ide, string source)
    {
        var refs = RefsService.Handle(ide);
        return PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new System.Collections.Generic.List<PushOp>
            {
                new SetItemOp
                {
                    Name = "FB_Prop.fb",
                    IfVersion = refs.Items["FB_Prop.fb"],
                    SourceText = source,
                },
            },
        });
    }

    /// <summary>DROPPING A SET FROM THE SOURCE DELETES IT.
    ///
    /// <para>THE FAILURE THIS PINS is the worst class there is: accepted, and landed nothing. The engineer
    /// removes the setter, the push reports applied, and the SET stays in the project — still compiled, still
    /// writable from HMI or another POU, running the code they thought they had deleted. `volt status` then
    /// reports in sync, because the receipt was baked from the pushed text.</para></summary>
    [Fact]
    public void A_dropped_accessor_is_deleted()
    {
        var ide = WithProperty("Get", "Set");

        Assert.True(Push(ide, Source(get: true, set: false)).Accepted);

        Assert.Contains("delete:Set", ide.Recorded);
        Assert.DoesNotContain("delete:Get", ide.Recorded);
    }

    /// <summary>AND AN ADDED ONE IS CREATED, with the accessor's own kind code.
    ///
    /// <para>The kind matters as much as the call: TwinCAT creates the child from the code it is handed, so a
    /// GET created as a SET is a property that compiles and computes nothing.</para></summary>
    [Fact]
    public void An_added_accessor_is_created_with_its_own_kind()
    {
        var ide = WithProperty("Get");

        Assert.True(Push(ide, Source(get: true, set: true)).Accepted);

        Assert.Contains("create:Set", ide.Recorded);
        Assert.Equal(ItemKind.PlcPropSet, ide.CreatedKinds["Set"]);
    }

    /// <summary>AND A PROPERTY THAT ALREADY MATCHES IS NOT TOUCHED. The no-op case is the one that runs on
    /// almost every push, and a reconciler that deletes-and-recreates to reach the same state would churn every
    /// accessor's ids on every push while looking perfectly correct from the outside.</summary>
    [Fact]
    public void A_matching_property_is_left_alone()
    {
        var ide = WithProperty("Get", "Set");

        Assert.True(Push(ide, Source(get: true, set: true)).Accepted);

        Assert.DoesNotContain(ide.Recorded, r => r is "create:Get" or "create:Set"
                                                   or "delete:Get" or "delete:Set");
    }

    /// <summary>BOTH ACCESSORS RECONCILE IN ONE PUSH, and this is where the re-find lives.
    ///
    /// <para>Creating the GET invalidates the property handle on the stricter vendor (TwinCAT: a create kills
    /// every handle), so the SET's reconciliation runs against a handle the create already killed unless the
    /// property is re-found in between. `FakeIde.HandlesSurviveStructureChange` defaults to FALSE precisely so
    /// a test that does not think about it takes the re-find path — this one does think about it, and asserts
    /// the far side lands anyway.</para></summary>
    [Fact]
    public void Both_accessors_reconcile_across_the_handle_invalidating_create()
    {
        var ide = WithProperty();               // a property with NO accessors — TwinCAT's create shape
        Assert.False(ide.HandlesSurviveStructureChange);

        Assert.True(Push(ide, Source(get: true, set: true)).Accepted);

        Assert.Contains("create:Get", ide.Recorded);
        Assert.Contains("create:Set", ide.Recorded);
    }

    /// <summary>A PROPERTY THE PROJECT LACKS IS CREATED, AND ITS ACCESSORS WITH IT.
    ///
    /// <para>Creating a member the pushed source declares is the push service's job — both drivers say so by
    /// name when they refuse to do it themselves. So the whole chain has to run inside one push: create the
    /// property, then reconcile the GET and the SET onto a thing that did not exist a moment earlier.</para>
    ///
    /// <para>The lookup that follows the create must FIND, never find-or-create. It used to go through
    /// `ResolveFolder`, which creates: a pushed `%FOLDER` that did not match where the property actually sits
    /// made a real empty folder inside the engineer's POU, missed the property inside the folder it had just
    /// made, and `continue`d — silently skipping the reconciliation while reporting the push applied. No
    /// folder is pushed here, so no folder may be created.</para></summary>
    [Fact]
    public void A_property_the_project_lacks_is_created_with_its_accessors()
    {
        // The POU declares the property in its source; the project does not carry it yet.
        var ide = new FakeIde(
            new FakeIde.Item("FB_Prop", ItemKind.PlcPouFb, "", true, Decl, "", null, null));

        Assert.True(Push(ide, Source(get: true, set: true)).Accepted);

        Assert.Contains("create:Val", ide.Recorded);
        Assert.Equal(ItemKind.PlcProp, ide.CreatedKinds["Val"]);
        Assert.Contains("create:Get", ide.Recorded);
        Assert.Contains("create:Set", ide.Recorded);
        Assert.DoesNotContain(ide.CreatedKinds, k => k.Value == ItemKind.PlcFolder);
    }
}
