import { createMiddleware } from "@solidjs/start/middleware"
import { LOCALE_HEADER, cookie, fromPathname, strip } from "~/lib/language"
import { normalizeReferralCode, referralCookie } from "~/lib/referral-invite"

export default createMiddleware({
  onRequest(event) {
    const url = new URL(event.request.url)

    // Volt: Go is the only product. Redirect opencode's Zen (pay-as-you-go) and Black (tiers) marketing pages
    // to Go. NOTE: exact "/zen" only — "/zen/v1/*" is the LLM gateway API and must pass through untouched.
    const p = url.pathname
    if (p === "/zen" || p === "/black" || p.startsWith("/black/")) {
      return Response.redirect(new URL("/go", url.origin).toString(), 302)
    }

    const locale = fromPathname(url.pathname)
    if (locale) {
      url.pathname = strip(url.pathname)
      const request = new Request(url, event.request)
      request.headers.set(LOCALE_HEADER, locale)
      event.request = request
      event.response.headers.append("set-cookie", cookie(locale))
    }

    const referralCode = normalizeReferralCode(url.searchParams.get("ref"))
    if (referralCode) event.response.headers.append("set-cookie", referralCookie(referralCode))
  },
})
