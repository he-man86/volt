// probe-bridge-bundles.cs — OFFLINE census of shipped bridge bundles (openspec ide-identity-report 3.1 / 3.2).
//
// Run (.NET 10 SDK file-based app; reads files, writes only to %TEMP%\volt-bundle-probe and the log):
//   & "C:\Program Files\dotnet\dotnet.exe" run packages/volt-cli/scripts/probe-bridge-bundles.cs -- <bundle.zip|dir>... > bridge-bundles.log
//
// WHY: both field failures name a VOLT member whose signature carries a System.Text.Json type —
//   MissingMethodException: Volt.Wire.PipeClient.Call(String, Object, Action`1[JsonElement], Int32)   (CODESYS 3.5.17)
//   MissingFieldException:  Volt.Contracts.WireJson.Write                                             (CODESYS 3.5.21.50)
// Every Volt assembly is 1.0.0.0 and unsigned, so on .NET Framework a second LoadFrom of another build's Volt.Wire
// hands back the copy already loaded. This probe asks, per bundle and across bundles, without a CODESYS:
//   1. what each bundle ships (Volt + framework assemblies: assembly version, file version, product version/commit, MVID);
//   2. whether PipeClient.Call / WireJson.Write exist in each bundle with the failing signature;
//   3. which System.Text.Json identity each Volt assembly REFERENCES vs the one the bundle SHIPS;
//   4. the cross matrix: if consumer bundle C's Volt assemblies bound provider bundle P's Volt assemblies (same
//      identity, first one wins), how many type and member references would not resolve — and whether the two failing members
//      are among them. A member that exists by name but not by signature differs in a type's ASSEMBLY identity.
// It cannot say what a 3.5.17 install loaded — only a field log's `bound:` lines can (DIALECT V3).

using System.Collections.Immutable;
using System.Diagnostics;
using System.IO.Compression;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;

var inputs = args.Where(a => a != "--").ToList();
if (inputs.Count == 0) { Console.Error.WriteLine("usage: probe-bridge-bundles.cs <bundle.zip|dir>..."); return 2; }

