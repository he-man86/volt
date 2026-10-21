namespace Volt.Tests.Shared;

/// <summary>
/// THE WIRE-PARITY GATE'S OFFLINE TWIN (openspec <c>bridge-one-to-one</c> §2.3): one expected text per case, asserted by
/// BOTH drivers' offline suites (<c>Volt.Ide.Codesys.Tests</c> / <c>Volt.Ide.Twincat.Tests</c>, each through its own
/// doubles). The same declaration must give byte-identical text on both vendors — the wire is keyed by what the text
/// says, and a project migrated between vendors must not show a diff for an object nobody changed.
///
/// <para>The LIVE half is <c>test/e2e/vendor-parity.test.ts</c> (both IDEs, never in CI); this half runs in CI and
/// shares nothing with it but the rule. Doubles assert what we believe the vendor holds, so neither half alone is the
/// gate (design §2.3: "offline only — fakes can assert a bug away; live only — invisible in CI").</para>
///
/// <para>A case a driver does not meet yet is red there (<c>ExpectRed</c>), named by the task that closes it.</para>
/// </summary>
public static class WireParityCases
{
    /// <summary>A stub manifest (a kind with no descriptor reader: visualization, text list, …) is ONE form on both
    /// vendors — <c>ItemKind.EmptyManifest(kind)</c>, the kind and a newline (design §1.1 "Non-source items and stubs").
    /// TwinCAT wrote <c>Name=&lt;name&gt;\n</c> (<c>BeckhoffDriver.Content.cs:811-812</c>): the name is the file's, and the
    /// same visualization hashed differently per vendor.</summary>
    public const string VisualizationStub = "visualization\n";

    /// <summary>The same, for a text list.</summary>
    public const string TextListStub = "text_list\n";

    /// <summary>A NON-system placeholder library reference — the one every project has on both vendors. <c>SYSTEM</c> is
    /// CODESYS's member (<c>SystemLibrary</c>, true 142 / false 122) and TwinCAT has none (<c>tc-library-system</c>,
    /// DIALECT C37): TwinCAT's hard-coded <c>SYSTEM false</c> is deleted (design §1.1 library manager), so the line is
    /// SPELLED ONLY WHERE IT IS TRUE — its absence is the value measured on every reference without the member, the rule
    /// §1.2 states for every flag. A CODESYS non-system reference then pulls byte-identically to TwinCAT's.</summary>
    public const string PlaceholderLibrary =
        "LIBRARY Util\n" +
        "NAMESPACE Util\n" +
        "RESOLUTION Util, 3.5.17.0 (System)\n" +
        "PLACEHOLDER true\n" +
        "MATERIALIZATION 4\n";

    /// <summary>The OTHER half of that decision, CODESYS's alone (TwinCAT has no system flag): a reference whose
    /// <c>SystemLibrary</c> is TRUE (142 of the census's 264) keeps its <c>SYSTEM true</c> line, in
    /// <c>LibraryManifest</c>'s order. Pinned beside the parity case so a fix that drops the SYSTEM line altogether — which
    /// would turn the parity case green — fails here.</summary>
    public const string SystemPlaceholderLibrary =
        "LIBRARY Util\n" +
        "NAMESPACE Util\n" +
        "RESOLUTION Util, 3.5.17.0 (System)\n" +
        "PLACEHOLDER true\n" +
        "SYSTEM true\n" +
        "MATERIALIZATION 4\n";

    /// <summary>The placeholder reference's facts both doubles carry.</summary>
    public const string LibraryName = "Util";
    public const string LibraryVersion = "3.5.17.0";
    public const string LibraryDistributor = "System";

    /// <summary>An interface property with a GET and no SET, its accessor declaration EMPTY — the text CODESYS holds for a
    /// scripting-made interface accessor (D41) and the spelling of TwinCAT's measured constant <c>PUBLIC / VAR /
    /// END_VAR</c> (<c>tc-itf-accessor-decl</c>, D21; design §1.1 classes, gate 1). The interface's own declaration is the
    /// header line.</summary>
    public const string InterfaceDeclaration = "INTERFACE I_Motor";

    /// <summary>A function block excluded from the build by its OWN flag (CODESYS <c>BuildProperty.ExcludeFromBuild</c>,
    /// TwinCAT's live <c>Exclude</c> VSProperty, DIALECT C39): the one property line under its implementation line.</summary>
    public const string ExcludedDeclaration = "FUNCTION_BLOCK FB_X\nVAR\nEND_VAR";
    public const string ExcludedBody = "x := 1;";
    public const string ExcludedFunctionBlock =
        "FUNCTION_BLOCK FB_X\n" +
        "VAR\n" +
        "END_VAR\n" +
        "IMPLEMENTATION ST\n" +
        "%EXCLUDE_FROM_BUILD\n" +
        "x := 1;\n" +
        "\n" +
        "END_FUNCTION_BLOCK\n";

    /// <summary>A function block linked always, external, with compiler defines (CODESYS <c>BuildProperty.LinkAlways</c> /
    /// <c>.External</c> / <c>.CompilerDefines</c>, TwinCAT's live <c>LinkAlways</c> / <c>External</c> /
    /// <c>CompilerDefines</c> VSProperties, DIALECT C40): the three property lines under its implementation line.</summary>
    public const string BuildPropertiesDefines = "SIM, X:=2";
    public const string BuildPropertiesFunctionBlock =
        "FUNCTION_BLOCK FB_X\n" +
        "VAR\n" +
        "END_VAR\n" +
        "IMPLEMENTATION ST\n" +
        "%LINK_ALWAYS\n" +
        "%EXTERNAL\n" +
        "%COMPILER_DEFINES 'SIM, X:=2'\n" +
        "x := 1;\n" +
        "\n" +
        "END_FUNCTION_BLOCK\n";

    /// <summary>The walk's answer for an EXCLUDED FOLDER <c>Sim</c> under <paramref name="root"/>, holding the struct
    /// <c>SimType</c> and the folder <c>Deep</c> with the struct <c>DeepType</c> (DIALECT C39): the folder is a node with its
    /// reason, and each item under it is named by its kind — in this order, on both vendors.</summary>
    public static (string Name, string Folder, string Reason, string? Kind)[] ExcludedFolderEntries(string root)
    {
        string At(string folder, string name) => folder.Length == 0 ? name : folder + "/" + name;
        var sim = At(root, "Sim");
        string Inside(string name) =>
            $"'{name}' sits in the excluded folder '{sim}' — it is not built, so it is not pulled as a built one";
        return new (string, string, string, string?)[]
        {
            ("Sim", root,
             "'Sim' holds its build property (ExcludeFromBuild) — it is no item, and Volt's text has no line for it (openspec " +
             "bridge-one-to-one §1.1: refused by name in the pull report); the objects in an excluded folder are not built, " +
             "so they are not pulled as built ones.", "folder"),
            ("SimType", sim, Inside("SimType"), "dut"),
            ("DeepType", At(sim, "Deep"), Inside("DeepType"), "dut"),
        };
    }

    public const string InterfaceWithGetter =
        "INTERFACE I_Motor\n" +
        "\n" +
        "PROPERTY Speed : INT\n" +
        "GET\n" +
        "END_GET\n" +
        "END_PROPERTY\n" +
        "\n" +
        "END_INTERFACE\n";
}
