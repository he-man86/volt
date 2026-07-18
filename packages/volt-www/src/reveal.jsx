// Scroll-reveal: cursor's staggered fade/rise. One IntersectionObserver per element, CSS does the animation
// (see [data-reveal] in styles.css). prefers-reduced-motion is handled in CSS, so nothing to branch on here.
import { useEffect, useRef, useState } from "react"

// Returns [ref, inView] — true once the element scrolls into view (one-shot). Drives mockup animations.
export function useInView(options) {
  const ref = useRef(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    if (typeof IntersectionObserver === "undefined") {
      setInView(true)
      return undefined
    }
    const io = new IntersectionObserver(
      ([entry], obs) => {
        if (entry.isIntersecting) {
          setInView(true)
          obs.disconnect()
        }
      },
      { threshold: 0.3, ...options },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return [ref, inView]
}

// Demo autopilot: cycles `steps` (thunks that click around a mockup) while `enabled`. Spread the returned props on
// the mockup root — the first real interaction stops the loop for good so it never fights the user.
// ponytail: setInterval, no fake cursor. Add one if the clicks read as random.
export function useAutoplay(steps, enabled, interval = 1900) {
  const [stopped, setStopped] = useState(false)
  const stepsRef = useRef(steps)
  stepsRef.current = steps
  useEffect(() => {
    if (!enabled || stopped) return undefined
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined
    let i = 0
    const id = setInterval(() => stepsRef.current[i++ % stepsRef.current.length](), interval)
    return () => clearInterval(id)
  }, [enabled, stopped, interval])
  return { onPointerDown: () => setStopped(true) }
}

// Stagger step in ms. Pure so it's testable without a DOM (see reveal.test.js).
export const revealDelay = (index = 0, step = 80) => Math.max(0, index) * step

// Wrap any block to reveal it on scroll. `delayIndex` staggers siblings.
export function Reveal({ as: Tag = "div", delayIndex = 0, style, children, ...rest }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const io = new IntersectionObserver(
      ([entry], obs) => {
        if (entry.isIntersecting) {
          el.classList.add("is-revealed")
          obs.disconnect()
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -10% 0px" },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <Tag ref={ref} data-reveal style={{ "--reveal-delay": `${revealDelay(delayIndex)}ms`, ...style }} {...rest}>
      {children}
    </Tag>
  )
}
