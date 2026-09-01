import { createElement as h, useEffect, useMemo, useState } from 'react'
import { importSkinZip, type ImportedSkinBundle, type SkinManifest, BUILTIN_SKINS } from './skin.ts'
import { installSkinBundle, listInstalledSkins, removeInstalledSkin } from './skin-store.ts'
import { loadSettings, saveSettings } from './settings.ts'

/** Validates, installs, selects and removes local ZIP skins via IndexedDB. Built-in skins are always listed. */
export function SkinImportPanel(p: { onImport?: (bundle: ImportedSkinBundle) => void }) {
  const [status, setStatus] = useState<string>('')
  const [installedSkins, setInstalledSkins] = useState<SkinManifest[]>([])
  const [selected, setSelected] = useState(() => loadSettings().skinId)
  const refresh = async () => setInstalledSkins(await listInstalledSkins())
  useEffect(() => { void refresh().catch((error) => setStatus(error instanceof Error ? error.message : String(error))) }, [])

  // Merge built-in skins with installed (IndexedDB) skins for the dropdown.
  const allSkins = useMemo(() => {
    const map = new Map<string, SkinManifest>()
    for (const skin of BUILTIN_SKINS) map.set(skin.id, skin)
    for (const skin of installedSkins) if (!map.has(skin.id)) map.set(skin.id, skin)
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [installedSkins])

  const onFile = async (event: { target: { files?: FileList | null; value?: string } }) => {
    const file = event.target.files?.[0]
    if (!file) return
    setStatus('正在校验并安装…')
    try {
      const bundle = importSkinZip(await file.arrayBuffer())
      await installSkinBundle(bundle)
      p.onImport?.(bundle)
      setSelected(bundle.manifest.id)
      saveSettings({ skinId: bundle.manifest.id })
      await refresh()
      setStatus(`已安装：${bundle.manifest.name}（${bundle.files.size} 个文件，${bundle.totalBytes} bytes）`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      if (typeof event.target.value === 'string') event.target.value = ''
    }
  }
  const choose = (id: string) => {
    setSelected(id)
    saveSettings({ skinId: id })
    if (id === 'default') setStatus('已切换到默认正式宠物。')
    else if (BUILTIN_SKINS.some((s) => s.id === id)) setStatus('已切换到内置配色；缺失资源将回退到默认正式宠物或 SVG。')
    else setStatus('已切换皮肤；缺失资源将回退到默认正式宠物或 SVG。')
  }
  const isBuiltin = (id: string) => BUILTIN_SKINS.some((s) => s.id === id)
  const remove = async () => {
    if (selected === 'default' || isBuiltin(selected)) return
    await removeInstalledSkin(selected)
    choose('default')
    await refresh()
    setStatus('自定义皮肤已删除，已恢复默认正式宠物。')
  }
  return h('section', { 'aria-label': '皮肤导入', style: { display: 'grid', gap: 5, marginTop: 6 } }, [
    h('label', { key: 'file' }, ['导入皮肤 ZIP ', h('input', { key: 'input', type: 'file', accept: '.zip,application/zip', onChange: onFile })]),
    h('label', { key: 'select' }, ['当前皮肤 ', h('select', { key: 'select', value: selected, onChange: (event: { target: { value: string } }) => choose(event.target.value) }, [
      h('option', { key: 'default', value: 'default' }, '默认 SVG'),
      ...allSkins.map((skin) => {
        const label = isBuiltin(skin.id) ? `${skin.name}（内置）` : skin.name
        return h('option', { key: skin.id, value: skin.id }, label)
      }),
    ])]),
    selected !== 'default' && !isBuiltin(selected) ? h('button', { key: 'remove', onClick: () => void remove() }, '删除当前自定义皮肤') : null,
    status ? h('div', { key: 'status', role: 'status', style: { fontSize: 11, opacity: .85 } }, status) : null,
  ])
}
