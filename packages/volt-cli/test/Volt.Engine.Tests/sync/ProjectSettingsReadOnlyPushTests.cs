using System.Collections.Generic;
using System.Linq;
using Xunit;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Volt.Tests.Shared;

namespace Volt.Engine.Tests;

/// <summary>
/// `Project Settings.projectsettings` is READ-ONLY on the wire, whichever vendor materialized it (openspec
/// <c>twincat-project-settings</c> 2.2: "read-only like on CODESYS — a push of it is refused by name").
///
/// <para>The CLI refuses it first, by extension (<c>Extensions.IsReadOnly</c>; <c>PushCommandTests</c>). This is the
/// bridge's half, vendor-blind in the shared engine: an op that reaches the pipe anyway — another client, a hand-built
/// request — is refused naming the item, and nothing is created or written in the IDE.</para>
/// </summary>
public class ProjectSettingsReadOnlyPushTests
{
    private const string Descriptor = "Disabled warnings:     C0371\nReplace constants:     off\n";

    [Fact]
    public void A_set_of_the_descriptor_is_refused_by_name_and_writes_nothing()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "", ""));
        var refs = RefsService.Handle(ide);

        var resp = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp> { new SetItemOp { Name = "Project Settings.projectsettings", SourceText = Descriptor } },
        });

        Assert.False(resp.Accepted);
        var refused = Assert.Single(resp.Conflicts!);
        Assert.Equal("Project Settings.projectsettings", refused.Name);
        Assert.Equal(BridgeErrorCodes.BadRequest, refused.Code);
        Assert.Contains("'Project Settings.projectsettings' is read-only", refused.Reason);
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("create") || r.StartsWith("writecontent:"));
    }

    /// <summary>Renaming a source item ONTO the read-only name is the same push, and refused the same way.</summary>
    [Fact]
    public void A_rename_onto_the_descriptor_name_is_refused_by_name()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "", ""));
        var refs = RefsService.Handle(ide);

        var resp = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                new SetItemOp { Name = "PLC_PRG.pou", ToName = "Project Settings.projectsettings", IfVersion = refs.Items["PLC_PRG.pou"] },
            },
        });

        Assert.False(resp.Accepted);
        Assert.Contains("'Project Settings.projectsettings' is read-only", Assert.Single(resp.Conflicts!).Reason);
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("rename:"));
    }
    /// <summary>A DELETE of a read-only descriptor is refused in the pre-flight too, by name, and nothing in the batch
    /// lands. It used to pass the pre-flight (only sets were checked), so the batch's earlier ops were written and the
    /// delete then reached the vendor object — on TwinCAT the synthesized item's marker, whose parent read throws an
    /// unnamed binder error; on CODESYS the live descriptor object, removed.</summary>
    [Theory]
    [InlineData("Project Settings", ItemKind.PlcProjectSettings, "Project Settings.projectsettings", "")]
    [InlineData("Standard", ItemKind.PlcLibRef, "Standard.library", "Library Manager")]
    public void A_delete_of_a_read_only_descriptor_is_refused_by_name_and_nothing_lands(
        string bare, int code, string wireName, string folder)
    {
        var ide = new FakeIde(
            FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "", ""),
            new FakeIde.Item(bare, code, folder, true, Descriptor, null, null, null));
        var refs = RefsService.Handle(ide);
        Assert.True(refs.Items.ContainsKey(wireName), $"the double must publish {wireName}");

        var resp = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                new SetItemOp
                {
                    Name = "PLC_PRG.pou", IfVersion = refs.Items["PLC_PRG.pou"],
                    SourceText = "PROGRAM PLC_PRG\nVAR\nEND_VAR\nIMPLEMENTATION ST\nx := 2;\nEND_PROGRAM\n",
                },
                new DeleteItemOp { Name = wireName, IfVersion = refs.Items[wireName] },
            },
        });

        Assert.False(resp.Accepted);
        var refused = Assert.Single(resp.Conflicts!, c => c.Name == wireName);
        Assert.Equal(BridgeErrorCodes.BadRequest, refused.Code);
        Assert.Contains($"'{wireName}' is read-only", refused.Reason);
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("delete") || r.StartsWith("writecontent:") || r.StartsWith("write:")
            || r.StartsWith("decl:") || r.StartsWith("create"));
    }
}
