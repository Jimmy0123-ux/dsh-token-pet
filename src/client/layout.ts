/** Keep the statistics window above the independently draggable pet. */
export const FLOATING_LAYER = {
  pet: 9998,
  panel: 9999,
} as const

/** Trend is an index-backed view and must not wait for reversible cumulative usage. */
export function canLoadTodayUsageTrend(panelOpen: boolean, panelPhase: number, indexUsable: boolean): boolean {
  return panelOpen && panelPhase >= 1 && indexUsable
}

/** Fit the floating panel to the actually available viewport without imposing a
 * minimum that can make the child taller/wider than its clipped parent. */
export function fitPanelSizeToViewport(width: number, height: number, viewportWidth: number, viewportHeight: number) {
  const visibleWidth = Math.max(1, Math.min(width, viewportWidth - 16))
  const visibleHeight = Math.max(1, Math.min(height, viewportHeight - 88))
  return { width: visibleWidth, height: visibleHeight, contentHeight: Math.max(1, visibleHeight - 42) }
}

/** Preserve the resize-start aspect ratio while respecting both dimensions. */
export function proportionalPanelSize(startWidth: number, startHeight: number, deltaX: number, deltaY: number, minWidth: number, maxWidth: number, minHeight: number, maxHeight: number) {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
  const widthScale = (startWidth + deltaX) / startWidth
  const heightScale = (startHeight + deltaY) / startHeight
  const requestedScale = Math.abs(widthScale - 1) >= Math.abs(heightScale - 1) ? widthScale : heightScale
  const scale = clamp(requestedScale, Math.max(minWidth / startWidth, minHeight / startHeight), Math.min(maxWidth / startWidth, maxHeight / startHeight))
  return { width: Math.round(startWidth * scale), height: Math.round(startHeight * scale) }
}
