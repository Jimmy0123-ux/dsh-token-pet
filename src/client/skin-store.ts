import type { ImportedSkinBundle, SkinManifest } from './skin.ts'

const DB_NAME = 'dsh-token-pet'
const STORE = 'skins'
const VERSION = 1

interface StoredSkin {
  id: string
  manifest: SkinManifest
  files: Array<[string, Uint8Array]>
  installedAt: number
}

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('当前环境不支持皮肤持久化。'))
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('无法打开皮肤数据库。'))
  })
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('皮肤数据库操作失败。'))
  })
}

export async function installSkinBundle(bundle: ImportedSkinBundle): Promise<SkinManifest> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const record: StoredSkin = {
      id: bundle.manifest.id,
      manifest: bundle.manifest,
      files: [...bundle.files.entries()].map(([name, data]) => [name, new Uint8Array(data)]),
      installedAt: Date.now(),
    }
    await requestResult(tx.objectStore(STORE).put(record))
    return bundle.manifest
  } finally { db.close() }
}

export async function listInstalledSkins(): Promise<SkinManifest[]> {
  const db = await openDb()
  try {
    const records = await requestResult(db.transaction(STORE, 'readonly').objectStore(STORE).getAll()) as StoredSkin[]
    return records.map((record) => record.manifest).sort((a, b) => a.name.localeCompare(b.name))
  } finally { db.close() }
}

export async function removeInstalledSkin(id: string): Promise<void> {
  const db = await openDb()
  try { await requestResult(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id)) }
  finally { db.close() }
}

export async function readInstalledSkin(id: string): Promise<StoredSkin | null> {
  const db = await openDb()
  try { return (await requestResult(db.transaction(STORE, 'readonly').objectStore(STORE).get(id)) as StoredSkin | undefined) ?? null }
  finally { db.close() }
}
