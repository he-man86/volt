using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Volt.Engine.Model;

namespace Volt.Engine.Library;

/// <summary>Render a <see cref="LibSignature"/> to an ST declaration file (kind extension + text) the LSP can
/// ingest. Declaration only — never a body. Mirrors the proven extraction spike; the same logic the CODESYS
/// language model exposes, produced deterministically so a library version hashes stably.</summary>
public static class LibSignatureRenderer
{
    // A renderable name must be a plain IEC identifier AND must not CONTAIN a double underscore anywhere —
    // `__` marks a compiler-mangled/internal name (`__POOL`, `SysMem__Impl`), never something user code names.
    // (A single-letter name like a Point's `X`/`Y` is a VALID identifier and must NOT be dropped — the old
    // X/B/W/D/L "direct-address prefix" heuristic silently lost such struct fields.)
    // ponytail: dropped names are not logged, and Block() tests emptiness on the UNFILTERED list, so an
    // all-`__` pin set still emits a bare `VAR_INPUT`/`END_VAR` pair. Upgrade path: return the drop count so
    // FetchService can tally it beside its lib-render-null/lib-unmatched lines, and filter before the count —
    // both change rendered bytes, so they belong to a deliberate re-fetch, not a behavior-preserving pass.
    private static bool OkName(string n) =>
        Regex.IsMatch(n, "^[A-Za-z_][A-Za-z0-9_]*$") && !n.Contains("__");

    private static IEnumerable<string> Block(string kw, IReadOnlyList<LibVar> vs) =>
        vs.Count == 0 ? Enumerable.Empty<string>()
            : new[] { kw }.Concat(vs.Where(v => OkName(v.Name)).Select(v => $"\t{VarDecl(v)};")).Concat(new[] { "END_VAR" });

    // `Name : Type` plus a `:= Initial` default when the model carries one.
    private static string VarDecl(LibVar v) => $"{v.Name} : {v.Type}" + (string.IsNullOrEmpty(v.Initial) ? "" : $" := {v.Initial}");

    /// <summary>The CODESYS convention for a function OR method return value: it is exposed as an output pin named
    /// after the routine (with <c>ReturnType</c> left empty — verified live). Lift it into the declared return type
    /// and strip it from VAR_OUTPUT so no bogus self-named output is emitted. Owned here so functions and methods
    /// stay identical. Returns (return type or null when there is none, the remaining outputs).</summary>
    private static (string? Ret, List<LibVar> Outputs) LiftReturn(string name, IReadOnlyList<LibVar> outputs, string? explicitReturn)
    {
        if (!string.IsNullOrEmpty(explicitReturn)) return (explicitReturn, outputs.ToList());
        var self = outputs.FirstOrDefault(v => string.Equals(v.Name, name, System.StringComparison.OrdinalIgnoreCase));
        var rest = outputs.Where(v => !string.Equals(v.Name, name, System.StringComparison.OrdinalIgnoreCase)).ToList();
        return (self?.Type, rest);
    }

    // Each library method → a `METHOD name : ret … END_METHOD` block, declaration only. Emitted AFTER the parent's
    // END_FUNCTION_BLOCK / END_INTERFACE (a blank line between), matching how project FBs materialize their method
    // children — so the LSP parses and binds them as members. A method with no return omits the `: ret` (void).
    private static IEnumerable<string> MethodBlocks(IReadOnlyList<LibMethod>? methods)
    {
        if (methods == null) yield break;
        foreach (var m in methods)
        {
            if (!OkName(m.Name)) continue;
            var (ret, outs) = LiftReturn(m.Name, m.Outputs, m.ReturnType);
            yield return ""; // blank-line separator from the preceding block
            yield return $"METHOD {m.Name}" + (string.IsNullOrEmpty(ret) ? "" : $" : {ret}");
            foreach (var l in Block("VAR_INPUT", m.Inputs)) yield return l;
            foreach (var l in Block("VAR_OUTPUT", outs)) yield return l;
            foreach (var l in Block("VAR_IN_OUT", m.InOuts)) yield return l;
            yield return "END_METHOD";
        }
    }

