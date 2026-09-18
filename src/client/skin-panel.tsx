import { createElement as h, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { importSkinZip, skinDisplayName, SkinImportError, type ImportedSkinBundle, type SkinManifest, BUILTIN_SKINS } from './skin.ts'
import { installSkinBundle, listInstalledSkins, removeInstalledSkin } from './skin-store.ts'
import { saveSettings } from './settings.ts'
import { useSettings } from './settings-hook.ts'
import { localeFor, type Language } from './i18n.ts'
import { skinText, type SkinFeedback } from './skin-messages.ts'

/** Validates, installs, selects and removes local ZIP skins via IndexedDB. Built-in skins are always listed. */
export function SkinImportPanel(p: { onImport?: (bundle: ImportedSkinBundle) => void; language?: Language }) {
  const settings = useSettings()
  const language = p.language ?? settings.language
  const selected = settings.skinId
  const fileInput = useRef<HTMLInputElement | null>(null)
  const [status, setStatus] = useState<(SkinFeedback & { skin?: SkinManifest }) | null>(null)
  const [installedSkins, setInstalledSkins] = useState<SkinManifest[]>([])
  const mounted = useRef(true)
  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const skins = await listInstalledSkins()
      if (mounted.current) setInstalledSkins(skins)
      return true
    } catch (error) {
      if (mounted.current) setStatus({ level: 'error', key: 'listFailed', params: { detail: error instanceof Error ? error.message : String(error) } })
      return false
    }
  }, [])
  useEffect(() => {
    mounted.current = true
    void refresh()
    return () => { mounted.current = false }
  }, [refresh])

  // Merge built-in skins with installed (IndexedDB) skins for the dropdown.
  const allSkins = useMemo(() => {
    const map = new Map<string, SkinManifest>()
    for (const skin of BUILTIN_SKINS) map.set(skin.id, skin)
    for (const skin of installedSkins) if (!map.has(skin.id)) map.set(skin.id, skin)
    return [...map.values()].sort((a, b) => skinDisplayName(a, language).localeCompare(skinDisplayName(b, language), localeFor(language)))
  }, [installedSkins, language])

  const onFile = async (event: { target: { files?: FileList | null; value?: string } }) => {
    const file = event.target.files?.[0]
    if (!file) return
    setStatus({ level: 'info', key: 'installing' })
    try {
      const bundle = await importSkinZip(await file.arrayBuffer())
      await installSkinBundle(bundle)
      p.onImport?.(bundle)
      saveSettings({ skinId: bundle.manifest.id })
      if (await refresh() && mounted.current) setStatus({ level: 'info', key: 'installed', skin: bundle.manifest, params: { files: bundle.files.size, bytes: bundle.totalBytes } })
    } catch (error) {
      if (mounted.current) setStatus(error instanceof SkinImportError
        ? { level: 'error', key: error.key }
        : { level: 'error', key: 'installFailed', params: { detail: error instanceof Error ? error.message : String(error) } })
    } finally {
      if (typeof event.target.value === 'string') event.target.value = ''
    }
  }
  const choose = (id: string) => {
    saveSettings({ skinId: id })
    setStatus({ level: 'info', key: id === 'default' ? 'selectedDefault' : isBuiltin(id) ? 'selectedBuiltin' : 'selectedCustom' })
  }
  const isBuiltin = (id: string) => BUILTIN_SKINS.some((s) => s.id === id)
  const remove = async () => {
    if (selected === 'default' || isBuiltin(selected)) return
    try {
      await removeInstalledSkin(selected)
      choose('default')
      if (await refresh() && mounted.current) setStatus({ level: 'info', key: 'removed' })
    } catch (error) {
      if (mounted.current) setStatus({ level: 'error', key: 'removeFailed', params: { detail: error instanceof Error ? error.message : String(error) } })
    }
  }
  return h('section', { 'aria-label': skinText(language, 'section'), style: { display: 'grid', gap: 8, marginTop: 6, minWidth: 0, overflowWrap: 'anywhere' } }, [
    h('div', { key: 'file', style: { display: 'grid', gap: 5, minWidth: 0 } }, [
      h('span', { key: 'label' }, skinText(language, 'importZip')),
      h('input', { key: 'input', ref: fileInput, type: 'file', style: { display: 'none' }, tabIndex: -1, 'aria-hidden': true, accept: '.zip,application/zip', onChange: onFile }),
      h('button', { key: 'choose', type: 'button', onClick: () => fileInput.current?.click(), 'aria-label': skinText(language, 'importZip'), style: { color: 'inherit', background: 'var(--tp-input-bg)', border: '1px solid var(--tp-border-2)', padding: 7, borderRadius: 6, maxWidth: '100%', whiteSpace: 'normal', cursor: 'pointer' } }, skinText(language, 'chooseFile')),
    ]),
    h('label', { key: 'select', style: { display: 'grid', gap: 5, minWidth: 0 } }, [skinText(language, 'currentSkin') + ' ', h('select', { key: 'select', style: { width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box', color: 'inherit', background: 'var(--tp-input-bg)', padding: 7, borderRadius: 6, border: '1px solid var(--tp-border-2)' }, value: selected, onChange: (event: { target: { value: string } }) => choose(event.target.value) }, [
      h('option', { key: 'default', value: 'default' }, skinText(language, 'defaultSkin')),
      ...allSkins.map((skin) => {
        const name = skinDisplayName(skin, language)
        const label = isBuiltin(skin.id) ? skinText(language, 'builtin', { name }) : name
        return h('option', { key: skin.id, value: skin.id }, label)
      }),
    ])]),
    selected !== 'default' && !isBuiltin(selected) ? h('button', { key: 'remove', type: 'button', onClick: () => void remove() }, skinText(language, 'remove')) : null,
    status ? h('div', { key: 'status', role: status.level === 'error' ? 'alert' : 'status', style: { fontSize: 11, opacity: .85 } }, skinText(language, status.key, { ...status.params, ...(status.skin ? { name: skinDisplayName(status.skin, language) } : {}) })) : null,
  ])
}
