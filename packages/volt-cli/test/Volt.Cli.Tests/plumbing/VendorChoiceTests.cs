using System;
using System.IO;
using Volt.Cli.Sync;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>WHICH VENDOR A VERB TALKS TO IS STATED, NEVER GUESSED (cli-bridges review B10). The binding states it, or
/// <c>--vendor</c> does; a binding that cannot be read is not "unbound", which the CLI then filled with CODESYS.</summary>
public class VendorChoiceTests
{
    [Fact]
    public void An_unbound_folder_has_no_configured_vendor()
    {
        var root = TestUtil.NewRepo();
        try { Assert.Null(Config.ConfiguredVendor(root)); }
        finally { TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void A_binding_that_cannot_be_read_is_refused_not_read_as_unbound()
    {
        var root = TestUtil.NewRepo();
        try
        {
            Config.SaveConfig(root, new WorkspaceConfig
            {
                Bridge = new() { Vendor = "twincat" },
                Project = new() { Platform = "twincat", ProjectName = "Demo" },
            });
            File.WriteAllText(Config.Paths(root).ConfigPath, "{ not json");

            var ex = Record.Exception(() => Config.ConfiguredVendor(root));

            Assert.NotNull(ex);
        }
        finally { TestUtil.ForceDelete(root); }
    }
}