    /// <summary>The (extension, text) for this signature, or null for a kind we don't materialize as its own file.
    /// Methods are folded into their parent FB/interface (see <see cref="MethodBlocks"/>); properties are not in
    /// the precompiled language model at all, so a library FB's property access stays library-skipped in the LSP.</summary>
    public static (string Ext, string Text)? Render(LibSignature s)
    {
        var name = s.Name;
        if (!OkName(name)) return null;

        // A DUT alias (`TYPE HANDLE : __XWORD; END_TYPE`) — render it faithfully, not as an empty struct. The
        // base can be a `__`-prefixed CODESYS system type (target-specific word), which the LSP resolves. Every
        // DUT is one `.dut` (the alias-ness lives in the body form, not the extension).
        if (!string.IsNullOrEmpty(s.AliasBase))
            return (".dut", $"TYPE {name} : {s.AliasBase};\nEND_TYPE");

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
                    .Concat(new[] { "END_FUNCTION_BLOCK" })
                    .Concat(MethodBlocks(s.Methods));
                return (".fb", string.Join("\n", lines));
            }
            case "Function":
            {
                var (ret, outs) = LiftReturn(name, s.Outputs, s.ReturnType);
                // NOT `?? "BOOL"`. This text is shipped to the LSP as the library's ground truth, so an invented
                // return type does not degrade — it RESOLVES, and then lies: every call site type-checks against
                // BOOL and the engineer is told their correct code is wrong (or their wrong code is fine).
                // A FUNCTION with no readable return type is an object-model failure, not a BOOL.
                var rt = ret ?? throw new InvalidOperationException(
                    $"library function '{name}' has no readable return type — cannot render its signature");
                var lines = new[] { $"FUNCTION {name} : {rt}" }
                    .Concat(Block("VAR_INPUT", s.Inputs)).Concat(Block("VAR_OUTPUT", outs))
                    .Concat(Block("VAR_IN_OUT", s.InOuts)).Concat(new[] { "END_FUNCTION" });
                return (".fun", string.Join("\n", lines));
            }
            case "Interface":
            {
                var lines = new[] { $"INTERFACE {name}", "END_INTERFACE" }.Concat(MethodBlocks(s.Methods));
                return (".itf", string.Join("\n", lines));
            }
            case "VarGlobal":
            {
                var mem = s.Members.Where(v => OkName(v.Name)).ToList();
                // An enum: every member is typed as the container itself. Otherwise a GVL of constants.
                var isEnum = mem.Count > 0 && mem.All(v => v.Type.Replace(" ", "").ToLowerInvariant() == name.Replace(" ", "").ToLowerInvariant());
                if (isEnum)
                {
                    // Enum members carry their ordinal in Initial (`NO_ERROR := 0, FIRST_ERROR := 5700`).
                    var members = mem.Select(v => "\t" + v.Name + (string.IsNullOrEmpty(v.Initial) ? "" : $" := {v.Initial}"));
                    return (".dut", $"TYPE {name} :\n(\n{string.Join(",\n", members)}\n);\nEND_TYPE");
                }
                return (".gvl", string.Join("\n", new[] { "VAR_GLOBAL" }.Concat(mem.Select(v => $"\t{VarDecl(v)};")).Concat(new[] { "END_VAR" })));
            }
            case "Type":
            {
                var fields = s.Members.Where(v => OkName(v.Name)).Select(v => $"\t{VarDecl(v)};");
                // A UNION shares the struct shape but with UNION/END_UNION (overlapping members); a STRUCT is the
                // default. Both are a DUT → one `.dut` extension (the subkind lives in the body keyword only).
                var (open, close) = s.Flags.Contains("Union") ? ("UNION", "END_UNION") : ("STRUCT", "END_STRUCT");
                return (".dut", string.Join("\n", new[] { $"TYPE {name} :", open }.Concat(fields).Concat(new[] { close, "END_TYPE" })));
            }
            default:
                return null;
        }
    }
}
