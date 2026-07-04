using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace Volt.Bridge.Core.Library;

/// <summary>Render a <see cref="LibSignature"/> to an ST declaration file (kind extension + text) the LSP can
/// ingest. Declaration only — never a body. Mirrors the proven extraction spike; the same logic the CODESYS
/// language model exposes, produced deterministically so a library version hashes stably.</summary>
public static class LibSignatureRenderer
{
    // Single-letter direct-address size prefixes (X/B/W/D/L) collide with the ST lexer, and compiler internals
    // are `__`-prefixed — neither is a usable declaration name/var, so skip them.
    private static bool OkName(string n) =>
        Regex.IsMatch(n, "^[A-Za-z_][A-Za-z0-9_]*$") && !(n.Length == 1 && "XBWDL".Contains(n.ToUpperInvariant())) && !n.Contains("__");

    private static IEnumerable<string> Block(string kw, IReadOnlyList<LibVar> vs) =>
        vs.Count == 0 ? Enumerable.Empty<string>()
            : new[] { kw }.Concat(vs.Where(v => OkName(v.Name)).Select(v => $"\t{v.Name} : {v.Type};")).Concat(new[] { "END_VAR" });

    /// <summary>The (extension, text) for this signature, or null for a kind we don't materialize (method,
    /// property, and other sub-signatures resolved via their parent).</summary>
    public static (string Ext, string Text)? Render(LibSignature s)
    {
        var name = s.Name;
        if (!OkName(name)) return null;
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
                    return (".enum", $"TYPE {name} :\n(\n{string.Join(",\n", mem.Select(v => "\t" + v.Name))}\n);\nEND_TYPE");
                return (".gvl", string.Join("\n", new[] { "VAR_GLOBAL" }.Concat(mem.Select(v => $"\t{v.Name} : {v.Type};")).Concat(new[] { "END_VAR" })));
            }
            case "Type":
            {
                var fields = s.Members.Where(v => OkName(v.Name)).Select(v => $"\t{v.Name} : {v.Type};");
                return (".struct", string.Join("\n", new[] { $"TYPE {name} :", "STRUCT" }.Concat(fields).Concat(new[] { "END_STRUCT", "END_TYPE" })));
            }
            default:
                return null;
        }
    }
}
