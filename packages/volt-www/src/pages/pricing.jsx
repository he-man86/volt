import { renderPage } from "../shell.jsx"

renderPage(() => {
  const { Pricing, ComparisonTable, PricingFAQ, FinalCTA } = window
  return (
    <>
      <Pricing />
      <ComparisonTable />
      <PricingFAQ />
      <FinalCTA />
    </>
  )
})
