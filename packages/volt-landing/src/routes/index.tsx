import { Title } from "@solidjs/meta"

// ponytail: placeholder landing. Real branding/copy/pricing design → commercial-landing.
// The load-bearing wiring lives in ~/routes/auth/* (login) and ~/server/billing.ts (checkout).
export default function Home() {
  return (
    <main style={{ "max-width": "40rem", margin: "4rem auto", padding: "0 1.5rem", "font-family": "system-ui" }}>
      <Title>Volt — version control for PLC code</Title>
      <h1>Volt</h1>
      <p>Manage CODESYS and TwinCAT projects as version-controllable text.</p>

      {/* Login → OpenAuth issuer (GitHub / Google), same flow as the console */}
      <a href="/auth/authorize">Sign in</a>

      {/* Subscribe → Lite Stripe Checkout. workspaceID comes from the signed-in actor;
          wired once getActor is copied over (see ~/context/auth.ts). */}
      {/* <form method="post" action={subscribeLite}> … </form> */}
    </main>
  )
}
