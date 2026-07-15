import type { APIEvent } from "@solidjs/start/server"
import { handler } from "~/routes/zen/util/handler"
import { parseAnthropicVariant } from "~/routes/zen/util/variant"

// VOLT: clean public gateway path — `/v1/messages` (Anthropic-compatible convention). Mirrors the vendored
// `zen/go/v1/messages` config; see v1/chat/completions.ts.
export function POST(input: APIEvent) {
  return handler(input, {
    format: "anthropic",
    modelList: "lite",
    parseApiKey: (headers: Headers) => headers.get("x-api-key") ?? undefined,
    parseModel: (url: string, body: any) => body.model,
    parseVariant: (url: string, body: any) => parseAnthropicVariant(body),
    parseIsStream: (url: string, body: any) => !!body.stream,
  })
}
