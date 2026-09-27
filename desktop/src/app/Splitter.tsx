import {useEffect, useRef} from 'react'

export function Splitter({label, vertical = false, value, min, max, onChange, reverse = false}: {
  label: string; vertical?: boolean; value: number; min: number; max: number; onChange: (value: number) => void; reverse?: boolean
}) {
  const drag = useRef<AbortController | null>(null)
  useEffect(() => () => drag.current?.abort(), [])
  const update = (next: number) => onChange(Math.max(min, Math.min(max, next)))
  return <div className={`splitter ${vertical ? 'splitter-row' : 'splitter-column'}`} role="separator" tabIndex={0}
    aria-label={label} aria-orientation={vertical ? 'horizontal' : 'vertical'} aria-valuenow={Math.round(value)} aria-valuemin={min} aria-valuemax={Math.round(max)}
    onPointerDown={event => {
      if (event.button !== 0) return
      event.preventDefault()
      drag.current?.abort()
      const controller = new AbortController()
      drag.current = controller
      const position = vertical ? event.clientY : event.clientX
      const options = {signal: controller.signal}
      // Follow the pointer even as layout moves the separator away from its starting point.
      window.addEventListener('pointermove', move => {
        if (move.buttons & 1) update(value + ((vertical ? move.clientY : move.clientX) - position) * (reverse ? -1 : 1))
      }, options)
      window.addEventListener('pointerup', () => controller.abort(), options)
      window.addEventListener('pointercancel', () => controller.abort(), options)
      window.addEventListener('blur', () => controller.abort(), options)
    }}
    onKeyDown={event => {
      const delta = vertical ? {ArrowUp: -16, ArrowDown: 16}[event.key] : {ArrowLeft: -16, ArrowRight: 16}[event.key]
      if (delta !== undefined) {event.preventDefault(); update(value + delta * (reverse ? -1 : 1))}
    }}/>
}
