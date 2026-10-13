using System;
using System.Collections.Generic;
using System.Globalization;

namespace Volt.Connector;

/// <summary>
/// WHERE THE USER FINDS CODESYS's "Execute Script File" — in the words their CODESYS shows (environment-dependency-audit
/// 2.7). Activation is a step the USER takes inside CODESYS (the connector never launches it), and the steps named the
/// English menu to everyone. CODESYS translates all three levels; these are its own strings, read 2026-10-13 from
/// <c>Settings\Standard.opt.menu</c> (the menu tree's <c>LocalizedTexts</c>: Tools, Scripting) and the ScriptEngine
/// plugin's satellites (<c>ExecuteScriptFileName</c>, <c>CommandCategoryText</c>), identical on 3.5.21.40, 32-bit
/// 3.5.21.60 and 3.5.22.40 (plugin 4.2.0.0). 3.5.18.30 (plugin 4.0.0.0) differs only in German, "Skript-Datei ausführen".
///
/// <para>Which language CODESYS shows is CODESYS's own setting, unknown before it serves; the steps show English always
/// and, beside it, the path in the user's Windows UI language when CODESYS ships that language (else CODESYS falls back
/// to English, and a second line would name a menu nobody sees). The command itself is not feature-set gated (the
/// ScriptEngine plugin references no feature setting); an OEM product may still trim its menus, hence the category,
/// under which Tools → Customize lists the command (DIALECT V8).</para>
/// </summary>
public static class CodesysMenuPath
{
    public const string English = "Tools → Scripting → Execute Script File...";
    private const string EnglishCategory = "ScriptEngine Commands";
    private const string EnglishExecute = "Execute Script File...";

    // Where 3.5.18.30 (ScriptEngine 4.0.0.0) words the command differently — German only (DIALECT V8). The connector
    // cannot know which CODESYS the user will open, so the path names both (gate 2c+3 review).
    private static readonly Dictionary<string, string> Sp18Execute = new(StringComparer.Ordinal)
    {
        ["de"] = "Skript-Datei ausführen",
    };

    // CODESYS's language folder → (Tools, Scripting, Execute Script File, command category).
    private static readonly Dictionary<string, (string Tools, string Scripting, string Execute, string Category)> Languages =
        new(StringComparer.Ordinal)
        {
            ["de"] = ("Tools", "Skripting", "Skriptdatei ausführen...", "ScriptEngine Kommandos"),
            ["es"] = ("Herramientas", "Scripting", "Ejecutar archivo script", "Comandos ScriptEngine"),
            ["fr"] = ("Outils", "Script", "Exécuter le fichier script", "Commandes ScriptEngine"),
            ["it"] = ("Tools", "Scripting", "Esegui file script", "Comandi ScriptEngine"),
            ["ja"] = ("ツール (T)", "スクリプト作成", "スクリプトファイルの実行... (E)", "ScriptEngine コマンド"),
            ["pt-BR"] = ("Ferramentas", "Scripting", "Executar arquivo de script...", "Comandos ScriptEngine"),
            ["ru"] = ("Инструменты", "Скрипты", "Выполнить скрипт...", "Команды скриптового движка"),
            ["tr"] = ("Araçlar", "Komut dosyası oluşturuluyor", "Komut Dosyasını Yürüt...", "ScriptEngine Komutları"),
            ["zh-CHS"] = ("工具", "脚本", "执行脚本文件...", "脚本引擎命令"),
        };

    /// <summary>The path in <paramref name="ui"/>'s language, or null where CODESYS shows English.</summary>
    public static string? Localized(CultureInfo ui)
    {
        if (Folder(ui) is not { } f) return null;
        var path = $"{Languages[f].Tools} → {Languages[f].Scripting} → {Languages[f].Execute}";
        return Sp18Execute.TryGetValue(f, out var sp18) ? $"{path} (CODESYS 3.5.18: {sp18})" : path;
    }

    /// <summary>The command as Tools → Customize lists it — its category and its name, both in <paramref name="ui"/>'s
    /// language (never a localized category beside the English command).</summary>
    public static string CustomizeEntry(CultureInfo ui) =>
        Folder(ui) is { } f ? $"{Languages[f].Category} → {Languages[f].Execute}" : $"{EnglishCategory} → {EnglishExecute}";

    /// <summary>CODESYS's satellite folder for a UI culture: the neutral language, except Portuguese (pt-BR only) and
    /// Chinese (simplified only, CODESYS's legacy `zh-CHS`).</summary>
    private static string? Folder(CultureInfo ui)
    {
        var lang = ui.TwoLetterISOLanguageName;
        string? folder = lang switch
        {
            "pt" => ui.Name == "pt-BR" ? "pt-BR" : null,
            "zh" => IsSimplifiedChinese(ui) ? "zh-CHS" : null,
            _ => lang,
        };
        return folder is not null && Languages.ContainsKey(folder) ? folder : null;
    }

    private static bool IsSimplifiedChinese(CultureInfo ui)
    {
        for (var c = ui; !c.Equals(CultureInfo.InvariantCulture); c = c.Parent)
            if (c.Name is "zh-Hans" or "zh-CHS") return true;
        return false;
    }
}
