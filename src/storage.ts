const memoryStorage = new Map<string, string>()

export function safeStorageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return memoryStorage.get(key) ?? null
  }
}

export function safeStorageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
    return
  } catch {
    memoryStorage.set(key, value)
  }
}
