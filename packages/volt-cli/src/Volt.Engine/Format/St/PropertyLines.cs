using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using Volt.Contracts;
using Volt.Engine.Item;

namespace Volt.Engine.Format.St;

/// <summary>
/// THE <c>%</c>-LINES — an object's <see cref="ObjectProperties"/> as the text spells them (openspec
/// <c>bridge-one-to-one</c> §1.2), both directions, in one place for the ST reader, the ST writer and (mirrored) the
/// LSP's <c>frontend/syntax/format/object-properties.ts</c>.
///
/// <para><b>What a property line is.</b> ONLY a line that opens with <c>%</c> followed by one of the CLOSED keys
/// (<see cref="Keys"/>), the key ending at a space or the line's end — exactly how <c>%FOLDER</c> was told apart. Every
/// other line that opens with <c>%</c> is CODE: a direct-address assignment (<c>%QB1 := x;</c>, 4 in the corpora) can
/// stand exactly where properties are peeled, and no IEC address collides with a key (<c>%I</c> / <c>%Q</c> / <c>%M</c>
/// + a size letter or a digit). So there is no "unknown key" refusal: <c>%class</c> and <c>%CLASSIC</c> are code.</para>
///
/// <para><b>One canonical spelling.</b> <c>%CLASS</c> first, then a member's <c>%FOLDER</c>, then the keys in
/// <see cref="Keys"/>' order, each at most once except <c>%UNDEFINE</c> and <c>%NETVAR</c>, which repeat in vendor
/// order. The writer emits exactly that; the reader refuses another order, a repeated key, a value on a flag and a
/// valued key with none — each naming the key and the line.</para>
/// </summary>
public static class PropertyLines
{
    public const string ClassKey = "CLASS";
    public const string FolderKey = "FOLDER";
    public const string ExcludeFromBuildKey = "EXCLUDE_FROM_BUILD";
    public const string LinkAlwaysKey = "LINK_ALWAYS";
    public const string ExternalKey = "EXTERNAL";
    public const string EnableSystemCallKey = "ENABLE_SYSTEM_CALL";
    public const string OnlineChangeReserveKey = "ONLINE_CHANGE_RESERVE";
    public const string CompilerDefinesKey = "COMPILER_DEFINES";
    public const string UndefineKey = "UNDEFINE";
    public const string CommentKey = "COMMENT";
    public const string ParameterListKey = "PARAMETER_LIST";
    public const string NetVarKey = "NETVAR";
    public const string FileLinkKey = "FILE_LINK";

    /// <summary>The closed key list, in canonical order (<c>FOLDER</c> a member's alone).</summary>
    public static readonly IReadOnlyList<string> Keys = new[]
    {
        ClassKey, FolderKey, ExcludeFromBuildKey, LinkAlwaysKey, ExternalKey, EnableSystemCallKey, OnlineChangeReserveKey,
        CompilerDefinesKey, UndefineKey, CommentKey, ParameterListKey, NetVarKey, FileLinkKey,
    };

    /// <summary>The keys that are flags: present means true, and they carry no value.</summary>
    private static readonly HashSet<string> Flags = new(StringComparer.Ordinal)
        { ExcludeFromBuildKey, LinkAlwaysKey, ExternalKey, EnableSystemCallKey, ParameterListKey };

    /// <summary>The keys that may stand more than once (one line per vendor list element).</summary>
    private static readonly HashSet<string> Repeating = new(StringComparer.Ordinal) { UndefineKey, NetVarKey };

    /// <summary>The class words <c>%CLASS</c> takes (<see cref="ObjectClass"/>); only <c>CHECK</c> takes an argument.</summary>
    private static readonly HashSet<string> ClassWords = new(StringComparer.Ordinal)
        { ObjectClass.Check, ObjectClass.Persistent, ObjectClass.TextListEnum, ObjectClass.Nvl };

