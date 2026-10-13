using System.Globalization;
using Volt.Connector;
using Xunit;

namespace Volt.Connector.Tests;

/// <summary>
/// THE ACTIVATION HINT NAMES THE MENU THE USER SEES (environment-dependency-audit 2.7). The connector's steps said
/// "Tools → Scripting → Execute Script File…" to everyone; a German CODESYS shows "Tools → Skripting → Skriptdatei
/// ausführen...", a Russian one "Инструменты → Скрипты → Выполнить скрипт...". The words are CODESYS's own, read from
/// its menu file (<c>Settings\Standard.opt.menu</c>, LocalizedTexts) and the ScriptEngine plugin's satellites
/// (<c>ExecuteScriptFileName</c>) — identical on 3.5.21.40, 32-bit 3.5.21.60 and 3.5.22.40 (plugin 4.2.0.0).
/// </summary>
public class CodesysMenuPathTests
{
    [Theory]
    [InlineData("de-DE", "Tools → Skripting → Skriptdatei ausführen... (CODESYS 3.5.18: Skript-Datei ausführen)")]
    [InlineData("de-AT", "Tools → Skripting → Skriptdatei ausführen... (CODESYS 3.5.18: Skript-Datei ausführen)")]
    [InlineData("ru-RU", "Инструменты → Скрипты → Выполнить скрипт...")]
    [InlineData("tr-TR", "Araçlar → Komut dosyası oluşturuluyor → Komut Dosyasını Yürüt...")]
    [InlineData("fr-FR", "Outils → Script → Exécuter le fichier script")]
    [InlineData("es-ES", "Herramientas → Scripting → Ejecutar archivo script")]
    [InlineData("it-IT", "Tools → Scripting → Esegui file script")]
    [InlineData("ja-JP", "ツール (T) → スクリプト作成 → スクリプトファイルの実行... (E)")]
    [InlineData("pt-BR", "Ferramentas → Scripting → Executar arquivo de script...")]
    [InlineData("zh-CN", "工具 → 脚本 → 执行脚本文件...")]
    public void A_language_CODESYS_ships_gets_its_own_menu_path(string culture, string path) =>
        Assert.Equal(path, CodesysMenuPath.Localized(CultureInfo.GetCultureInfo(culture)));

    /// <summary>English is the path the steps always show; a language CODESYS does not ship (Dutch, Polish) has no
    /// second line — CODESYS then shows English too, so a made-up translation would point at a menu nobody sees.</summary>
    [Theory]
    [InlineData("en-US")]
    [InlineData("en-GB")]
    [InlineData("nl-NL")]
    [InlineData("pl-PL")]
    [InlineData("pt-PT")]   // CODESYS ships pt-BR only
    [InlineData("zh-TW")]   // CODESYS ships simplified Chinese only
    public void No_second_path_where_CODESYS_shows_English(string culture) =>
        Assert.Null(CodesysMenuPath.Localized(CultureInfo.GetCultureInfo(culture)));

    [Fact]
    public void The_English_path_is_the_menu_files_own() =>
        Assert.Equal("Tools → Scripting → Execute Script File...", CodesysMenuPath.English);

    /// <summary>For a CODESYS whose menu was customized or trimmed (an OEM product), the command is found by its
    /// category in Tools → Customize — named in the user's language too, the command beside it in the same language.</summary>
    /// <remarks>The Customize hint names the COMMAND in the same language as its category (gate 2c+3 review: the
    /// category was localized and the command left English — a German dialog lists "Skriptdatei ausführen...").</remarks>
    [Theory]
    [InlineData("en-US", "ScriptEngine Commands → Execute Script File...")]
    [InlineData("nl-NL", "ScriptEngine Commands → Execute Script File...")]
    [InlineData("de-DE", "ScriptEngine Kommandos → Skriptdatei ausführen...")]
    [InlineData("ru-RU", "Команды скриптового движка → Выполнить скрипт...")]
    public void The_customize_entry_names_the_command_in_the_categorys_language(string culture, string entry) =>
        Assert.Equal(entry, CodesysMenuPath.CustomizeEntry(CultureInfo.GetCultureInfo(culture)));
}
