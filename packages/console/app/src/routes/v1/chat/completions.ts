import type { APIEvent } from "@solidjs/start/server"
import { handler } from "~/routes/zen/util/handler"
import { parseOpenAiVariant } from "~/routes/zen/util/variant"

// VOLT: the clean, public gateway path — `/v1/chat/completions` (the OpenAI-compatible convention), so a
// subscriber's `baseURL` is `volt-ai.dev/v1` with no opencode "zen/go" branding in the URL. This runs the same
// thin config as the vendored `zen/go/v1` handler (which is left intact) — the handler keys off the request body,
// not the URL path, so behaviour is identical. Independent of the console domain.
export function POST(input: APIEvent) {
  return handler(input, {
    format: "oa-compat",
    modelList: "lite",
    parseApiKey: (headers: Headers) => headers.get("authorization")?.split(" ")[1],
    parseModel: (url: string, body: any) => body.model,
    parseVariant: (url: string, body: any) => parseOpenAiVariant(body),
    parseIsStream: (url: string, body: any) => !!body.stream,
  })
}
