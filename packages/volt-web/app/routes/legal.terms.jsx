import { LegalPage } from "../components/LegalPage.jsx"

// Volt Terms of Service. Substance adapted from the PLC Assist production legal docs (industrial-safety,
// indemnification, NL governing law), reconciled with Volt's actual architecture. Pending final counsel review —
// keep the notice banner until signed off. Structured so counsel edits prose, not layout.
const UPDATED = "16 July 2026"
// Each section is [title, body, bullets?]. bullets renders as a list under the body.
const SECTIONS = [
  [
    "1. Agreement to these terms",
    "These Terms of Service (“Terms”) govern your access to and use of Volt — the desktop application, command-line tools, language server, VS Code extension, and the hosted Volt cloud service (together, the “Service”), operated by Volt (“we”, “us”). By downloading, installing, or using the Service you agree to these Terms. If you use the Service on behalf of an organization, you accept these Terms for that organization.",
  ],
  [
    "2. The Service",
    "Volt is a toolchain for managing IEC 61131-3 PLC projects (CODESYS, TwinCAT/Beckhoff) as version-controllable text, with optional AI assistance. Your PLC project files live in your own git repository on your own machines. The hosted service provides account management, billing, and a gateway that proxies AI model requests. We may add, change, or remove features over time.",
  ],
  [
    "3. Accounts",
    "You need an account for the hosted parts of the Service. You must provide accurate information, keep your credentials secure, and are responsible for activity under your account. You must be able to form a binding contract and not be barred from using the Service under applicable law.",
  ],
  [
    "4. Acceptable use",
    "You agree not to: use the Service unlawfully or to infringe others’ rights; attempt to break, overload, or reverse-engineer the Service except where such restriction is prohibited by law; resell or provide the hosted service to third parties except as expressly permitted; use automated systems to access the Service without permission; or use the AI gateway to generate content that is illegal or violates an underlying model provider’s policies.",
  ],
  [
    "5. Your content",
    "You retain all rights to your PLC projects, source code, and other content (“Your Content”). Volt does not claim ownership of it. You grant us only the limited rights needed to operate the Service for you — for example, transmitting the prompts you submit to the AI gateway to the relevant model provider to return a response. We do not use Your Content to train models.",
  ],
  [
    "6. AI-assisted code generation",
    "The Service can generate, suggest, and modify code, explanations, and other output using third-party AI models. AI output is provided on an “as-is” basis without any guarantee of correctness, completeness, safety, or fitness for a particular purpose. AI output may contain errors or logical flaws, may not comply with applicable safety standards, may be unsuitable for safety-critical applications, and may misinterpret your intent. AI features depend on third-party providers and may change or become unavailable.",
  ],
  [
    "7. Safety-critical notice",
    "Volt is an engineering aid, not a certified safety system. It is not qualified, certified, or intended to serve as the basis of safety-critical or life-critical control without independent verification. PLC code governs physical equipment and people, and deploying untested or unverified code to industrial control systems can cause equipment damage, production loss, environmental harm, or serious injury or death. You are solely responsible for the safe use of any code — whether written by you, by Volt, or by an AI model. Before commissioning or deploying, you must:",
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
    "8. Local connection",
    "Volt connects to CODESYS or TwinCAT running on your machine through a local bridge. Your PLC project code is processed locally; we do not have access to your PLC project files or the code running on your controllers unless you explicitly submit it through the AI features.",
  ],
  [
    "9. Fees and billing",
    "Paid plans are billed in advance on a recurring basis through our payment processor (Stripe). Fees are non-refundable except where required by law or expressly stated. We may change pricing with reasonable notice; changes apply to the next billing cycle. You are responsible for applicable taxes. You can cancel at any time; access continues until the end of the paid period.",
  ],
  [
    "10. Intellectual property",
    "The Service, including the Volt software, brand, and site, is owned by us and our licensors and protected by law. These Terms grant you a limited, non-exclusive, non-transferable right to use the Service; they do not transfer any of our intellectual property to you. Open-source components are licensed under their own terms.",
  ],
  [
    "11. Third-party services",
    "The Service builds on and interoperates with third-party software and services (including the open-source opencode agent, AI model providers, and cloud infrastructure). We are not responsible for third-party services, and your use of them may be subject to their own terms.",
  ],
  [
    "12. Disclaimers",
    "THE SERVICE IS PROVIDED “AS IS” AND “AS AVAILABLE” WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, ACCURACY, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, SECURE, OR ERROR-FREE, THAT DEFECTS WILL BE CORRECTED, OR THAT ANY OUTPUT IS ACCURATE, SAFE, OR SUITABLE FOR ANY PURPOSE.",
  ],
  [
    "13. Limitation of liability",
    "TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR LOST PROFITS, DATA, OR GOODWILL, OR FOR DAMAGE TO EQUIPMENT OR PROPERTY, OR PERSONAL INJURY, ARISING FROM OR RELATED TO YOUR USE OF THE SERVICE OR ANY CODE GENERATED, SUGGESTED, OR MODIFIED BY THE AI FEATURES. THIS APPLIES REGARDLESS OF THE LEGAL THEORY. OUR TOTAL LIABILITY FOR ANY CLAIM WILL NOT EXCEED THE AMOUNTS YOU PAID US FOR THE SERVICE IN THE 12 MONTHS BEFORE THE CLAIM.",
  ],
  [
    "14. Indemnification",
    "You agree to indemnify and hold Volt and its operators harmless from any claims, damages, losses, and expenses (including reasonable legal fees) arising out of:",
    [
      "your use of the Service;",
      "your deployment of code to any system or environment;",
      "your violation of these Terms;",
      "your violation of any applicable safety standard or regulation; or",
      "your violation of any rights of another party.",
    ],
  ],
  [
    "15. Termination",
    "You may stop using the Service at any time. We may suspend or terminate your access if you breach these Terms or if we reasonably need to protect the Service or others. On termination your right to use the Service ends, we may delete your account and associated data, and sections that by their nature should survive (ownership, disclaimers, liability limits, indemnification) survive.",
  ],
  [
    "16. Changes to these terms",
    "We may update these Terms from time to time. If we make material changes we will provide reasonable notice (for example, by posting here or notifying you). Continued use after changes take effect means you accept the revised Terms.",
  ],
  [
    "17. Governing law",
    "These Terms are governed by and construed in accordance with the laws of the Netherlands, without regard to conflict-of-law principles. The courts of the Netherlands have jurisdiction over any dispute arising from these Terms or the Service, subject to any mandatory consumer-protection rights you have under the law of your country of residence.",
  ],
  ["18. Contact", "Questions about these Terms? Email legal@volt-ai.dev."],
]

export const meta = () => [
  { title: "Terms of Service — Volt" },
  { name: "description", content: "Volt Terms of Service." },
]

export default function Page() {
  return (
    <LegalPage
      title="Terms of Service"
      updated={UPDATED}
      notice="These terms are being finalized ahead of Volt’s general availability. Questions? Email legal@volt-ai.dev."
      sections={SECTIONS}
    />
  )
}
