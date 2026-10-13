using System.Linq;
using System.Text.RegularExpressions;
using Volt.Engine.Ide;

namespace Volt.Ide.Codesys;

/// <summary>
/// CODESYS's OWN WORDS for refusing a child — in every language it ships (DIALECT V9, openspec
/// <c>environment-dependency-audit</c> 2.6). The refusal reaches the bridge only as an exception MESSAGE, written in the
/// IDE's UI language: a German CODESYS (measured live 2026-10-13, 32-bit 3.5.21.60) answered "Der Name 'Vlt__Log' ist für
/// dieses Objekt nicht gültig.", which the English-only match classified as no refusal at all — INTERNAL_ERROR on the
/// wire. These are the vendor's resource formats, read from its satellites: <c>ObjectNameInvalidException</c> (Core and
/// Objects — two slightly different translations per language) and <c>ObjectInvalidOrNotAcceptedByParent</c>
/// (ScriptDriverProjects), identical on 3.5.18.30, 3.5.21.40, 3.5.21.60 and 3.5.22.40 (3.5.18.30 has no pt-BR/tr).
/// A message matches a format WHOLE but for its argument and trailing punctuation — never a substring of it: "Scope is
/// not valid for this object." (VarDeclObject's <c>InvalidScope</c>) is not a name refusal.
/// </summary>
internal static class CodesysRefusalWording
{
    /// <summary>The child's NAME is refused (<c>ObjectNameInvalidException</c>).</summary>
    internal static readonly string[] Name =
    {
        "The name '{0}' is not valid for this object.",
        // Core.resources
        "Der Name '{0}' ist für dieses Objekt nicht gültig.",
        "El nombre '{0}' no es válido para este objeto.",
        "Le nom « {0} » n’est pas valide pour cet objet.",
        "Nome '{0}' non valido per questo oggetto.",
        "名前 '{0}' はこのオブジェクトには有効ではありません。",
        "Имя '{0}' не подходит для этого объекта.",
        "名称 '{0}' 对于本工程无效。",
        // Objects.resources
        "Le nom '{0}' n’est pas valide pour cet objet.",
        "Il nome '{0}' non è valido per questo oggetto.",
        "名前「{0}」はこのオブジェクトには有効ではありません。",
        "O nome '{0}' não é válido para este objeto.",
        "Имя '{0}' недопустимо для этого объекта.",
        "'{0}' adı bu nesne için geçerli değil.",
        "名称'{0}'对此对象无效.",
    };

    /// <summary>The child's KIND is not accepted under its parent (<c>ObjectInvalidOrNotAcceptedByParent</c>).</summary>
    internal static readonly string[] Kind =
    {
        "Object '{0}' is not accepted by parent object, or invalid (e. g. missing plugin or device description).",
        "Objekt '{0}' wird vom Vaterobjekt nicht akzeptiert oder ist nicht gültig z.B, fehlendes PlugIn oder Gerätebeschreinung).",
        "El objeto '{0}' no es aceptado por el objeto padre o no es válido (p. ej. falta un complemento o una descripción de dispositivo).",
        "L'objet '{0}' n'est pas accepté par l'objet père ou n'est pas valide, p.ex. plug-in ou description d'appareil manquants).",
        "L'oggetto '{0}' non viene accettato dall'oggetto padre o non è valido; ad es. plug-in o descrizione del dispositivo mancante).",
        "オブジェクト「{0}」は親オブジェクトが許可できないものか、無効 (例: プラグインまたはデバイス ディスクリプションが見つからない) なものです。",
        "O objeto '{0}' não é aceito pelo objeto pai ou é inválido (por exemplo, plug-in ou descrição do dispositivo em falta).",
        "Объект '{0}' не принят родительским объектом или некорректен (например, отсутствует плагин или описание устройства)",
        "'{0}' nesnesi ana nesne tarafından kabul edilmiyor veya geçersiz (örneğin eksik eklenti veya aygıt açıklaması).",
        "对象'{0}'不是被父对象接受或无效(例如G.缺少插件或设备描述).",
    };

    private static readonly Regex[] NameShapes = Name.Select(Shape).ToArray();
    private static readonly Regex[] KindShapes = Kind.Select(Shape).ToArray();

    /// <summary>The format as a whole-message pattern: the argument any text, trailing punctuation optional.</summary>
    private static Regex Shape(string format)
    {
        var body = format.TrimEnd('.', '。', ')');
        var tail = format.Substring(body.Length);
        var parts = body.Split(new[] { "{0}" }, System.StringSplitOptions.None).Select(Regex.Escape);
        return new Regex("^\\s*" + string.Join(".+?", parts) + "[" + Regex.Escape(tail) + "]*\\s*$",
            RegexOptions.CultureInvariant | RegexOptions.Singleline);
    }

    /// <summary>Which refusal <paramref name="message"/> is, or null for any other message.</summary>
    internal static ChildRefusalCause? Of(string message) =>
        KindShapes.Any(r => r.IsMatch(message)) ? ChildRefusalCause.Kind
        : NameShapes.Any(r => r.IsMatch(message)) ? ChildRefusalCause.Name
        : null;
}
