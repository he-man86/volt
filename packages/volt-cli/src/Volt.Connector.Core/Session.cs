using System;
using System.Collections.Generic;

namespace Volt.Connector
{
    /// <summary>
    /// The durable identity a client declares interest in: the workspace binding <c>{vendor, projectName}</c> — what
    /// <c>.git/volt/config.json</c> stores — NOT an ephemeral project id. The reconciler resolves it to the currently
    /// detected project by vendor+name every pass, so an interest survives an IDE restart (the connector re-resolves)
    /// and a workspace can declare interest before its IDE is even open (it binds the moment the project appears).
    ///
    /// <para>Vendor is here because it is part of the binding, NOT to disambiguate same-name projects — it cannot:
    /// two projects sharing a name collapse to one detected row whether they are cross-vendor or two instances of one
    /// vendor. That collapse is the accepted identity limit (see the connector-session-model design), out of scope.</para>
    /// </summary>
    public sealed record Interest(string Vendor, string ProjectName);

    /// <summary>
    /// One client's presence: the FULL set of projects it currently wants (0..n) and a lease that lapses unless
    /// renewed. A session past <see cref="ExpiresAt"/> contributes nothing to the desired set — a client going away,
    /// cleanly (<c>DELETE /session</c>) or by crash (lease expiry), is just "its interests disappeared." The interest
    /// set is declared whole on every sync (idempotent), so there is no add/remove delta to lose.
    /// </summary>
    public sealed record Session(string Id, IReadOnlyCollection<Interest> Interests, DateTime ExpiresAt);
}
