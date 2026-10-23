namespace Volt.Engine.Seam;

/// <summary>A kind's accessors: none, GET/SET with bodies of their own (a property), or GET/SET that are declarations only
/// (a signature property — an interface's).</summary>
public enum AccessorShape { None, WithBodies, DeclarationsOnly }

/// <summary>What an item or a member of a kind HOLDS, as the engine reads it — the row a host declares for a source or a
/// member kind (<see cref="KindRow.Shape"/>). How a file LAYS it out (a split file, members inside the block) is the
/// format's own fact, not the kind's (design step 4, F6).</summary>
/// <param name="Members">An item of the kind holds members (methods, actions, properties, routines).</param>
/// <param name="Body">It has an implementation: a body, keyed by its language.</param>
/// <param name="Accessors">What its GET/SET are.</param>
/// <param name="Signature">A create takes its declared type as the argument (<see cref="CreateArgs.Signature"/>).</param>
public readonly record struct KindShape(bool Members, bool Body, AccessorShape Accessors, bool Signature);