    /// <summary>The key <paramref name="line"/> opens with, when it is a property line — <c>%</c>, a closed key, then a
    /// space or the line's end — or null for every other line (code). <c>%FOLDER</c> counts only as the push has always
    /// read it: <c>%FOLDER &lt;path&gt;</c> (<c>StReader.FolderOn</c>).</summary>
    public static string? KeyOf(string line)
    {
        var t = line.Trim();
        if (t.Length < 2 || t[0] != '%') return null;
        var sp = t.IndexOf(' ');
        var key = sp < 0 ? t.Substring(1) : t.Substring(1, sp - 1);
        if (key == FolderKey) return sp < 0 || t.Substring(sp + 1).Trim().Length == 0 ? null : FolderKey;
        return Keys.Contains(key, StringComparer.Ordinal) ? key : null;
    }

    /// <summary>The lines that spell <paramref name="props"/> (and a member's <paramref name="folder"/>), in canonical
    /// order; none for the measured absence of every property.</summary>
    public static IReadOnlyList<string> Write(ObjectProperties props, string? folder = null)
    {
        if (props is null) throw new ArgumentNullException(nameof(props), "an object's properties are read, never defaulted");
        var lines = new List<string>();
        if (props.Class is { } cls) lines.Add($"%{ClassKey} {cls}");
        if (!string.IsNullOrEmpty(folder)) lines.Add($"%{FolderKey} {folder}");
        if (props.ExcludeFromBuild) lines.Add($"%{ExcludeFromBuildKey}");
        if (props.LinkAlways) lines.Add($"%{LinkAlwaysKey}");
        if (props.External) lines.Add($"%{ExternalKey}");
        if (props.EnableSystemCall) lines.Add($"%{EnableSystemCallKey}");
        if (props.OnlineChangeReserve != 0)
            lines.Add($"%{OnlineChangeReserveKey} {props.OnlineChangeReserve.ToString(CultureInfo.InvariantCulture)}");
        if (!string.IsNullOrEmpty(props.CompilerDefines)) lines.Add($"%{CompilerDefinesKey} {StString(props.CompilerDefines!)}");
        foreach (var u in props.Undefines) lines.Add($"%{UndefineKey} {StString(u)}");
        if (!string.IsNullOrEmpty(props.Comment)) lines.Add($"%{CommentKey} {StString(props.Comment!)}");
        if (props.ParameterList) lines.Add($"%{ParameterListKey}");
        foreach (var nv in props.NetVar)
        {
            if (Unspellable(nv) is { } why)
                throw new BridgeException(Volt.Contracts.BridgeErrorCodes.Unsupported, $"%{NetVarKey} {nv.Key}: {why}");
            lines.Add($"%{NetVarKey} {nv.Key}: {(nv.Value.Length == 0 ? "''" : nv.Value)}");
        }
        if (props.FileLink is { } fl) lines.Add($"%{FileLinkKey} {fl.LinkType} {StString(fl.Path)}");
        return lines;
    }

    /// <summary>Why a <c>%NETVAR</c> value cannot be spelled so that it reads back EXACTLY, or null when it can (gate review
    /// of step 3, finding 8): the value stands raw after <c>&lt;member&gt;: </c>, the reader trims the line, the empty value
    /// is spelled <c>''</c> and a line ends at its break — so a value with surrounding blanks, a control character or the
    /// literal <c>''</c> would read back as another value. A driver refuses such an object by name (the vendor value is
    /// content Volt cannot carry; 0 in the corpora); the writer refuses it as its backstop.</summary>
    public static string? Unspellable(NetVarSetting nv)
    {
        var v = nv.Value;
        if (v != v.Trim()) return $"the value '{v}' has surrounding blanks, which the %{NetVarKey} line cannot carry";
        if (v.Any(char.IsControl)) return $"the value holds a line break or another control character, which the %{NetVarKey} line cannot carry";
        if (v == "''") return $"the value is the literal '', which the %{NetVarKey} line spells as the empty value";
        return null;
    }