string[] failing = { "Volt.Wire.PipeClient::Call", "Volt.Contracts.WireJson::Write" };
var scratch = Path.Combine(Path.GetTempPath(), "volt-bundle-probe");
var bundles = new List<Bundle>();
foreach (var input in inputs)
{
    string dir;
    if (File.Exists(input) && input.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
    {
        dir = Path.Combine(scratch, Path.GetFileNameWithoutExtension(input));
        if (Directory.Exists(dir)) Directory.Delete(dir, true);
        ZipFile.ExtractToDirectory(input, dir);
    }
    else if (Directory.Exists(input)) dir = input;
    else { Console.Error.WriteLine($"not a zip or directory: {input}"); return 2; }
    bundles.Add(Bundle.Read(Path.GetFileName(input.TrimEnd('\\', '/')), dir));
}

Console.WriteLine($"# bridge bundle census — {DateTime.Now:yyyy-MM-dd} — {bundles.Count} bundle(s)");
foreach (var b in bundles)
{
    Console.WriteLine();
    Console.WriteLine($"== {b.Name}  ({b.Files.Count} assemblies, start script {b.StartScript})");
    foreach (var f in b.Files.OrderBy(f => f.Name))
        Console.WriteLine($"   {f.Name,-34} asm {f.AsmVersion,-12} file {f.FileVersion,-16} product {f.ProductVersion,-24} mvid {f.Mvid}");
    foreach (var f in b.Files.Where(f => f.Name.StartsWith("Volt.")).OrderBy(f => f.Name))
        foreach (var r in f.AsmRefs.Where(r => r.StartsWith("System.Text.Json ") || r.StartsWith("System.Memory ")))
            Console.WriteLine($"   ref  {f.Name} -> {r}");
    foreach (var m in b.Defs.Where(d => d.Contains("Volt.Wire.PipeClient::Call") || d.Contains("Volt.Contracts.WireJson::Write")).OrderBy(d => d))
        Console.WriteLine($"   def  {m}");
    foreach (var r in b.Refs.Where(r => failing.Any(f => r.Contains(f))).Distinct().OrderBy(r => r))
        Console.WriteLine($"   call {r}");
    var unresolvedSelf = b.UnresolvedAgainst(b);
    Console.WriteLine($"   self-check: {b.Refs.Count(r => r.Contains(" -> type "))} Volt type refs + {b.Refs.Count(r => !r.Contains(" -> type "))} Volt member refs, {unresolvedSelf.Count} unresolved within the bundle");
    foreach (var u in unresolvedSelf) Console.WriteLine($"      UNRESOLVED {u}");
}

Console.WriteLine();
Console.WriteLine("== cross matrix: rows = consumer bundle (its non-provider Volt assemblies), cols = provider bundle (its Volt.Wire + Volt.Contracts + Volt.Engine + Volt.Engine.Host + Volt.Relay)");
Console.WriteLine("   cell = unresolved type + member refs; '*' = one of the two failing members is among them");
for (int c = 0; c < bundles.Count; c++)
{
    var cells = new List<string>();
    for (int p = 0; p < bundles.Count; p++)
    {
        var miss = bundles[c].UnresolvedAgainst(bundles[p]);
        var star = miss.Any(m => failing.Any(f => m.Contains(f))) ? "*" : "";
        cells.Add($"{miss.Count}{star}".PadLeft(5));
    }
    Console.WriteLine($"   [{c}] {string.Join(" ", cells)}   {bundles[c].Name}");
}
Console.WriteLine();
Console.WriteLine("== failing-member detail per (consumer, provider) pair where one is unresolved");
for (int c = 0; c < bundles.Count; c++)
    for (int p = 0; p < bundles.Count; p++)
        foreach (var m in bundles[c].UnresolvedAgainst(bundles[p]).Where(m => failing.Any(f => m.Contains(f))))
        {
            var name = m.Substring(m.IndexOf(" -> ") + 4);
            var member = failing.First(f => name.Contains(f));
            var provided = bundles[p].Defs.Where(d => d.Contains(member + "(") || d.Contains(member + " field")).ToList();
            Console.WriteLine($"   [{c}]->[{p}] wants {m}");
            foreach (var d in provided) Console.WriteLine($"            has   {d}");
            if (provided.Count == 0) Console.WriteLine("            has   (no member of that name)");
        }
Console.WriteLine();
Console.WriteLine("== distinct unresolved members when a consumer of one API generation binds a provider of the other (first pair per row/col generation)");
var shown = new HashSet<string>();
for (int c = 0; c < bundles.Count; c++)
    for (int p = 0; p < bundles.Count; p++)
    {
        var miss = bundles[c].UnresolvedAgainst(bundles[p]);
        if (miss.Count == 0) continue;
        var key = string.Join("|", miss.Select(m => m.Substring(m.IndexOf(" -> ") + 4)).Distinct().OrderBy(m => m));
        if (!shown.Add(key)) continue;
        Console.WriteLine($"   [{c}]->[{p}] {miss.Count} refs:");
        foreach (var m in miss.Select(m => m.Substring(m.IndexOf(" -> ") + 4)).Distinct().OrderBy(m => m)) Console.WriteLine($"      {m}");
    }
return 0;

sealed record FileInfoRow(string Name, string AsmVersion, string FileVersion, string ProductVersion, Guid Mvid, List<string> AsmRefs);

sealed class Bundle
{
    public string Name = "";
    public string StartScript = "(none)";
    public List<FileInfoRow> Files = new();
    public HashSet<string> Defs = new();          // "type T" and "Type::Member(sig)" with assembly-qualified types, for provider assemblies
    public List<string> Refs = new();             // "<consumer file> -> type T" / "-> Type::Member(sig)" into a Volt assembly
    static readonly HashSet<string> Providers = new(StringComparer.OrdinalIgnoreCase)
        { "Volt.Wire", "Volt.Contracts", "Volt.Engine", "Volt.Engine.Host", "Volt.Relay" };

    public static Bundle Read(string name, string dir)
    {
        var b = new Bundle { Name = name };
        var start = Directory.EnumerateFiles(dir, "start_volt_codesys.py", SearchOption.AllDirectories).FirstOrDefault();
        if (start != null) b.StartScript = $"{new FileInfo(start).Length} bytes{(File.ReadAllText(start).Contains("_stage(") ? ", stages a per-pid copy" : ", loads in place")}";
        foreach (var path in Directory.EnumerateFiles(dir, "*.*", SearchOption.AllDirectories)
                     .Where(p => p.EndsWith(".dll", StringComparison.OrdinalIgnoreCase) || p.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)))
        {
            var fn = Path.GetFileNameWithoutExtension(path);
            if (!fn.StartsWith("Volt") && !fn.StartsWith("System.Text.Json") && fn != "System.Memory" && fn != "Microsoft.Bcl.AsyncInterfaces"
                && fn != "System.Text.Encodings.Web" && fn != "System.Runtime.CompilerServices.Unsafe") continue;
            using var fs = File.OpenRead(path);
            using var pe = new PEReader(fs);
            if (!pe.HasMetadata) continue;
            var md = pe.GetMetadataReader();
            if (!md.IsAssembly) continue;
            var asm = md.GetAssemblyDefinition();
            var asmName = md.GetString(asm.Name);
            var fvi = FileVersionInfo.GetVersionInfo(path);
            var refs = md.AssemblyReferences.Select(h => md.GetAssemblyReference(h))
                .Select(r => $"{md.GetString(r.Name)} {r.Version}").ToList();
            b.Files.Add(new FileInfoRow(Path.GetFileName(path), asm.Version.ToString(), fvi.FileVersion ?? "(none)",
                fvi.ProductVersion ?? "(none)", md.GetGuid(md.GetModuleDefinition().Mvid), refs));
            if (!asmName.StartsWith("Volt")) continue;
            var prov = new TypeNamer(md, $"{asmName} {asm.Version}");
            if (Providers.Contains(asmName)) b.CollectDefs(md, prov);
            b.CollectRefs(md, prov, Path.GetFileName(path), asmName);
        }
        return b;
    }

    void CollectDefs(MetadataReader md, TypeNamer n)
    {
        foreach (var th in md.TypeDefinitions)
        {
            var t = md.GetTypeDefinition(th);
            var tn = n.Def(th);
            Defs.Add($"type {tn}");
            foreach (var mh in t.GetMethods())
            {
                var m = md.GetMethodDefinition(mh);
                var sig = m.DecodeSignature(n, null);
                Defs.Add($"{tn}::{md.GetString(m.Name)}({string.Join(", ", sig.ParameterTypes)}) : {sig.ReturnType}");
            }
            foreach (var fh in t.GetFields())
            {
                var f = md.GetFieldDefinition(fh);
                Defs.Add($"{tn}::{md.GetString(f.Name)} field : {f.DecodeSignature(n, null)}");
            }
        }
    }

    void CollectRefs(MetadataReader md, TypeNamer n, string file, string asmName)
    {
        // Every TYPE reference into a Volt assembly, not only the owners of member refs: a type used only through
        // castclass / isinst / typeof / a custom attribute / a signature has no MemberReference of its own, and a
        // provider build that renamed or removed it is a TypeLoadException in a mixed load.
        foreach (var th in md.TypeReferences)
        {
            var tn = n.Ref(th);
            if (tn.StartsWith("[Volt.")) Refs.Add($"{file} -> type {tn}");
        }
        foreach (var rh in md.MemberReferences)
        {
            var r = md.GetMemberReference(rh);
            if (r.Parent.Kind != HandleKind.TypeReference) continue;
            var owner = n.Ref((TypeReferenceHandle)r.Parent);
            if (!owner.StartsWith("[Volt.")) continue;
            var name = md.GetString(r.Name);
            string entry = r.GetKind() == MemberReferenceKind.Method
                ? Fmt(owner, name, r.DecodeMethodSignature(n, null))
                : $"{owner}::{name} field : {r.DecodeFieldSignature(n, null)}";
            Refs.Add($"{file} -> {entry}");
        }
    }

    static string Fmt(string owner, string name, MethodSignature<string> s) =>
        $"{owner}::{name}({string.Join(", ", s.ParameterTypes)}) : {s.ReturnType}";

    /// Refs of this bundle's NON-provider Volt assemblies (the bridge host: Volt.Ide.Codesys, VoltBridgeTwincat …)
    /// AND its provider assemblies, checked against the other bundle's provider defs.
    public List<string> UnresolvedAgainst(Bundle provider) =>
        Refs.Where(r => !provider.Defs.Contains(r.Substring(r.IndexOf(" -> ") + 4))).ToList();
}

/// Renders a type as "[Assembly Version]Namespace.Name" so two signatures compare equal only when every type
/// resolves to the same assembly IDENTITY — the property the CLR's member binding depends on.
sealed class TypeNamer : ISignatureTypeProvider<string, object?>
{
    readonly MetadataReader _md; readonly string _self;
    public TypeNamer(MetadataReader md, string self) { _md = md; _self = self; }

    public string Def(TypeDefinitionHandle h)
    {
        var t = _md.GetTypeDefinition(h);
        var name = Qual(_md.GetString(t.Namespace), _md.GetString(t.Name));
        var decl = t.GetDeclaringType();
        if (!decl.IsNil) return $"{Def(decl)}/{_md.GetString(t.Name)}";
        return $"[{_self}]{name}";
    }

    public string Ref(TypeReferenceHandle h)
    {
        var t = _md.GetTypeReference(h);
        var name = Qual(_md.GetString(t.Namespace), _md.GetString(t.Name));
        switch (t.ResolutionScope.Kind)
        {
            case HandleKind.AssemblyReference:
                var a = _md.GetAssemblyReference((AssemblyReferenceHandle)t.ResolutionScope);
                return $"[{_md.GetString(a.Name)} {a.Version}]{name}";
            case HandleKind.TypeReference:
                return $"{Ref((TypeReferenceHandle)t.ResolutionScope)}/{_md.GetString(t.Name)}";
            default:
                return $"[{_self}]{name}";
        }
    }

    // Framework types (mscorlib / netstandard / System.Runtime) are one identity at run time; collapse their scope so
    // a netstandard2.0 provider and a net48 consumer compare by name for them, as the CLR's unification does.
    // System.Collections / System.Linq … are net10 reference facades the TwinCAT worker compiles against; the CLR
    // forwards them to the same core types a netstandard2.0 provider names, so they collapse too.
    static readonly string[] Core = { "[mscorlib ", "[netstandard ", "[System.Runtime ", "[System.Private.CoreLib ",
        "[System.Collections ", "[System.Linq ", "[System.Threading ", "[System.Runtime.InteropServices " };
    static string Norm(string s)
    {
        foreach (var c in Core)
            if (s.StartsWith(c)) return "[core]" + s.Substring(s.IndexOf(']') + 1);
        return s;
    }

    static string Qual(string ns, string n) => string.IsNullOrEmpty(ns) ? n : $"{ns}.{n}";
    public string GetPrimitiveType(PrimitiveTypeCode c) => c.ToString();
    public string GetTypeFromDefinition(MetadataReader r, TypeDefinitionHandle h, byte k) => Def(h);
    public string GetTypeFromReference(MetadataReader r, TypeReferenceHandle h, byte k) => Norm(Ref(h));
    public string GetTypeFromSpecification(MetadataReader r, object? g, TypeSpecificationHandle h, byte k) =>
        r.GetTypeSpecification(h).DecodeSignature(this, g);
    public string GetSZArrayType(string e) => e + "[]";
    public string GetArrayType(string e, ArrayShape s) => $"{e}[{new string(',', s.Rank - 1)}]";
    public string GetByReferenceType(string e) => e + "&";
    public string GetPointerType(string e) => e + "*";
    public string GetPinnedType(string e) => e + " pinned";
    public string GetGenericInstantiation(string g, ImmutableArray<string> a) => $"{g}<{string.Join(", ", a)}>";
    public string GetGenericTypeParameter(object? g, int i) => $"!{i}";
    public string GetGenericMethodParameter(object? g, int i) => $"!!{i}";
    public string GetFunctionPointerType(MethodSignature<string> s) => "fnptr";
    public string GetModifiedType(string m, string u, bool req) => u;
    public string GetTypeFromSerializedName(string n) => n;
    public PrimitiveTypeCode GetUnderlyingEnumType(string t) => PrimitiveTypeCode.Int32;
    public bool IsSystemType(string t) => t.EndsWith("]System.Type");
}
