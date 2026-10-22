using System;
using System.Collections.Generic;

namespace Volt.Engine.Seam;

/// <summary>Everything one vendor host states about itself (<see cref="IVendorSession.Declaration"/>): its id and name, its
/// kinds, its body languages and its object-property keys. Data plus the plug-ins its rows carry (a source kind's
/// <see cref="IItemFormat"/>, a shown language's <see cref="IBodyReader"/>) — no behaviour of its own.</summary>
public sealed record VendorDeclaration(
    VendorRow Vendor,
    IReadOnlyList<KindRow> Kinds,
    IReadOnlyList<LanguageRow> Languages,
    IReadOnlyList<PropertyKey> PropertyKeys);

/// <summary>The four registries, filled from the declarations of every vendor a process knows. Registration is
/// all-or-refused per declaration order: the first conflict throws, naming both vendors, so two hosts that spell one
/// fact differently cannot both start.</summary>
public sealed class Catalog
{
    public VendorRegistry Vendors { get; } = new();
    public KindRegistry Kinds { get; } = new();
    public LanguageRegistry Languages { get; } = new();
    public PropertyKeyRegistry PropertyKeys { get; } = new();

    public static Catalog Of(params VendorDeclaration[] declarations)
    {
        var catalog = new Catalog();
        foreach (var d in declarations ?? throw new ArgumentNullException(nameof(declarations))) catalog.Register(d);
        return catalog;
    }

    public void Register(VendorDeclaration declaration)
    {
        if (declaration is null) throw new ArgumentNullException(nameof(declaration));
        Vendors.Register(declaration.Vendor);
        var id = declaration.Vendor.Id;
        Kinds.Register(id, declaration.Kinds);
        Languages.Register(id, declaration.Languages);
        PropertyKeys.Register(id, declaration.PropertyKeys);
    }
}
