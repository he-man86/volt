using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using Volt.Tests.Shared;

namespace Volt.Engine.Tests.Format.Network.Schema;

/// <summary>
/// THE NWL SCHEMA, READ FROM THE VENDOR'S OWN ASSEMBLY (openspec <c>nwl-schema-completeness-gate</c> 1.1). Every archived
/// class of CODESYS's <c>NWLObject.plugin.dll</c> (the ones carrying a <c>TypeGuid</c>), every member the 3S serializer
/// writes (a field carrying <c>DefaultSerialization(name)</c>, its base class's included), every flag bit (<c>Flags._ci*</c>),
/// the enums a member stores, and every SLOT — a member whose type a census class can fill — with the classes that can
/// fill it. Read with <see cref="MetadataLoadContext"/>, which loads nothing: DIALECT N12 measured that
/// <c>ReflectionOnlyLoadFrom</c> drops types silently.
/// </summary>
public static class NwlSchemaCensus
{
    public const string Version = "3.5.21.40";

    public static string CodesysRoot => $@"C:\Program Files\CODESYS {Version}\CODESYS";

    const string PluginRelative = @"PlugIns\d35e1e67-69fb-49df-84d6-4d5b46453adf\4.6.0.0\NWLObject.plugin.dll";

    const string Ns = "_3S.CoDeSys.NWLObject";

    /// <summary>The committed census file.</summary>
    public static string FixturePath => Path.Combine(CorpusProjects.CliRoot().FullName, "test", "fixtures", "nwl-schema", $"census.{Version}.json");

    /// <summary>Whether this machine has the CODESYS the census is read from (the dev machine; CI has none).</summary>
    public static bool AssemblyPresent => File.Exists(Path.Combine(CodesysRoot, PluginRelative));

    /// <summary>The census, read from the assembly, as the JSON the fixture holds.</summary>
    public static string Read()
    {
        using var mlc = new MetadataLoadContext(new CodesysResolver(CodesysRoot), "mscorlib");
        var asm = mlc.LoadFromAssemblyPath(Path.Combine(CodesysRoot, PluginRelative));
        var types = asm.GetTypes().Where(t => t.Namespace == Ns && !t.IsNested).ToList();

        var classes = types.Where(t => t.IsClass && !t.IsAbstract && GuidOf(t) is not null && Members(t).Count > 0)
            .OrderBy(t => t.Name, StringComparer.Ordinal).ToList();

        var root = new JsonObject
        {
            ["codesys"] = Version,
            ["assembly"] = $"NWLObject.plugin.dll {asm.GetName().Version}",
            ["regenerate"] = "VOLT_WRITE_NWL_SCHEMA=1 dotnet test test/Volt.Engine.Tests --filter NwlSchemaCensusTests (needs CODESYS " + Version + ")",
        };

        var cls = new JsonArray();
        foreach (var t in classes)
        {
            var members = new JsonArray();
            foreach (var (name, field) in Members(t))
                members.Add(new JsonObject { ["member"] = name, ["field"] = field.Name, ["type"] = TypeName(field.FieldType) });
            cls.Add(new JsonObject
            {
                ["class"] = t.Name,
                ["typeGuid"] = GuidOf(t),
                ["implements"] = new JsonArray(t.GetInterfaces().Where(i => i.Namespace == Ns).Select(i => (JsonNode)i.Name!)
                    .OrderBy(n => n!.GetValue<string>(), StringComparer.Ordinal).ToArray()),
                ["members"] = members,
            });
        }
        root["classes"] = cls;

        var flags = types.Single(t => t.Name == "Flags");
        root["flagBits"] = new JsonArray(flags.GetFields(BindingFlags.Static | BindingFlags.NonPublic | BindingFlags.Public)
            .Where(f => f.IsLiteral && f.Name.StartsWith("_ci", StringComparison.Ordinal))
            .OrderBy(f => Convert.ToInt32(f.GetRawConstantValue(), CultureInfo.InvariantCulture))
            .Select(f => (JsonNode)new JsonObject { ["name"] = f.Name.Substring(3), ["value"] = Convert.ToInt32(f.GetRawConstantValue(), CultureInfo.InvariantCulture) })
            .ToArray());

        // The enums a census member stores, and the ones the flag/edge API speaks (Edge, FlagsModifier).
        // (the interface assembly, Common\NWLObject.dll, declares them)
        var api = mlc.LoadFromAssemblyPath(Path.Combine(CodesysRoot, @"Common\NWLObject.dll"));
        // A stored enum from outside NWL (CallType's Core.LanguageModel.Operator) is the member's value domain too.
        var stored = classes.SelectMany(t => Members(t)).Select(m => m.Field.FieldType).Where(f => f.IsEnum);
        var enums = new JsonObject();
        foreach (var e in api.GetTypes().Where(t => t.Namespace == Ns && t.IsEnum && t.Name is "Edge" or "FlagsModifier" or "NWLDisplayMode")
                     .Concat(stored).GroupBy(t => t.Name).Select(g => g.First())
                     .OrderBy(t => t.Name, StringComparer.Ordinal))
            enums[e.Name] = new JsonArray(e.GetFields(BindingFlags.Static | BindingFlags.Public)
                .Select(f => (JsonNode)$"{f.Name}={Convert.ToInt64(f.GetRawConstantValue(), CultureInfo.InvariantCulture).ToString(CultureInfo.InvariantCulture)}").ToArray());
        root["enums"] = enums;

        // A slot: a member whose (element) type a census class is assignable to.
        var slots = new JsonArray();
        foreach (var t in classes)
            foreach (var (name, field) in Members(t))
            {
                var elem = Element(field.FieldType);
                var fillers = classes.Where(c => elem.IsAssignableFrom(c)).Select(c => c.Name).ToList();
                if (elem.FullName == "System.Object") fillers = classes.Select(c => c.Name).ToList();
                if (fillers.Count == 0) continue;
                slots.Add(new JsonObject
                {
                    ["slot"] = t.Name + "." + name,
                    ["accepts"] = TypeName(elem),
                    ["list"] = !ReferenceEquals(elem, field.FieldType),
                    ["classes"] = new JsonArray(fillers.Select(f => (JsonNode)f!).ToArray()),
                });
            }
        root["slots"] = slots;

        return root.ToJsonString(new JsonSerializerOptions { WriteIndented = true }).Replace("\r\n", "\n") + "\n";
    }

