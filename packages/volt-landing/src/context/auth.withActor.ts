import { Actor } from "@opencode-ai/console-core/actor.js"
import { getActor } from "./auth"

// The universal server-side guard — resolves the actor for a workspace, then runs fn in its context.
// Ported from packages/console/app/src/context/auth.withActor.ts.
export async function withActor<T>(fn: () => T, workspace?: string) {
  const actor = await getActor(workspace)
  return Actor.provide(actor.type, actor.properties, fn)
}
