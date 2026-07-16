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
