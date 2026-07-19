using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace Volt.Engine.Library;

/// <summary>Render a <see cref="LibSignature"/> to an ST declaration file (kind extension + text) the LSP can
/// ingest. Declaration only — never a body. Mirrors the proven extraction spike; the same logic the CODESYS
/// language model exposes, produced deterministically so a library version hashes stably.</summary>
public static class LibSignatureRenderer
{
    // Skip only compiler-internal (`__`-prefixed) names — a real declaration/member name is never usable as one.
    // (A single-letter name like a Point's `X`/`Y` is a VALID identifier and must NOT be dropped — the old
    // X/B/W/D/L "direct-address prefix" heuristic silently lost such struct fields.)
    private static bool OkName(string n) =>
        Regex.IsMatch(n, "^[A-Za-z_][A-Za-z0-9_]*$") && !n.Contains("__");

    private static IEnumerable<string> Block(string kw, IReadOnlyList<LibVar> vs) =>
        vs.Count == 0 ? Enumerable.Empty<string>()
            : new[] { kw }.Concat(vs.Where(v => OkName(v.Name)).Select(v => $"\t{VarDecl(v)};")).Concat(new[] { "END_VAR" });

    // `Name : Type` plus a `:= Initial` default when the model carries one.
    private static string VarDecl(LibVar v) => $"{v.Name} : {v.Type}" + (string.IsNullOrEmpty(v.Initial) ? "" : $" := {v.Initial}");

    /// <summary>The (extension, text) for this signature, or null for a kind we don't materialize (method,
    /// property, and other sub-signatures resolved via their parent).</summary>
    public static (string Ext, string Text)? Render(LibSignature s)
    {
        var name = s.Name;
        if (!OkName(name)) return null;

        // A DUT alias (`TYPE HANDLE : __XWORD; END_TYPE`) — render it faithfully, not as an empty struct. The
        // base can be a `__`-prefixed CODESYS system type (target-specific word), which the LSP resolves.
        if (!string.IsNullOrEmpty(s.AliasBase))
            return (".alias", $"TYPE {name} : {s.AliasBase};\nEND_TYPE");

        var kind = s.PouType.Contains(".") ? s.PouType.Substring(s.PouType.LastIndexOf('.') + 1) : s.PouType;

        switch (kind)
        {
            case "FunctionBlock":
            {
                var ext = s.BaseName != null && OkName(s.BaseName) ? $" EXTENDS {s.BaseName}" : "";
                // Internal VARs = every member that is not a pin. A derived FB can access its base's internal
                // members (e.g. `BlinkHammerFB EXTENDS BLINK` reads BLINK's internal `CLOCK` timer), so emit them
                // as a plain VAR block or those inherited references false-flag.
                var pins = new HashSet<string>(
                    s.Inputs.Concat(s.Outputs).Concat(s.InOuts).Select(v => v.Name), System.StringComparer.OrdinalIgnoreCase);
                var internals = s.Members.Where(v => !pins.Contains(v.Name)).ToList();
                var lines = new[] { $"FUNCTION_BLOCK {name}{ext}" }
                    .Concat(Block("VAR_INPUT", s.Inputs)).Concat(Block("VAR_OUTPUT", s.Outputs))
                    .Concat(Block("VAR_IN_OUT", s.InOuts)).Concat(Block("VAR", internals))
                    .Concat(new[] { "END_FUNCTION_BLOCK" });
                return (".fb", string.Join("\n", lines));
            }
            case "Function":
            {
                // CODESYS exposes a function's return value as an output pin named after the function, with
                // ReturnType left empty (verified live). Lift it into the declared return type and drop it
                // from VAR_OUTPUT so we don't emit a bogus self-named output.
                var ret = s.Outputs.FirstOrDefault(v => string.Equals(v.Name, name, System.StringComparison.OrdinalIgnoreCase));
                var rt = !string.IsNullOrEmpty(s.ReturnType) ? s.ReturnType : ret?.Type ?? "BOOL";
                var outs = s.Outputs.Where(v => !string.Equals(v.Name, name, System.StringComparison.OrdinalIgnoreCase)).ToList();
                var lines = new[] { $"FUNCTION {name} : {rt}" }
                    .Concat(Block("VAR_INPUT", s.Inputs)).Concat(Block("VAR_OUTPUT", outs))
                    .Concat(Block("VAR_IN_OUT", s.InOuts)).Concat(new[] { "END_FUNCTION" });
                return (".fun", string.Join("\n", lines));
            }
            case "Interface":
                return (".itf", $"INTERFACE {name}\nEND_INTERFACE");
            case "VarGlobal":
            {
                var mem = s.Members.Where(v => OkName(v.Name)).ToList();
                // An enum: every member is typed as the container itself. Otherwise a GVL of constants.
                var isEnum = mem.Count > 0 && mem.All(v => v.Type.Replace(" ", "").ToLowerInvariant() == name.Replace(" ", "").ToLowerInvariant());
                if (isEnum)
                {
                    // Enum members carry their ordinal in Initial (`NO_ERROR := 0, FIRST_ERROR := 5700`).
                    var members = mem.Select(v => "\t" + v.Name + (string.IsNullOrEmpty(v.Initial) ? "" : $" := {v.Initial}"));
                    return (".enum", $"TYPE {name} :\n(\n{string.Join(",\n", members)}\n);\nEND_TYPE");
                }
                return (".gvl", string.Join("\n", new[] { "VAR_GLOBAL" }.Concat(mem.Select(v => $"\t{VarDecl(v)};")).Concat(new[] { "END_VAR" })));
            }
            case "Type":
            {
                var fields = s.Members.Where(v => OkName(v.Name)).Select(v => $"\t{VarDecl(v)};");
                // A UNION shares the struct shape but with UNION/END_UNION (overlapping members); a STRUCT is the default.
                var (open, close, ext) = s.Flags.Contains("Union") ? ("UNION", "END_UNION", ".union") : ("STRUCT", "END_STRUCT", ".struct");
                return (ext, string.Join("\n", new[] { $"TYPE {name} :", open }.Concat(fields).Concat(new[] { close, "END_TYPE" })));
            }
            default:
                return null;
        }
    }
}
