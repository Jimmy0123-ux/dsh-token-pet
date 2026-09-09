/** Shared, platform-independent localization helpers. Keep machine IDs out of messages. */
export type Language = 'zh' | 'en'
export type Message = Readonly<{ zh: string; en: string }>
export type MessageParams = Readonly<Record<string, string | number>>
export function defineMessages<const T extends Record<string, Message>>(messages: T): T { return messages }
export function translate<T extends Record<string, Message>>(language: Language, messages: T, key: keyof T, params: MessageParams = {}): string {
  const message = messages[key]
  if (!message) return String(key)
  return message[language].replace(/\{(\w+)\}/g, (match, name: string) => params[name] === undefined ? match : String(params[name]))
}
export function localeFor(language: Language): string { return language === 'en' ? 'en-US' : 'zh-CN' }
