/**
 * Volt login — registers auth for the "volt" provider so `opencode auth login` → Volt lets a subscriber
 * connect their volt-ai.dev account. The gateway (https://volt-ai.dev/v1, see `provider.volt` in
 * opencode.json) is an OpenAI-compatible endpoint; this hook supplies the subscriber's key to it.
 *
 * Today: **api-key paste** — get your key from the volt-ai.dev dashboard and paste it. Works the moment
 * the backend is live and you have a subscription. A browser **oauth** method (device flow against the
 * OpenAuth issuer at auth.volt-ai.dev) can be added as a second entry in `methods` once that's deployed —
 * the auth hook already supports `type: "oauth"` with an authorize()/callback flow.
 *
 * Untyped by design: this is an opencode plugin (opencode consumes the returned hook shape at load) and Volt
 * doesn't depend on the @opencode-ai/plugin npm package — only the opencode binary at runtime.
 */
export const VoltAuthPlugin = async () => {
  return {
    auth: {
      provider: "volt",
      // Turn the stored credential into the openai-compatible provider's runtime options.
      loader: async (getAuth) => {
        const auth = await getAuth()
        if (auth?.type === "api") return { apiKey: auth.key }
        return {}
      },
      methods: [
        {
          type: "api",
          label: "Paste API key (from volt-ai.dev dashboard)",
          prompts: [
            {
              type: "text",
              key: "key",
              message: "Volt API key",
              placeholder: "sk-...",
              validate: (value) =>
                value && value.trim().startsWith("sk-") ? undefined : "Volt keys start with 'sk-'",
            },
          ],
          authorize: async (inputs) => {
            const key = inputs?.key?.trim()
            if (!key) return { type: "failed" }
            return { type: "success", key }
          },
        },
      ],
    },
  }
}
