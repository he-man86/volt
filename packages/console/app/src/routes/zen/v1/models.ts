import type { APIEvent } from "@solidjs/start/server"
import { ZenData } from "@opencode-ai/console-core/model.js"
import { and, Database, eq, isNull } from "@opencode-ai/console-core/drizzle/index.js"
import { KeyTable } from "@opencode-ai/console-core/schema/key.sql.js"
import { WorkspaceTable } from "@opencode-ai/console-core/schema/workspace.sql.js"
import { ModelTable } from "@opencode-ai/console-core/schema/model.sql.js"
import { buildOptionsResponse, buildModelsResponse } from "~/routes/zen/util/modelsHandler"

export async function OPTIONS(_input: APIEvent) {
  return buildOptionsResponse()
}

export async function GET(input: APIEvent) {
  try {
    const disabledModels = await (() => {
      const apiKey = input.request.headers.get("authorization")?.split(" ")[1]
      if (!apiKey) return [] as string[]

      return Database.use((tx) =>
        tx
          .select({
            model: ModelTable.model,
          })
          .from(KeyTable)
          .innerJoin(WorkspaceTable, eq(WorkspaceTable.id, KeyTable.workspaceID))
          .innerJoin(ModelTable, and(eq(ModelTable.workspaceID, KeyTable.workspaceID), isNull(ModelTable.timeDeleted)))
          .where(and(eq(KeyTable.key, apiKey), isNull(KeyTable.timeDeleted)))
          .then((rows) => rows.map((row) => row.model)),
      )
    })()

    const models = Object.keys(ZenData.list("full").models)
      .filter((id) => !id.endsWith(":global"))
      .filter((id) => !disabledModels.includes(id))

    return buildModelsResponse(models)
  } catch (e: any) {
    // TEMP debug (remove after diagnosing the gateway 500): surface the real error nitro masks as "HTTPError".
    console.error("VOLT_ZEN_ERR", "name=", e?.name, "msg=", e?.message, "stack=", String(e?.stack).slice(0, 800))
    throw e
  }
}
