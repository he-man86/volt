using System;
using System.Collections.Generic;

namespace Volt.Engine.Item;

/// <summary>
/// THE OBJECT PROPERTIES OF ONE VENDOR OBJECT, vendor-neutral (openspec <c>bridge-one-to-one</c> §1.2): every member of
/// the vendor's object that is neither its text nor a measured editor cache — its class where the text cannot tell it,
/// its build properties, its comment, its network-variable settings, its file link. Each field is a named property
/// whose text form is a <c>%</c>-line beside <c>%FOLDER</c> (<c>%CLASS …</c>, <c>%EXCLUDE_FROM_BUILD</c>, …); a field's
/// ABSENCE (null / false / 0 / empty) is the value measured on every object that has no such vendor property, and the
/// line is then absent.
///
/// <para><b>Closed and typed on purpose.</b> An open key/value bag mirroring the vendor archive would put the vendor's
/// representation above the seam (and the vendors' values differ for the same class — <c>SFCProperty</c> 3.4.2.0 vs
/// 4.4.0.0). A driver that reads a vendor member no field names refuses the ITEM by name; it never drops it.</para>
///
/// <para><b>Where it lives:</b> a REQUIRED field of <see cref="ItemContent"/> and <see cref="Member"/> — never defaulted,
/// so a driver that has not read an object's properties cannot build its content. The driver reads it inside
/// <c>ReadContent</c> and writes it inside <c>WriteContent</c>; the text spells it as <c>%</c>-lines
/// (<c>Format/St/PropertyLines</c>); the class is made at the create (<c>IVendorTree.CreateChild</c>), never changed in
/// place (openspec <c>bridge-one-to-one</c> §3).</para>
/// </summary>
public sealed record ObjectProperties(
    ObjectClass? Class,
    bool ExcludeFromBuild,
    bool LinkAlways,
    bool External,
    bool EnableSystemCall,
    int OnlineChangeReserve,
    string? CompilerDefines,
    IReadOnlyList<string> Undefines,
    string? Comment,
    bool ParameterList,
    IReadOnlyList<NetVarSetting> NetVar,
    FileLink? FileLink)
{
    /// <summary>For a kind that has NO vendor carrier at all — a task, a library reference, a device: their members
    /// travel in their descriptor. A source driver never passes it for an object it did not read.</summary>
    public static readonly ObjectProperties None = new(
        null, false, false, false, false, 0, null, Array.Empty<string>(), null, false, Array.Empty<NetVarSetting>(), null);

    /// <summary>Record equality compares the two lists by reference; two property sets are the same when every field
    /// and every list element is.</summary>
    public bool Equals(ObjectProperties? other) =>
        other is not null
        && Equals(Class, other.Class)
        && ExcludeFromBuild == other.ExcludeFromBuild
        && LinkAlways == other.LinkAlways
        && External == other.External
        && EnableSystemCall == other.EnableSystemCall
        && OnlineChangeReserve == other.OnlineChangeReserve
        && CompilerDefines == other.CompilerDefines
        && System.Linq.Enumerable.SequenceEqual(Undefines, other.Undefines)
        && Comment == other.Comment
        && ParameterList == other.ParameterList
        && System.Linq.Enumerable.SequenceEqual(NetVar, other.NetVar)
        && Equals(FileLink, other.FileLink);

    public override int GetHashCode() =>
        ((Class?.GetHashCode() ?? 0) * 397) ^ (ExcludeFromBuild ? 1 : 0) ^ (LinkAlways ? 2 : 0) ^ (External ? 4 : 0)
        ^ (EnableSystemCall ? 8 : 0) ^ (ParameterList ? 16 : 0) ^ (OnlineChangeReserve << 5) ^ (Comment?.GetHashCode() ?? 0);
}

/// <summary>The vendor class the text cannot tell, as its <c>%CLASS</c> line spells it: <c>CHECK CheckBounds</c>,
/// <c>PERSISTENT</c>, <c>TEXTLIST_ENUM</c>, <c>NVL</c>.</summary>
public sealed record ObjectClass(string Word, string? Argument)
{
    public const string Check = "CHECK";
    public const string Persistent = "PERSISTENT";
    public const string TextListEnum = "TEXTLIST_ENUM";
    public const string Nvl = "NVL";

    /// <summary>The vendor's ABSTRACT METHOD class with NO BODY SLOT — NEVER SPELLED (no <c>%CLASS</c> line takes it): it
    /// is derived from the TEXT, a <c>METHOD ABSTRACT</c> that states no <c>%LANGUAGE</c> line (openspec
    /// <c>language-line</c>, DIALECT C2n), and passed only to <c>IVendorTree.CreateChild</c>, so the create makes the
    /// object the text states: CODESYS constructs its <c>AbstractPOUMethodObject</c> (C2r); TwinCAT has one method class,
    /// always with a slot (C2n), and refuses it by name. The push derives it in one place
    /// (<c>PushService.CreateClass</c>).</summary>
    public const string AbstractMethod = "ABSTRACT";

    /// <summary>The one <see cref="AbstractMethod"/> value.</summary>
    public static readonly ObjectClass AbstractMethodClass = new(AbstractMethod, null);

    public override string ToString() => Argument is null ? Word : $"{Word} {Argument}";
}

/// <summary>One network-variable member: the vendor member's name and its value as the vendor renders it
/// (<c>%NETVAR &lt;Key&gt;: &lt;value&gt;</c>).</summary>
public sealed record NetVarSetting(string Key, string Value);

/// <summary>A GVL linked to an external file (<c>%FILE_LINK &lt;LinkType&gt; '&lt;path&gt;'</c>).</summary>
public sealed record FileLink(string LinkType, string Path);
