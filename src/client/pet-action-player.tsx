import { createElement as h, useEffect, useRef } from 'react'
import { css } from './derive.ts'
import { PET_ACTION_SHEET_SPECS, type ActionSheetSpec } from './pet-action-sheets.generated.ts'

const MAX_CELL_ASPECT = Math.max(...Object.values(PET_ACTION_SHEET_SPECS).map((spec) => spec.frameW / spec.frameH))

export function actionFrameAtStep(step: number, frames: number, pingPong = false): number {
  const count = Math.max(1, Math.floor(frames))
  const n = Math.max(0, Math.floor(step))
  if (!pingPong || count < 2) return n % count
  const cycle = count * 2 - 2
  const phase = n % cycle
  return phase < count ? phase : cycle - phase
}

export interface PetActionPlayerProps {
  spec: ActionSheetSpec
  width: number
  height: number
  speed: number
  disabled: boolean
  onComplete?: () => void
  onError?: () => void
}
interface LayerSize { width: number; height: number }

/** Two decoded image buffers, each clipped to exactly one frame cell. */
export function PetActionPlayer(p: PetActionPlayerProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const buffer0Ref = useRef<HTMLDivElement | null>(null)
  const buffer1Ref = useRef<HTMLDivElement | null>(null)
  const layer0Ref = useRef<HTMLImageElement | null>(null)
  const layer1Ref = useRef<HTMLImageElement | null>(null)
  const layerSpecsRef = useRef<Array<ActionSheetSpec | null>>([null, null])
  const layerSizesRef = useRef<Array<LayerSize | null>>([null, null])
  const layerFramesRef = useRef([0, 0])
  const activeSlotRef = useRef(-1)
  const activeSpecRef = useRef<ActionSheetSpec | null>(null)
  const generationRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const doneRef = useRef(false)
  const heightRef = useRef(p.height); heightRef.current = p.height
  const speedRef = useRef(p.speed); speedRef.current = p.speed
  const disabledRef = useRef(p.disabled); disabledRef.current = p.disabled
  const onCompleteRef = useRef(p.onComplete); onCompleteRef.current = p.onComplete
  const onErrorRef = useRef(p.onError); onErrorRef.current = p.onError
  const viewportRef = useRef({ width: Math.max(1, Math.round(p.height * MAX_CELL_ASPECT)), height: p.height })
  viewportRef.current = { width: Math.max(1, Math.round(p.height * MAX_CELL_ASPECT)), height: p.height }

  const images = () => [layer0Ref.current, layer1Ref.current]
  const buffers = () => [buffer0Ref.current, buffer1Ref.current]
  const sizeForSpec = (spec: ActionSheetSpec, height: number): LayerSize => ({
    width: Math.max(1, Math.round(height * spec.frameW / spec.frameH)), height,
  })
  const stopPlayback = () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
  }
  const position = (slot: number, index: number) => {
    const img = images()[slot]
    const buffer = buffers()[slot]
    const spec = layerSpecsRef.current[slot]
    const size = layerSizesRef.current[slot]
    if (!img || !buffer || !spec || !size) return
    const cols = Math.max(1, spec.cols || spec.frames)
    const rows = Math.max(1, spec.rows || Math.ceil(spec.frames / cols))
    const viewport = viewportRef.current
    // Buffer is the per-layer one-cell viewport. Adjacent strip cells can never leak out.
    buffer.style.left = `${(viewport.width - size.width) / 2}px`
    buffer.style.top = `${(viewport.height - size.height) / 2}px`
    buffer.style.width = `${size.width}px`
    buffer.style.height = `${size.height}px`
    img.style.width = `${cols * size.width}px`
    img.style.height = `${rows * size.height}px`
    img.style.transform = `translate3d(${-(index % cols) * size.width}px, ${-Math.floor(index / cols) * size.height}px, 0)`
    layerFramesRef.current[slot] = index
    if (slot === activeSlotRef.current) wrapRef.current?.setAttribute('data-frame', String(index))
  }
  const startPlayback = (slot: number, spec: ActionSheetSpec) => {
    stopPlayback(); doneRef.current = false; position(slot, 0)
    if (disabledRef.current) return
    let startTime: number | null = null
    const step = (now: number) => {
      if (slot !== activeSlotRef.current || activeSpecRef.current !== spec) return
      if (startTime === null) startTime = now
      const delay = spec.delaysMs[0] ?? 33
      const sequenceStep = Math.floor((now - startTime) / Math.round(delay / Math.max(.1, speedRef.current)))
      if (spec.loop) position(slot, actionFrameAtStep(sequenceStep, spec.frames, spec.pingPong))
      else if (sequenceStep >= spec.frames) {
        position(slot, spec.frames - 1)
        if (!doneRef.current) { doneRef.current = true; onCompleteRef.current?.() }
        return
      } else position(slot, sequenceStep)
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
  }

  useEffect(() => {
    const generation = ++generationRef.current
    const currentSlot = activeSlotRef.current
    const incomingSlot = currentSlot < 0 ? 0 : 1 - currentSlot
    const outgoingBuffer = currentSlot >= 0 ? buffers()[currentSlot] : null
    const incomingBuffer = buffers()[incomingSlot]
    const incoming = images()[incomingSlot]
    if (!incoming || !incomingBuffer) return

    incoming.onload = null; incoming.onerror = null
    incomingBuffer.style.transition = 'none'; incomingBuffer.style.opacity = '0'
    incomingBuffer.style.visibility = 'hidden'; incomingBuffer.style.zIndex = '0'
    incoming.removeAttribute('src')
    layerSpecsRef.current[incomingSlot] = p.spec
    layerSizesRef.current[incomingSlot] = sizeForSpec(p.spec, heightRef.current)
    layerFramesRef.current[incomingSlot] = 0
    position(incomingSlot, 0)

    let settled = false, preparing = false
    const detach = () => { incoming.onload = null; incoming.onerror = null }
    const fail = () => {
      if (settled || generation !== generationRef.current) return
      settled = true; detach()
      incomingBuffer.style.visibility = 'hidden'; incomingBuffer.style.opacity = '0'; incoming.removeAttribute('src')
      layerSpecsRef.current[incomingSlot] = null; layerSizesRef.current[incomingSlot] = null
      onErrorRef.current?.()
    }
    const commit = () => {
      if (settled || generation !== generationRef.current) return
      settled = true; detach(); position(incomingSlot, 0)
      stopPlayback()
      incomingBuffer.style.zIndex = '2'; incomingBuffer.style.opacity = '1'; incomingBuffer.style.visibility = 'visible'
      if (outgoingBuffer && outgoingBuffer !== incomingBuffer) {
        outgoingBuffer.style.zIndex = '0'; outgoingBuffer.style.opacity = '0'; outgoingBuffer.style.visibility = 'hidden'
      }
      activeSlotRef.current = incomingSlot; activeSpecRef.current = p.spec
      wrapRef.current?.setAttribute('data-frame', '0')
      startPlayback(incomingSlot, p.spec)
      requestAnimationFrame(() => {
        if (generation !== generationRef.current) return
        if (currentSlot >= 0 && outgoingBuffer && outgoingBuffer !== incomingBuffer) {
          images()[currentSlot]?.removeAttribute('src')
          layerSpecsRef.current[currentSlot] = null; layerSizesRef.current[currentSlot] = null
        }
      })
    }
    const stageDecoded = () => {
      if (settled || generation !== generationRef.current) return
      if (incoming.naturalWidth <= 0) { fail(); return }
      position(incomingSlot, 0)
      incomingBuffer.style.visibility = 'visible'; incomingBuffer.style.opacity = '0.001'; incomingBuffer.style.zIndex = '0'
      requestAnimationFrame(() => {
        if (generation !== generationRef.current || settled) return
        requestAnimationFrame(commit)
      })
    }
    const prepare = () => {
      if (preparing || settled || generation !== generationRef.current) return
      preparing = true
      const decoded = typeof incoming.decode === 'function' ? incoming.decode() : Promise.resolve()
      decoded.then(stageDecoded).catch(() => incoming.naturalWidth > 0 ? stageDecoded() : fail())
    }
    incoming.onload = prepare; incoming.onerror = fail; incoming.src = p.spec.sheet
    if (incoming.complete) queueMicrotask(prepare)
    return () => { detach() }
  }, [p.spec])

  useEffect(() => {
    viewportRef.current = { width: Math.max(1, Math.round(p.height * MAX_CELL_ASPECT)), height: p.height }
    if (wrapRef.current) {
      wrapRef.current.style.width = `${viewportRef.current.width}px`
      wrapRef.current.style.height = `${p.height}px`
    }
    for (const slot of [0, 1]) {
      const spec = layerSpecsRef.current[slot]
      if (spec) { layerSizesRef.current[slot] = sizeForSpec(spec, p.height); position(slot, layerFramesRef.current[slot] ?? 0) }
    }
  }, [p.height])

  useEffect(() => {
    const slot = activeSlotRef.current, spec = activeSpecRef.current
    if (slot < 0 || !spec) return
    if (p.disabled) { stopPlayback(); position(slot, 0) } else startPlayback(slot, spec)
  }, [p.disabled])

  useEffect(() => () => {
    ++generationRef.current; stopPlayback()
    for (const img of images()) if (img) { img.onload = null; img.onerror = null; img.removeAttribute('src') }
  }, [])

  // React owns only static structure. Controller owns cell geometry, visibility and transform.
  const staticBufferStyle = { position: 'absolute' as const, overflow: 'hidden', pointerEvents: 'none' as const }
  const staticStripStyle = {
    position: 'absolute' as const, top: 0, left: 0, maxWidth: 'none', maxHeight: 'none',
    transformOrigin: '0 0', imageRendering: 'auto' as const, willChange: 'transform',
    pointerEvents: 'none' as const, userSelect: 'none' as const,
  }
  const viewport = viewportRef.current
  const image = (slot: 0 | 1, bufferRef: typeof buffer0Ref, imageRef: typeof layer0Ref) => h('div', {
    key: `buffer-${slot}`, ref: bufferRef, 'data-buffer-slot': String(slot), style: css(staticBufferStyle),
  }, h('img', { ref: imageRef, alt: '', draggable: false, decoding: 'async', style: css(staticStripStyle) }))
  return h('div', {
    ref: wrapRef, role: 'img', 'aria-label': 'action frame animation',
    style: css({ width: viewport.width, height: viewport.height, position: 'relative', overflow: 'hidden' }),
    'data-source-frame-size': `${p.spec.frameW}x${p.spec.frameH}`,
    'data-frame': '0', 'data-loop': p.spec.loop ? '1' : '0',
    'data-ping-pong': p.spec.pingPong ? '1' : '0', 'data-buffer-count': '2',
    'data-transition': 'decoded-two-raf-atomic-cell-clipped',
  }, [image(0, buffer0Ref, layer0Ref), image(1, buffer1Ref, layer1Ref)])
}
