const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://volt.ai" : `https://${stage}.volt.ai`,
  console: stage === "production" ? "https://volt.ai/auth" : `https://${stage}.volt.ai/auth`,
  email: "contact@volt.ai",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/he-man86/volt",
  discord: "https://volt.ai/discord",
  headerLinks: [
    { name: "app.header.home", url: "/" },
    { name: "app.header.docs", url: "/docs/" },
  ],
}
