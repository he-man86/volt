import { renderPage } from "../shell.jsx"

// Home: the full landing between the shared Nav + Footer (added by renderPage).
renderPage(() => {
  const { Hero, BuiltFor, Features, Architecture, CompilerIntelligence, EngineeringConfidence, Privacy, Surfaces, FinalCTA } =
    window
  return (
    <>
      <Hero />
      <BuiltFor />
      <Features />
      <Architecture />
      <CompilerIntelligence />
      <EngineeringConfidence />
      <Privacy />
      <Surfaces />
      <FinalCTA />
    </>
  )
})
