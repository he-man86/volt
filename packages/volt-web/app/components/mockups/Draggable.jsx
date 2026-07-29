// Draggable window wrapper: grab anywhere to move (pointer events, translate), and clicking brings it to front
// via a shared z-counter. Used to float the CODESYS window over the desktop app in the hero.
import { useRef, useState } from "react"

let zTop = 20 // module-level: shared across all draggable windows on the page

export function Draggable({ children, className, style }) {
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [z, setZ] = useState(() => ++zTop)
  const [dragging, setDragging] = useState(false)
  const start = useRef(null)

  // Touch devices: drag hijacks vertical scrolling (touch-action:none on the handle), so render a plain window.
  const draggable = typeof window === "undefined" || !window.matchMedia("(pointer: coarse)").matches
  if (!draggable) {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    )
  }

  const onDown = (e) => {
    setZ(++zTop) // any click on the window brings it to front
    // Only start a drag from a titlebar (marked data-drag-handle) so body controls stay clickable.
    if (!e.target.closest("[data-drag-handle]")) return
    setDragging(true)
    start.current = { sx: e.clientX, sy: e.clientY, px: pos.x, py: pos.y }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onMove = (e) => {
    if (!start.current) return
    setPos({
      x: start.current.px + (e.clientX - start.current.sx),
      y: start.current.py + (e.clientY - start.current.sy),
    })
  }
  const onUp = (e) => {
    start.current = null
    setDragging(false)
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId)
    } catch {
      /* pointer already released */
    }
  }

  return (
    <div
      className={"drag" + (dragging ? " is-dragging" : "") + (className ? " " + className : "")}
      style={{ ...style, zIndex: z, transform: `translate(${pos.x}px, ${pos.y}px)` }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {children}
    </div>
  )
}
