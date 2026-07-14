// Gutted from opencode's infra/app.ts, which deployed packages Volt doesn't vendor:
//   - the `Api` Cloudflare Worker (packages/function — GitHub app + sync durable object)
//   - the `Web` Astro docs site (packages/web)
//   - the `WebApp` static site (packages/app — opencode's agent GUI)
// The only thing the rest of the infra needs from here is EMAILOCTOPUS_API_KEY, kept below.
// TODO(volt): EmailOctopus is opencode's newsletter integration — drop it if console/app doesn't use it,
// or set the secret. It's linked into the console frontend in console.ts.
export const EMAILOCTOPUS_API_KEY = new sst.Secret("EMAILOCTOPUS_API_KEY")
