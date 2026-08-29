// ONE copy, linked into every netstandard2.0 project that needs it.
//
// `record` and `init` compile to a modreq on IsExternalInit, which netstandard2.0 does not ship — so every
// project that declares one needs this type. It was copy-pasted into four of them (Contracts, Wire, Engine,
// Engine.Host), which is three copies of a file whose whole content is a compiler requirement.
//
// It stays INTERNAL. A public IsExternalInit in one assembly would be visible to the others and collide the
// moment two of them are referenced together.
namespace System.Runtime.CompilerServices
{
    internal static class IsExternalInit { }
}
