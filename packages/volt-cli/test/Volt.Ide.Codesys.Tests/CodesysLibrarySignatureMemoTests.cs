using System;
using System.Collections.Generic;
using Volt.Engine.Library;
using Xunit;

namespace Volt.Ide.Codesys.Tests
{
    /// <summary>
    /// A graphical body calling a LIBRARY block (<c>t1 : TON</c>) asked for the library signatures on every operation,
    /// and on CODESYS every extraction is a <c>Build</c> of every application: each <c>refs</c> compiled the project
    /// (1-2.5 s for one tiny FBD method, 5-9 s per push — the live e2e test that held such a body crossed its 30 s
    /// budget and left the IDE building, so the next eleven tests were refused IDE_BUSY). The extraction is reused while
    /// the walked libraries are unchanged.
    /// </summary>
    public class CodesysLibrarySignatureMemoTests
    {
        private static readonly object Project = new();
        private static readonly IReadOnlyList<LibSignature> Sigs = Array.Empty<LibSignature>();

        private static string? Key(bool complete = true, string manifest = "Standard, 3.5.21.0 (System)") =>
            LibrarySignatureMemo.KeyOf(new[] { ("Device/Plc Logic/Application/Library Manager", manifest) }, complete);

        [Fact]
        public void The_same_libraries_extract_once()
        {
            var memo = new LibrarySignatureMemo();
            int builds = 0;
            for (int i = 0; i < 3; i++) memo.Get(Project, Key(), () => { builds++; return Sigs; });
            Assert.Equal(1, builds);
        }

        [Fact]
        public void A_moved_library_extracts_again()
        {
            var memo = new LibrarySignatureMemo();
            int builds = 0;
            memo.Get(Project, Key(), () => { builds++; return Sigs; });
            memo.Get(Project, Key(manifest: "Standard, 3.5.22.0 (System)"), () => { builds++; return Sigs; });
            Assert.Equal(2, builds);
        }

        [Fact]
        public void Another_project_extracts_again()
        {
            var memo = new LibrarySignatureMemo();
            int builds = 0;
            memo.Get(Project, Key(), () => { builds++; return Sigs; });
            memo.Get(new object(), Key(), () => { builds++; return Sigs; });
            Assert.Equal(2, builds);
        }

        [Fact]
        public void A_walk_that_did_not_read_every_library_manager_states_no_key_and_never_reuses()
        {
            Assert.Null(Key(complete: false));
            var memo = new LibrarySignatureMemo();
            int builds = 0;
            for (int i = 0; i < 2; i++) memo.Get(Project, Key(complete: false), () => { builds++; return Sigs; });
            Assert.Equal(2, builds);
        }
    }
}
