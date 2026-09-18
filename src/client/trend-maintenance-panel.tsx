import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import type { TokenPetTrendIndexStatus } from '../index-contract.js'
import { trendRebuildConfirmation, trendHealthLabel, trendIndexStatusOf, trendOperationLabel } from './trend-maintenance.ts'
import { localeFor, type Language } from './i18n.ts'
import { maintenanceText, maintenanceFeedbackText, type MaintenanceFeedback } from './maintenance-messages.ts'
import { useLanguage } from './settings-hook.ts'

function updatedLabel(value: number | null, language: Language): string {
  if (value === null) return maintenanceText(language, 'notGenerated')
  try {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? maintenanceText(language, 'invalidTime') : date.toLocaleString(localeFor(language))
  } catch { return maintenanceText(language, 'invalidTime') }
}

/** Hourly projection maintenance lives in settings, away from ordinary refresh. */
export function TrendIndexMaintenancePanel({ language: explicitLanguage }: { language?: Language }) {
  const storedLanguage = useLanguage()
  const language = explicitLanguage ?? storedLanguage
  const [status, setStatus] = useState<TokenPetTrendIndexStatus | null>(null)
  const [feedback, setFeedback] = useState<MaintenanceFeedback | null>(null)
  const [requesting, setRequesting] = useState(false)
  const mounted = useRef(true)
  const load = useCallback(async () => {
    try {
      const response = await fetch('/token-pet/usage/trend/status')
      if (!response.ok) {
        if (mounted.current) setFeedback({ level: 'error', key: 'statusRequestFailed', params: { status: response.status } })
        return
      }
      const next = trendIndexStatusOf(await response.json())
      if (!next) {
        if (mounted.current) setFeedback({ level: 'error', key: 'invalidStatus' })
        return
      }
      if (mounted.current) {
        setStatus(next)
        if (next.error) setFeedback({ level: 'error', key: 'hostError', params: { detail: next.error } })
      }
    } catch (error) {
      if (mounted.current) setFeedback({ level: 'error', key: 'requestFailed', params: { detail: error instanceof Error ? error.message : String(error) } })
    }
  }, [])
  useEffect(() => {
    mounted.current = true; void load()
    return () => { mounted.current = false }
  }, [load])
  useEffect(() => {
    if (!status?.running) return
    let cancelled = false
    let attempts = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      await load()
      if (cancelled) return
      attempts++
      if (attempts >= 120) {
        if (mounted.current) setFeedback({ level: 'warning', key: 'pollingPaused' })
        return
      }
      timer = setTimeout(() => { void poll() }, 500)
    }
    timer = setTimeout(() => { void poll() }, 500)
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [status?.running, load])

  const rebuild = useCallback(async () => {
    if (typeof window !== 'undefined' && !window.confirm(trendRebuildConfirmation(language))) return
    setRequesting(true); setFeedback({ level: 'info', key: 'startingRebuild' })
    try {
      const response = await fetch('/token-pet/usage/trend/repair', { method: 'POST' })
      const body = await response.json().catch(() => ({})) as { error?: unknown }
      if (!response.ok) {
        if (mounted.current) setFeedback(typeof body.error === 'string'
          ? { level: 'error', key: 'hostError', params: { detail: body.error } }
          : { level: 'error', key: 'rebuildRequestFailed', params: { status: response.status } })
        return
      }
      if (mounted.current) setFeedback({ level: 'info', key: 'rebuildStarted' })
      await load()
    } catch (error) {
      if (mounted.current) setFeedback({ level: 'error', key: 'requestFailed', params: { detail: error instanceof Error ? error.message : String(error) } })
    } finally { if (mounted.current) setRequesting(false) }
  }, [load, language])

  const cancel = useCallback(async () => {
    setRequesting(true); setFeedback({ level: 'info', key: 'cancelling' })
    try {
      const response = await fetch('/token-pet/usage/trend/repair/cancel', { method: 'POST' })
      if (!response.ok) {
        if (mounted.current) setFeedback({ level: 'error', key: 'cancelRequestFailed', params: { status: response.status } })
        return
      }
      if (mounted.current) setFeedback({ level: 'info', key: 'cancelRequested' })
      await load()
    } catch (error) {
      if (mounted.current) setFeedback({ level: 'error', key: 'requestFailed', params: { detail: error instanceof Error ? error.message : String(error) } })
    } finally { if (mounted.current) setRequesting(false) }
  }, [load])

  const running = status?.running === true
  return h('fieldset', { style: { minWidth: 0, overflowWrap: 'anywhere', margin: '6px 0', padding: 8, border: '1px solid var(--tp-border-2)', borderRadius: 8 } }, [
    h('legend', { key: 'legend', style: { padding: '0 4px', fontWeight: 700 } }, maintenanceText(language, 'title')),
    h('div', { key: 'health' }, maintenanceText(language, 'health', { value: trendHealthLabel(status, language) })),
    h('div', { key: 'updated' }, maintenanceText(language, 'updated', { value: updatedLabel(status?.updatedAt ?? null, language) })),
    h('div', { key: 'operation', 'aria-live': 'polite' }, maintenanceText(language, 'operation', { value: trendOperationLabel(status, language) })),
    h('p', { key: 'explanation', style: { margin: '6px 0', opacity: .76, fontSize: 12 } }, maintenanceText(language, 'explanation')),
    status?.path ? h('div', { key: 'path', title: status.path, style: { fontSize: 11, opacity: .58, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, maintenanceText(language, 'snapshotPath', { path: status.path })) : null,
    h('div', { key: 'actions', style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 } }, [
      h('button', {
        key: 'rebuild', type: 'button', disabled: requesting || running, onClick: () => { void rebuild() },
        style: { color: '#e8eaf2', maxWidth: '100%', whiteSpace: 'normal', padding: '5px 9px', borderRadius: 7, border: '1px solid rgba(210,128,64,.55)', background: 'rgba(210,128,64,.12)', cursor: requesting || running ? 'not-allowed' : 'pointer' },
      }, maintenanceText(language, 'rebuildAction')),
      status?.cancelSupported ? h('button', {
        key: 'cancel', type: 'button', disabled: requesting, onClick: () => { void cancel() },
        style: { color: '#e8eaf2', maxWidth: '100%', whiteSpace: 'normal', padding: '5px 9px', borderRadius: 7, border: '1px solid rgba(128,128,160,.36)', background: 'rgba(128,128,160,.12)' },
      }, maintenanceText(language, 'cancelAction')) : null,
      h('button', { key: 'refresh', type: 'button', disabled: requesting, onClick: () => { void load() }, style: { color: '#e8eaf2', maxWidth: '100%', whiteSpace: 'normal', padding: '5px 9px', borderRadius: 7, border: '1px solid rgba(128,128,160,.36)', background: 'rgba(128,128,160,.12)' } }, maintenanceText(language, 'refreshAction')),
    ]),
    feedback ? h('div', { key: 'feedback', role: feedback.level === 'error' ? 'alert' : 'status', style: { marginTop: 6, fontSize: 12 } }, maintenanceFeedbackText(language, feedback)) : null,
  ])
}