    /// <summary>The archived members of <paramref name="t"/>, its base classes' first: (archive name, field).</summary>
    static List<(string Name, FieldInfo Field)> Members(Type t)
    {
        var chain = new List<Type>();
        for (var c = t; c is not null && c.Namespace == Ns; c = c.BaseType) chain.Insert(0, c);
        var list = new List<(string, FieldInfo)>();
        foreach (var c in chain)
            foreach (var f in c.GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly)
                         .OrderBy(f => f.MetadataToken))
                if (f.CustomAttributes.FirstOrDefault(a => a.AttributeType.Name == "DefaultSerializationAttribute") is { } a)
                    list.Add(((string)a.ConstructorArguments[0].Value!, f));
        return list;
    }

    static string? GuidOf(Type t) =>
        t.CustomAttributes.FirstOrDefault(a => a.AttributeType.Name == "TypeGuidAttribute")?.ConstructorArguments[0].Value as string;

    static Type Element(Type t) => t.IsGenericType && t.GetGenericArguments().Length == 1 && t.Name.StartsWith("LList", StringComparison.Ordinal)
        ? t.GetGenericArguments()[0] : t;

    static string TypeName(Type t)
    {
        if (t.IsGenericType)
        {
            var args = string.Join(",", t.GetGenericArguments().Select(TypeName));
            var name = t.Name.Substring(0, t.Name.IndexOf('`'));
            return name == "Nullable" ? args + "?" : $"{name}<{args}>";
        }
        return t.Namespace == "System" ? t.Name : t.Name;
    }

    /// <summary>Resolves a reference the way CODESYS's own loader would find it: the .NET Framework, then its private GAC
    /// (<c>LacBinaries\GAC_MSIL\&lt;name&gt;\&lt;version&gt;__&lt;token&gt;</c>, the exact version), then Common and PlugIns.</summary>
    sealed class CodesysResolver : MetadataAssemblyResolver
    {
        readonly string root;
        public CodesysResolver(string root) { this.root = root; }

        public override Assembly? Resolve(MetadataLoadContext context, AssemblyName name)
        {
            var fw = @"C:\Windows\Microsoft.NET\Framework64\v4.0.30319";
            foreach (var p in new[] { Path.Combine(fw, name.Name + ".dll"), Path.Combine(fw, "WPF", name.Name + ".dll") })
                if (File.Exists(p)) return context.LoadFromAssemblyPath(p);
            var gac = Path.Combine(root, "LacBinaries", "GAC_MSIL", name.Name!);
            if (Directory.Exists(gac))
            {
                var exact = Directory.GetDirectories(gac).FirstOrDefault(d => Path.GetFileName(d).StartsWith(name.Version + "__", StringComparison.Ordinal));
                if (exact is not null && File.Exists(Path.Combine(exact, name.Name + ".dll")))
                    return context.LoadFromAssemblyPath(Path.Combine(exact, name.Name + ".dll"));
            }
            foreach (var dir in new[] { "Common", "PlugIns" })
            {
                var hit = Directory.GetFiles(Path.Combine(root, dir), name.Name + ".dll", SearchOption.AllDirectories).FirstOrDefault()
                          ?? Directory.GetFiles(Path.Combine(root, dir), name.Name + ".plugin.dll", SearchOption.AllDirectories).FirstOrDefault();
                if (hit is not null) return context.LoadFromAssemblyPath(hit);
            }
            return null;
        }
    }
}