    /// <summary><paramref name="lines"/> (each a property line, <see cref="KeyOf"/>), read into the properties and a
    /// member's folder — or refused by name and line. <paramref name="what"/> names the object;
    /// <paramref name="firstLine"/> is the file line number of the first of them (0 when not known).
    /// <paramref name="folderAllowed"/>: a member's block, where <c>%FOLDER</c> belongs.</summary>
    public static (ObjectProperties Props, string? Folder) Read(IReadOnlyList<string> lines, string what, int firstLine,
                                                              bool folderAllowed)
    {
        ObjectClass? cls = null;
        string? folder = null, defines = null, comment = null;
        bool exclude = false, linkAlways = false, external = false, systemCall = false, parameterList = false;
        var reserve = 0;
        var undefines = new List<string>();
        var netVar = new List<NetVarSetting>();
        FileLink? fileLink = null;

        var last = -1;
        string? lastKey = null;
        for (var i = 0; i < lines.Count; i++)
        {
            var raw = lines[i];
            var at = firstLine > 0 ? $"{what}, line {firstLine + i}" : $"{what}, line {i + 1} of its property lines";
            var key = KeyOf(raw) ?? throw new InvalidOperationException($"{at}: '{raw.Trim()}' is no property line");
            var t = raw.Trim();
            var value = t.Length > key.Length + 1 ? t.Substring(key.Length + 2) : null;
            var named = $"%{key}";

            if (key == FolderKey && !folderAllowed)
                throw Refuse(at, t, $"{named} stands only in a member's block (directly under its IMPLEMENTATION line, or " +
                                    "closing its declaration); an item's folder is its file's place");
            var rank = Keys.ToList().IndexOf(key);
            if (rank < last || (rank == last && !Repeating.Contains(key)))
                throw Refuse(at, t, rank == last
                    ? $"{named} is written twice — each property line stands once (only %{UndefineKey} and %{NetVarKey} repeat)"
                    : $"{named} stands after '%{lastKey}'. The property lines stand in one order: " +
                      string.Join(", ", Keys.Select(k => "%" + k)));
            last = rank;
            lastKey = key;

            if (Flags.Contains(key))
            {
                if (value is not null)
                    throw Refuse(at, t, $"{named} is a flag and takes no value — the line alone means true, its absence false");
            }
            else if (value is null || value.Trim().Length == 0)
                throw Refuse(at, t, $"{named} takes a value");

            switch (key)
            {
                case ClassKey: cls = ReadClass(value!, at, t); break;
                case FolderKey: folder = value!.Trim(); break;
                case ExcludeFromBuildKey: exclude = true; break;
                case LinkAlwaysKey: linkAlways = true; break;
                case ExternalKey: external = true; break;
                case EnableSystemCallKey: systemCall = true; break;
                case ParameterListKey: parameterList = true; break;
                case OnlineChangeReserveKey:
                    if (!int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out reserve) || reserve <= 0)
                        throw Refuse(at, t, $"{named} takes a positive whole number of bytes (its absence is 0)");
                    break;
                case CompilerDefinesKey: defines = ReadNonEmptyString(value!, at, t, named); break;
                case UndefineKey: undefines.Add(ReadStString(value!, at, t, named)); break;
                case CommentKey: comment = ReadNonEmptyString(value!, at, t, named); break;
                case NetVarKey: netVar.Add(ReadNetVar(value!, at, t)); break;
                case FileLinkKey: fileLink = ReadFileLink(value!, at, t); break;
                default: throw new InvalidOperationException($"{at}: key '{key}' has no reader");
            }
        }
        return (new ObjectProperties(cls, exclude, linkAlways, external, systemCall, reserve, defines, undefines,
                                     comment, parameterList, netVar, fileLink), folder);
    }

    private static BridgeException Refuse(string at, string line, string why) =>
        new(BridgeErrorCodes.InvalidSt, $"{at}: '{line}' — {why}.");

    private static ObjectClass ReadClass(string value, string at, string line)
    {
        var words = value.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
        if (words.Length == 0 || !ClassWords.Contains(words[0]))
            throw Refuse(at, line, $"%{ClassKey} names one of {string.Join(", ", ClassWords.OrderBy(w => w, StringComparer.Ordinal))}");
        if (words[0] == ObjectClass.Check)
        {
            if (words.Length != 2)
                throw Refuse(at, line, $"%{ClassKey} {ObjectClass.Check} names the check it is (`%{ClassKey} {ObjectClass.Check} CheckBounds`)");
            return new ObjectClass(ObjectClass.Check, words[1]);
        }
        if (words.Length != 1) throw Refuse(at, line, $"%{ClassKey} {words[0]} takes no argument");
        return new ObjectClass(words[0], null);
    }

    private static NetVarSetting ReadNetVar(string value, string at, string line)
    {
        var sep = value.IndexOf(": ", StringComparison.Ordinal);
        var key = sep < 0 ? "" : value.Substring(0, sep);
        if (key.Length == 0 || key.Any(c => !(char.IsLetterOrDigit(c) || c == '_' || c == '.')))
            throw Refuse(at, line, $"%{NetVarKey} reads `%{NetVarKey} <member>: <value>`");
        var v = value.Substring(sep + 2);
        return new NetVarSetting(key, v == "''" ? "" : v);
    }

    private static FileLink ReadFileLink(string value, string at, string line)
    {
        var sp = value.IndexOf(' ');
        if (sp <= 0) throw Refuse(at, line, $"%{FileLinkKey} reads `%{FileLinkKey} <link type> '<path>'`");
        return new FileLink(value.Substring(0, sp), ReadNonEmptyString(value.Substring(sp + 1), at, line, "%" + FileLinkKey));
    }

    private static string ReadNonEmptyString(string value, string at, string line, string named)
    {
        var s = ReadStString(value, at, line, named);
        if (s.Length == 0) throw Refuse(at, line, $"{named} with an empty string is its absence — remove the line");
        return s;
    }

    /// <summary>An ST STRING literal, alone: <c>'…'</c> with its <c>$</c>-escapes.</summary>
    /// <summary>The string an ST string literal spells (the inverse of <see cref="StString"/>).</summary>
    internal static string ReadString(string literal) => ReadStString(literal, "a property value", literal, "the value");

    private static string ReadStString(string value, string at, string line, string named)
    {
        var v = value.Trim();
        if (v.Length < 2 || v[0] != '\'' || v[v.Length - 1] != '\'')
            throw Refuse(at, line, $"{named} takes an ST string, '…' ($' for a quote, $$ for a dollar)");
        var sb = new StringBuilder();
        for (var i = 1; i < v.Length - 1; i++)
        {
            var c = v[i];
            if (c == '\'') throw Refuse(at, line, $"{named}: a quote inside the string is written $'");
            if (c != '$') { sb.Append(c); continue; }
            if (++i >= v.Length - 1) throw Refuse(at, line, $"{named}: a $ at the end of the string escapes nothing");
            var e = v[i];
            switch (char.ToUpperInvariant(e))
            {
                case '\'': sb.Append('\''); break;
                case '$': sb.Append('$'); break;
                case 'N': case 'L': sb.Append('\n'); break;
                case 'R': sb.Append('\r'); break;
                case 'T': sb.Append('\t'); break;
                case 'P': sb.Append('\f'); break;
                default:
                    if (i + 1 < v.Length - 1 && IsHex(e) && IsHex(v[i + 1]))
                    {
                        sb.Append((char)int.Parse(v.Substring(i, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                        i++;
                        break;
                    }
                    throw Refuse(at, line, $"{named}: '${e}' is no ST string escape");
            }
        }
        return sb.ToString();

        static bool IsHex(char c) => Uri.IsHexDigit(c);
    }

    /// <summary><paramref name="s"/> as an ST STRING literal: <c>'</c> → <c>$'</c>, <c>$</c> → <c>$$</c>, a line break
    /// <c>$N</c> / <c>$R</c>, a tab <c>$T</c>, any other control character <c>$hh</c> — one line, read back exactly.</summary>
    /// <summary>An ST string literal of <paramref name="s"/>, as every quoted property value spells it.</summary>
    internal static string StString(string s)
    {
        var sb = new StringBuilder("'");
        foreach (var c in s)
            sb.Append(c switch
            {
                '\'' => "$'",
                '$' => "$$",
                '\n' => "$N",
                '\r' => "$R",
                '\t' => "$T",
                _ when c < ' ' => "$" + ((int)c).ToString("X2", CultureInfo.InvariantCulture),
                _ => c.ToString(),
            });
        return sb.Append('\'').ToString();
    }
}
