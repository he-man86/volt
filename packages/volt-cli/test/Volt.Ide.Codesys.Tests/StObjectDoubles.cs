// The Execute box's ST lives on an object the writer reaches by FULL NAME
// (`Reflection.FindType("_3S.CoDeSys.STObject.STImplementationObject")`), because it is in a different
// assembly from the NWL types. A double therefore has to carry the vendor's namespace as well as its name -
// which looks odd, and is the same rule the rest of `NwlDoubles` follows: the names ARE the contract.
namespace _3S.CoDeSys.STObject
{
    internal sealed class STImplementationObject
    {
        public Volt.Ide.Codesys.Tests.Nwl.TextDocument TextDocument { get; } =
            new Volt.Ide.Codesys.Tests.Nwl.TextDocument();
    }
}
