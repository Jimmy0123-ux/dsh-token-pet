import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import type { TokenPetTrendIndexStatus } from '../index-contract.js'
import { TREND_REBUILD_CONFIRMATION, trendHealthLabel, trendIndexStatusOf, trendOperationLabel } from './trend-maintenance.ts'

function updatedLabel(value: number | null): string {
  if (value === null) return '尚未生成'
  try { return new Date(value).toLocaleString() } catch { return '时间无效' }
}

/** Hourly projection maintenance lives in settings, away from ordinary refresh. */
export function TrendIndexMaintenancePanel() {
  const [status, setStatus] = useState<TokenPetTrendIndexStatus | null>(null)
  const [feedback, setFeedback] = useState<string>('')
  const [requesting, setRequesting] = useState(false)
  const mounted = useRef(true)
  const load = useCallback(async () => {
    try {
      const response = await fetch('/token-pet/usage/trend/status')
      if (!response.ok) throw new Error(`状态请求失败（${response.status}）`)
      const next = trendIndexStatusOf(await response.json())
      if (!next) throw new Error('宿主返回了无效的索引状态')
      if (mounted.current) { setStatus(next); if (next.error) setFeedback(`失败：${next.error}`) }
    } catch (error) {
      if (mounted.current) setFeedback(error instanceof Error ? error.message : String(error))
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
        if (mounted.current) setFeedback('自动刷新已暂停，请手动刷新状态。')
        return
      }
      timer = setTimeout(() => { void poll() }, 500)
    }
    timer = setTimeout(() => { void poll() }, 500)
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [status?.running, load])

  const rebuild = useCallback(async () => {
    if (typeof window !== 'undefined' && !window.confirm(TREND_REBUILD_CONFIRMATION)) return
    setRequesting(true); setFeedback('正在启动显式重建…')
    try {
      const response = await fetch('/token-pet/usage/trend/repair', { method: 'POST' })
      const body = await response.json().catch(() => ({})) as { error?: unknown }
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `无法启动重建（${response.status}）`)
      setFeedback('重建已启动；完成前可取消。')
      await load()
    } catch (error) { setFeedback(`失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { if (mounted.current) setRequesting(false) }
  }, [load])

  const cancel = useCallback(async () => {
    setRequesting(true); setFeedback('正在取消…')
    try {
      const response = await fetch('/token-pet/usage/trend/repair/cancel', { method: 'POST' })
      if (!response.ok) throw new Error(`取消失败（${response.status}）`)
      setFeedback('已请求取消重建。')
      await load()
    } catch (error) { setFeedback(`失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { if (mounted.current) setRequesting(false) }
  }, [load])

  const running = status?.running === true
  return h('fieldset', { style: { margin: '6px 0', padding: 8, border: '1px solid rgba(128,128,160,.28)', borderRadius: 8 } }, [
    h('legend', { key: 'legend', style: { padding: '0 4px', fontWeight: 700 } }, '小时趋势索引维护'),
    h('div', { key: 'health' }, `健康状态：${trendHealthLabel(status)}`),
    h('div', { key: 'updated' }, `快照更新时间：${updatedLabel(status?.updatedAt ?? null)}`),
    h('div', { key: 'operation', 'aria-live': 'polite' }, `维护状态：${trendOperationLabel(status)}`),
    h('p', { key: 'explanation', style: { margin: '6px 0', opacity: .76, fontSize: 12 } }, '普通状态读取与趋势刷新只读取校验过的小时快照，不枚举会话，也不读取历史。显式重建是唯一会扫描全部历史的维护操作。'),
    status?.path ? h('div', { key: 'path', title: status.path, style: { fontSize: 11, opacity: .58, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, `只读快照：${status.path}`) : null,
    h('div', { key: 'actions', style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 } }, [
      h('button', {
        key: 'rebuild', type: 'button', disabled: requesting || running, onClick: () => { void rebuild() },
        style: { padding: '5px 9px', borderRadius: 7, border: '1px solid rgba(210,128,64,.55)', background: 'rgba(210,128,64,.12)', cursor: requesting || running ? 'not-allowed' : 'pointer' },
      }, '显式重建趋势索引'),
      status?.cancelSupported ? h('button', {
        key: 'cancel', type: 'button', disabled: requesting, onClick: () => { void cancel() },
        style: { padding: '5px 9px', borderRadius: 7, border: '1px solid rgba(128,128,160,.36)', background: 'rgba(128,128,160,.12)' },
      }, '取消重建') : null,
      h('button', { key: 'refresh', type: 'button', disabled: requesting, onClick: () => { void load() }, style: { padding: '5px 9px', borderRadius: 7, border: '1px solid rgba(128,128,160,.36)', background: 'rgba(128,128,160,.12)' } }, '刷新状态'),
    ]),
    feedback ? h('div', { key: 'feedback', role: feedback.startsWith('失败') ? 'alert' : 'status', style: { marginTop: 6, fontSize: 12 } }, feedback) : null,
  ])
}
