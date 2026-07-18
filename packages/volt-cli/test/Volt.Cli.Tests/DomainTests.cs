using System.IO;
using Volt.Bridge.Core.Wire;
using Volt.Cli.Sync;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>The data/IO layer: extension registry, item↔file materialization, config + sidecar persistence.
/// C# port coverage of volt-git's extensions/materialize/config/sidecar.</summary>
public class DomainTests
{
    [Fact]
    public void Extensions_lookups_match_the_registry()
    {
        Assert.Equal("FB_Motor.fb", Extensions.FullNameFromPath("POUs/FB_Motor.fb"));
        Assert.Equal("prg", Extensions.DefFromName("PLC_PRG.prg")!.Ext);
        Assert.True(Extensions.IsPushable("POUs/FB_Motor.fb"));                 // source = rw
        Assert.True(Extensions.IsReadOnly("Library Manager/Standard.library")); // reference = r
        Assert.False(Extensions.IsPushable("Library Manager/Standard.library"));
        Assert.True(Extensions.IsTrackedPath("Some/Folder/.gitkeep"));          // folder marker
        Assert.True(Extensions.IsTrackedPath(".gitattributes"));
        Assert.Null(Extensions.FullNameFromPath("README.md"));                  // untracked extension
        Assert.Equal("* text=auto eol=lf\n", Extensions.GitattributesContent());
    }

    [Fact]
    public void Materialize_maps_a_source_item_to_a_file_and_back()
    {
        var files = Materialize.MaterializeItem(new FetchedItem { Name = "FB_Motor.fb", Folder = "POUs", SourceText = "FUNCTION_BLOCK FB_Motor\n" });
        var f = Assert.Single(files);
        Assert.Equal("POUs/FB_Motor.fb", f.Path);
        Assert.Equal("FUNCTION_BLOCK FB_Motor\n", f.Content);

        var item = Materialize.PathToItem("POUs/FB_Motor.fb");
        Assert.NotNull(item);
        Assert.Equal("FB_Motor.fb", item!.Value.Name);
        Assert.Equal("POUs", item.Value.Folder);
        Assert.Null(Materialize.PathToItem("README.md")); // untracked
    }

    [Fact]
    public void Config_roundtrips_and_reads_camelCase_json()
    {
        var root = TestUtil.NewRepo();
        try
        {
            Assert.False(Config.ConfigExists(root));
            var cfg = new WorkspaceConfig
            {
                Bridge = new() { Port = 8556 },
                Project = new() { Platform = "codesys", ProjectName = "Demo" },
                LinkedAt = "2026-07-18T00:00:00Z",
            };
            Config.SaveConfig(root, cfg);
            Assert.True(Config.ConfigExists(root));

            // Byte-compatible with the TS backup: the on-disk keys are camelCase.
            var raw = File.ReadAllText(Config.Paths(root).ConfigPath);
            Assert.Contains("\"projectName\": \"Demo\"", raw);
            Assert.Contains("\"port\": 8556", raw);

            var loaded = Config.LoadConfig(root);
            Assert.Equal(8556, loaded.Bridge.Port);
            Assert.Equal("codesys", loaded.Project.Platform);
            Assert.Equal("Demo", loaded.Project.ProjectName);
            Assert.Equal(8556, Config.ConfiguredBridgePort(root));

            // Binding checks against a health payload.
            var ok = new HealthResponse { Platform = "codesys", ProjectName = "Demo", Connected = true };
            Assert.Null(Config.ProjectMismatch(loaded, ok));
            Assert.Null(Config.VerifyBinding(loaded, ok));
            var wrong = new HealthResponse { Platform = "codesys", ProjectName = "Other", Connected = true };
            Assert.NotNull(Config.ProjectMismatch(loaded, wrong));
            Assert.NotNull(Config.VerifyBinding(loaded, wrong));
        }
        finally { TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Sidecar_roundtrips()
    {
        var root = TestUtil.NewRepo();
        try
        {
            Assert.Null(Sidecar.LoadIdeRefs(root)); // none before the first pull
            var refs = new IdeRefs
            {
                ProjectVersion = "v1",
                Items = new() { ["FB_Motor.fb"] = "h1", ["PLC_PRG.prg"] = "h2" },
                Folders = new() { ["FB_Motor.fb"] = "POUs" },
            };
            Sidecar.SaveIdeRefs(root, refs);
            var loaded = Sidecar.LoadIdeRefs(root)!;
            Assert.Equal("v1", loaded.ProjectVersion);
            Assert.Equal("h1", loaded.Items["FB_Motor.fb"]);
            Assert.Equal("POUs", loaded.Folders["FB_Motor.fb"]);
        }
        finally { TestUtil.ForceDelete(root); }
    }
}
