using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Volt.Engine.Format.Network;
using Volt.Engine.Format.St;
using Volt.Engine.Ide;
using Volt.Engine.Item;

namespace Volt.Tests.Shared;

/// <summary>
/// THE LSP CORPUS AS PROJECTS (<c>packages/volt-lsp-iec/test-corpus</c>, six real projects as <c>volt pull</c> wrote
/// them): each project's items by bare name, and the scope a push reads a body against — built from the project's own
/// declarations. Shared by the model round-trip oracle (engine suite) and the NWL completeness oracle (the driver
/// suites), so both read a body against the same declarations.
/// </summary>
public static class CorpusProjects
{
    /// <summary>The CLI package root (the directory holding <c>Volt.sln</c>) above the test assembly.</summary>
    public static DirectoryInfo CliRoot() => RepoPaths.PackageDir();

    /// <summary>The corpus root, <c>packages/volt-lsp-iec/test-corpus</c>.</summary>
    public static string CorpusRoot()
    {
        var corpus = Path.GetFullPath(Path.Combine(CliRoot().FullName, "..", "volt-lsp-iec", "test-corpus"));
        if (!Directory.Exists(corpus)) throw new InvalidOperationException("missing LSP corpus at " + corpus);
        return corpus;
    }

    /// <summary>Whether the file materializes a LIBRARY's item. The IDE's walk (<see cref="ItemLookup.All"/>) stops at
    /// the library manager — it is a top-level item itself — so a library's POUs are no declaration a driver's
    /// <see cref="ProjectDeclarations"/> answers; and they are written without an implementation marker, so the ST
    /// reader could not split one anyway. CODESYS materializes them under <c>Library Manager/</c>, TwinCAT under
    /// <c>References/</c>.</summary>
    public static bool InLibrary(string file) =>
        file.Replace('\\', '/').Split('/').Any(s => s is "Library Manager" or "References");

    public static string? KindOf(string file) => ItemKind.KindForWireName(Path.GetFileName(file));

    public static ItemContent Split(string file) => StReader.Read(File.ReadAllText(file), KindOf(file));
}

/// <summary>One corpus project's items by bare name (the file's stem), each declaration read the first time it is
/// asked for — the corpus stand-in for a driver's <see cref="ProjectDeclarations"/>, whose first item of a name wins
/// as here (path order). The corpus IS each project's pulled workspace, so its files are the declarations the pull
/// wrote every body against.</summary>
public sealed class CorpusProject
{
    readonly Dictionary<string, string> _files = new(StringComparer.OrdinalIgnoreCase);
    readonly Dictionary<string, string> _libraryPous = new(StringComparer.OrdinalIgnoreCase);
    readonly Dictionary<string, string?> _declarations = new(StringComparer.OrdinalIgnoreCase);
    List<string>? _globals;

    public CorpusProject(IEnumerable<string> files)
    {
        foreach (var f in files.OrderBy(f => f, StringComparer.Ordinal))
        {
            var stem = Path.GetFileNameWithoutExtension(f);
            if (CorpusProjects.InLibrary(f))
            {
                if (CorpusProjects.KindOf(f) is ItemKind.Kinds.Pou && !_libraryPous.ContainsKey(stem)) _libraryPous[stem] = f;
                continue;
            }
            if (CorpusProjects.KindOf(f) is ItemKind.Kinds.Pou or ItemKind.Kinds.Interface or ItemKind.Kinds.Gvl or ItemKind.Kinds.Dut)
                if (!_files.ContainsKey(stem)) _files[stem] = f;   // the first of a name wins (net48 has no TryAdd)
        }
    }

    /// <summary>A referenced library's FUNCTION BLOCK as the IDE's signature states it — the corpus holds each library's
    /// signatures as the pull rendered them (<c>Library Manager/</c>, <c>References/</c>): its outputs give a <c>.name</c>
    /// read's slot (ld-fbd-coverage 2R.6b). A library FUNCTION answers nothing here: the corpus oracles were measured
    /// without the libraries' functions (2R.4b derives them live).</summary>
    public Callee? LibraryBlock(string name)
    {
        if (!_libraryPous.TryGetValue(name, out var f)) return null;
        var source = File.ReadAllText(f).Replace("\r\n", "\n");
        var header = source.TrimStart().Split('\n')[0];
        if (!header.StartsWith("FUNCTION_BLOCK", StringComparison.OrdinalIgnoreCase)) return null;
        return new Callee(Callee.FunctionBlockCallType, StDeclaration.InputNames(source), StDeclaration.OutputNames(source));
    }

    /// <summary>Every file of the project directory <paramref name="root"/>.</summary>
    public static CorpusProject At(string root) =>
        new(Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories));

    public string? DeclarationOf(string name)
    {
        if (_declarations.TryGetValue(name, out var hit)) return hit;
        var declaration = _files.TryGetValue(name, out var f) ? CorpusProjects.Split(f).Declaration : null;
        return _declarations[name] = string.IsNullOrWhiteSpace(declaration) ? null : declaration;
    }

    /// <summary>The project's file of the item named <paramref name="name"/>, or null when it holds none.</summary>
    public string? FileOf(string name) => _files.TryGetValue(name, out var f) ? f : null;

    /// <summary>The wire kind of the project's item of that name — its file's extension, as a push's wire name
    /// states it — or null when the project holds none.</summary>
    public string? KindOfName(string name) => _files.TryGetValue(name, out var f) ? CorpusProjects.KindOf(f) : null;

    public IEnumerable<string> Globals() =>
        _globals ??= _files.Where(kv => CorpusProjects.KindOf(kv.Value) == ItemKind.Kinds.Gvl)
            .Select(kv => DeclarationOf(kv.Key) ?? "").ToList();

    /// <summary>The scope a push reads a body against whose own declarations are <paramref name="declaration"/>.</summary>
    public NetworkScope Scope(string? declaration) =>
        NetworkScope.FromDeclarations(declaration, DeclarationOf, Globals, KindOfName, Scopes.RefusedPouName, LibraryBlock);
}
