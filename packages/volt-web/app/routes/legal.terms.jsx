import { LegalPage } from "../components/LegalPage.jsx"

// Volt Terms of Service.
//
// Rewritten 29 July 2026 for the architecture Volt ACTUALLY has. The previous version described a hosted cloud
// service with user accounts, an AI gateway that proxied prompts, and Stripe billing — none of which exist
// (openspec/changes/sell-cli-subscription deleted all three). It was inherited from the PLC Assist SaaS docs and
// never reconciled.
//
// What changed structurally: this is a SOFTWARE LICENCE, not a SaaS agreement. Volt is software you download and
// run; there is no service to be "available", no account to secure, and no content for us to receive. Sections
// that only make sense for a hosted service (accounts, our-content-licence, service availability) are gone.
//
// What was KEPT, deliberately: the safety-critical notice (§6), disclaimers, liability cap, indemnification and
// NL governing law. Those were sound and are, if anything, more important for software that writes PLC code.
const UPDATED = "29 July 2026"
// Each section is [title, body, bullets?]. bullets renders as a list under the body.
const SECTIONS = [
  [
    "1. Agreement to these terms",
    "These Terms of Service (“Terms”) govern your use of Volt — the command-line tools, the language server, the IDE bridges, the tray connector, the desktop application and the VS Code extension (together, “Volt” or “the Software”), published by Volt (“we”, “us”). By downloading, installing or using the Software you agree to these Terms. If you use it on behalf of an organization, you accept these Terms for that organization.",
  ],
  [
    "2. What Volt is — and what it is not",
    "Volt is software you download and run on your own machines. It is a toolchain for managing IEC 61131-3 PLC projects (CODESYS, TwinCAT/Beckhoff) as version-controllable text, and for making those projects legible to an AI coding agent. We do not operate a server, a hosted service, or an account system as part of it. Specifically:",
    [
      "Your PLC projects stay in a git repository on your own machines. We never receive them.",
      "We do not host, proxy or relay AI requests. You supply your own AI provider key, and your agent talks to that provider directly. We are not a party to those requests and cannot see them.",
      "There is no Volt account, no sign-in and no password. A licence key is the only credential.",
      "Apart from licence checks and update downloads (§4, §5), Volt does not contact us during normal use.",
    ],
  ],
  [
    "3. Licence to use the Software",
    "Subject to these Terms, we grant you a limited, non-exclusive, non-transferable, revocable licence to install and use the Software. You may use it for commercial work. You may not: sublicense, resell or redistribute the Software; remove or alter its notices; or circumvent the licence checks or the project allowance described in §4. You may reverse-engineer it only to the extent that restriction is unenforceable under applicable law. We reserve all rights not expressly granted. Open-source components included in the Software are licensed under their own terms, which prevail for those components.",
  ],
  [
    "4. Plans, the free allowance, and offline use",
    "Volt is free for up to three bound PLC projects. A paid subscription removes that limit. The count is enforced by the Software on your own machine against the projects you have bound; it is not a report of your activity to us.",
    [
      "Activation is explicit. Running the login command exchanges your licence key for an activation with our licensing provider (§5) and caches the result locally.",
      "Routine commands do not contact the network. They read the cached result.",
      "If your machine is offline, Volt keeps working normally for 14 days. After that, projects you have already bound continue to work — only binding a NEW project is blocked until it can revalidate.",
      "An activation is per machine. Your licence key is personal to you; do not share or publish it.",
    ],
  ],
  [
    "5. Purchase, billing and refunds",
    "Subscriptions are sold through Polar, which acts as the merchant of record. That means your purchase contract for the transaction is with Polar, not with us: Polar takes payment, charges and remits any applicable VAT or sales tax, issues and revokes licence keys, and provides the customer portal where you manage or cancel your subscription and retrieve invoices. Polar’s own terms and privacy policy govern the payment itself. Subscriptions renew automatically until cancelled; cancelling stops the next renewal and your licence remains valid until the end of the period you have paid for. We may change pricing with reasonable notice, effective from your next renewal. Statutory withdrawal and refund rights — including EU/UK consumer rights where they apply to you — are unaffected by these Terms.",
  ],
  [
    "6. Safety-critical notice",
    "Volt is an engineering aid, not a certified safety system. It is not qualified, certified or intended to serve as the basis of safety-critical or life-critical control without independent verification. PLC code governs physical equipment and people, and deploying untested or unverified code to industrial control systems can cause equipment damage, production loss, environmental harm, or serious injury or death. You are solely responsible for the safe use of any code — whether written by you, by Volt, or by an AI model. Before commissioning or deploying, you must:",
    [
      "Review all code — including AI-generated or AI-modified code — for correctness and intent.",
      "Test in a safe, controlled environment before deploying to any PLC, controller, or live system.",
      "Ensure compliance with all applicable safety standards (for example IEC 61131-3, IEC 62443, ISO 13849) and your site procedures.",
      "Perform proper risk assessments before deploying to production systems.",
      "Maintain emergency stops, interlocks, and fail-safes that operate independently of software.",
      "You assume all risk of deployment.",
    ],
  ],
  [
    "7. AI-assisted code generation",
    "Volt can drive an AI coding agent (such as the open-source opencode) against your project using an AI provider key that you supply. The agent and the provider are third parties: you choose them, you contract with them, and their terms and pricing govern your use of them. AI output is provided on an “as-is” basis with no guarantee of correctness, completeness, safety or fitness for any purpose. It may contain errors or logical flaws, may not comply with applicable safety standards, may be unsuitable for safety-critical applications, and may misinterpret your intent. Everything in §6 applies with full force to code that an AI produced. Because we are not in the path of those requests, we cannot and do not review, filter, log or moderate what you send or what comes back.",
  ],
  [
    "8. Your projects and your content",
    "You retain all rights to your PLC projects, source code and other content. We claim no ownership of them and acquire no licence to them. Volt reads and writes your files on your machine to do its job; nothing is transmitted to us. We do not use your content to train models, because we never receive it.",
  ],
  [
    "9. Acceptable use",
    "You agree not to use the Software unlawfully or to infringe the rights of others, and not to circumvent its licensing (§3, §4). Because we operate no service, there is nothing here about overloading or abusing our infrastructure — but you remain bound by the terms of the third parties you connect Volt to, including your AI provider and your PLC vendor’s software.",
  ],
  [
    "10. Third-party software",
    "Volt interoperates with software we do not publish or control — CODESYS and TwinCAT/Beckhoff, the opencode agent, AI model providers, git, and your operating system. We do not supply, endorse or warrant them, we are not responsible for their behaviour, and your use of each is governed by its own terms. Volt does not install opencode for you; it makes your own installation PLC-aware if it is present.",
  ],
  [
    "11. Updates",
    "Volt can check for and install updates, downloading them from our public release location. Updates may add, change or remove functionality. We may discontinue a feature or the Software itself; if we discontinue a paid product, you may cancel and, where required by law, receive a pro-rata refund for the unused period.",
  ],
  [
    "12. Disclaimers",
    "THE SOFTWARE IS PROVIDED “AS IS” AND “AS AVAILABLE” WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, ACCURACY, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SOFTWARE WILL BE UNINTERRUPTED OR ERROR-FREE, THAT DEFECTS WILL BE CORRECTED, OR THAT ANY OUTPUT IS ACCURATE, SAFE, OR SUITABLE FOR ANY PURPOSE. NOTHING IN THESE TERMS EXCLUDES LIABILITY THAT CANNOT LAWFULLY BE EXCLUDED — INCLUDING LIABILITY FOR DEATH OR PERSONAL INJURY CAUSED BY NEGLIGENCE, FOR FRAUD, OR UNDER MANDATORY CONSUMER LAW.",
  ],
  [
    "13. Limitation of liability",
    "TO THE MAXIMUM EXTENT PERMITTED BY LAW, AND SUBJECT TO THE FINAL SENTENCE OF §12, WE WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL OR PUNITIVE DAMAGES, OR FOR LOST PROFITS, DATA OR GOODWILL, OR FOR DAMAGE TO EQUIPMENT OR PROPERTY, ARISING FROM OR RELATED TO YOUR USE OF THE SOFTWARE OR ANY CODE GENERATED, SUGGESTED OR MODIFIED WITH IT. THIS APPLIES REGARDLESS OF THE LEGAL THEORY. OUR TOTAL AGGREGATE LIABILITY FOR ANY CLAIM WILL NOT EXCEED THE AMOUNTS YOU PAID FOR THE SOFTWARE IN THE 12 MONTHS BEFORE THE CLAIM.",
  ],
  [
    "14. Indemnification",
    "You agree to indemnify and hold Volt and its operators harmless from any claims, damages, losses and expenses (including reasonable legal fees) arising out of:",
    [
      "your use of the Software;",
      "your deployment of code to any system or environment;",
      "your violation of these Terms;",
      "your violation of any applicable safety standard or regulation; or",
      "your violation of any rights of another party.",
    ],
  ],
  [
    "15. Term and termination",
    "These Terms apply for as long as you use the Software. You may stop at any time by uninstalling it; to end billing, cancel through the Polar customer portal. We may terminate your licence if you materially breach these Terms — in particular §3 or §4. On termination your right to use the Software ends and you must uninstall it; your own projects and git history are yours and are unaffected, since they never left your machines. Sections that by their nature should survive (ownership, disclaimers, liability limits, indemnification, governing law) survive.",
  ],
  [
    "16. Changes to these terms",
    "We may update these Terms. If we make material changes we will post them here with a new date and, where appropriate, give additional notice. Continued use after changes take effect means you accept the revised Terms. If you do not accept them, stop using the Software and cancel any subscription.",
  ],
  [
    "17. Governing law",
    "These Terms are governed by the laws of the Netherlands, without regard to conflict-of-law principles. The courts of the Netherlands have jurisdiction over any dispute arising from these Terms or the Software, subject to any mandatory consumer-protection rights you have under the law of your country of residence.",
  ],
  ["18. Contact", "Questions about these Terms? Email legal@volt-ai.dev."],
]

export const meta = () => [
  { title: "Terms of Service — Volt" },
  {
    name: "description",
    content:
      "Volt Terms of Service — a licence for software you run yourself. No hosted service, no account, and your PLC projects never leave your machines.",
  },
]

export default function Page() {
  return (
    <LegalPage
      title="Terms of Service"
      updated={UPDATED}
      notice="Volt is not yet open for purchase. These terms describe how the software actually works today and are pending final review by counsel before sales open. Questions? Email legal@volt-ai.dev."
      sections={SECTIONS}
    />
  )
}
