using System.IO;
using Volt.Cli.Sync;
using Volt.Wire;
using Xunit;
using Volt.Contracts;

namespace Volt.Cli.Tests;

/// <summary>The data/IO layer: extension registry, item↔file materialization, config + sidecar persistence.
/// C# port coverage of volt-git's extensions/materialize/config/sidecar.</summary>
public class DomainTests
{
    [Fact]
    public void Extensions_lookups_match_the_registry()
    {
        Assert.Equal("FB_Motor.pou", Extensions.FullNameFromPath("POUs/FB_Motor.pou"));
        Assert.True(Extensions.IsPushable("POUs/FB_Motor.pou"));                 // source = rw
        Assert.True(Extensions.IsReadOnly("Library Manager/Standard.library")); // reference = r
        Assert.False(Extensions.IsPushable("Library Manager/Standard.library"));
        // A `.gitkeep` is NOT tracked: no Volt extension names it, so a push refuses it by name like any other file.
        Assert.False(Extensions.IsTrackedPath("Some/Folder/.gitkeep"));
        Assert.True(Extensions.IsTrackedPath(".gitattributes"));
        Assert.Null(Extensions.FullNameFromPath("README.md"));                  // untracked extension
        Assert.Equal("* text=auto eol=lf\n", Extensions.GitattributesContent());
    }

    [Fact]
    public void Materialize_maps_a_source_item_to_a_file_and_back()
    {
        // The wire name IS the item's path (openspec multi-application-tree): the file is written at it, and read back as it.
        var files = Materialize.MaterializeItem(new FetchedItem { Name = "POUs/FB_Motor.pou", SourceText = "FUNCTION_BLOCK FB_Motor\n" });
        var f = Assert.Single(files);
        Assert.Equal("POUs/FB_Motor.pou", f.Path);
        Assert.Equal("FUNCTION_BLOCK FB_Motor\n", f.Content);

        Assert.Equal("POUs/FB_Motor.pou", Materialize.PathToItem("POUs/FB_Motor.pou"));
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
                Bridge = new() { Vendor = "codesys" },
                Project = new() { Platform = "codesys", ProjectName = "Demo" },
                LinkedAt = "2026-07-18T00:00:00Z",
            };
            Config.SaveConfig(root, cfg);
            Assert.True(Config.ConfigExists(root));

            // Byte-compatible with the TS backup: the on-disk keys are camelCase.
            var raw = File.ReadAllText(Config.Paths(root).ConfigPath);
            Assert.Contains("\"projectName\": \"Demo\"", raw);
            Assert.Contains("\"vendor\": \"codesys\"", raw);

            var loaded = Config.LoadConfig(root);
            Assert.Equal("codesys", loaded.Bridge.Vendor);
            Assert.Equal("codesys", loaded.Project.Platform);
            Assert.Equal("Demo", loaded.Project.ProjectName);
            Assert.Equal("codesys", Config.ConfiguredVendor(root));

            // Binding checks against a health payload.
            var ok = new HealthResponse { Projects = { new ProjectEntry("codesys", "Demo", HealthStatus.Healthy, false) } };
            Assert.Null(Config.ProjectMismatch(loaded, ok));
            var wrong = new HealthResponse { Projects = { new ProjectEntry("codesys", "Other", HealthStatus.Healthy, false) } };
            Assert.NotNull(Config.ProjectMismatch(loaded, wrong));
        }
        finally { TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void SaveConfig_never_shows_a_reader_a_partial_file()
    {
        // The frontends (volt-control `readBridgeVendor`, the LSP's `binding.ts`) read the binding while `volt init` or a
        // rebind writes it, and refuse a binding that is not JSON by name. A truncate-then-write (`File.WriteAllText`)
        // showed them an empty or half-written file; the write is a temp file renamed over the binding. The reader opens
        // the way Node does (share read/write/delete), so the rename is never blocked by it.
        var root = TestUtil.NewRepo();
        try
        {
            WorkspaceConfig Cfg(int i) => new()
            {
                Bridge = new() { Vendor = "codesys" },
                Project = new() { Platform = "codesys", ProjectName = "Demo" + new string('x', i % 4096) },
                LinkedAt = "2026-10-12T00:00:00Z",
            };
            Config.SaveConfig(root, Cfg(0));
            var path = Config.Paths(root).ConfigPath;
            var stop = false;
            var partial = new List<string>();
            var reader = new Thread(() =>
            {
                while (!Volatile.Read(ref stop))
                {
                    string text;
                    try
                    {
                        using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                        text = new StreamReader(fs).ReadToEnd();
                    }
                    catch (IOException) { continue; } // between the rename's unlink and link: no file, not a partial one
                    try { System.Text.Json.JsonDocument.Parse(text).Dispose(); }
                    catch (System.Text.Json.JsonException) { lock (partial) partial.Add(text); }
                }
            });
            reader.Start();
            var until = DateTime.UtcNow.AddSeconds(2);
            for (var i = 1; DateTime.UtcNow < until; i++) Config.SaveConfig(root, Cfg(i * 997));
            Volatile.Write(ref stop, true);
            Assert.True(reader.Join(TimeSpan.FromSeconds(10)), "reader thread did not stop");
            Assert.Empty(partial);
            Assert.Equal(new[] { path }, Directory.GetFiles(Config.Paths(root).StateDir)); // no temp file left
        }
        finally { TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void ConfigExists_is_folder_local_not_ancestor_walk()
    {
        // Regression: an empty subfolder under an initialized repo used to report "already initialized"
        // because ResolveGitDir walks up and found the ancestor's .git/volt/config.json.
        var root = TestUtil.NewRepo();
        try
        {
            Config.SaveConfig(root, new WorkspaceConfig
            {
                Bridge = new() { Vendor = "codesys" },
                Project = new() { Platform = "codesys", ProjectName = "Demo" },
                LinkedAt = "2026-07-25T00:00:00Z",
            });
            Assert.True(Config.ConfigExists(root));

            var sub = Directory.CreateDirectory(Path.Combine(root, "empty-sub")).FullName;
            Assert.False(Config.ConfigExists(sub)); // not its own repo root → not initialized here
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
                Items = new() { ["POUs/FB_Motor.pou"] = "h1", ["PLC_PRG.pou"] = "h2" },
                Applications = new() { "Device/Plc Logic/Application" },
            };
            Sidecar.SaveIdeRefs(root, refs);
            var loaded = Sidecar.LoadIdeRefs(root)!;
            Assert.Equal("v1", loaded.ProjectVersion);
            Assert.Equal("h1", loaded.Items["POUs/FB_Motor.pou"]);
            Assert.Equal(new[] { "Device/Plc Logic/Application" }, loaded.Applications);
        }
        finally { TestUtil.ForceDelete(root); }
    }
}
