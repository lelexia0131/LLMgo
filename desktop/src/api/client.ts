import './types'

export function invoke<T>(action: string, body?: unknown): Promise<T> {
  if (!window.llmgo) return Promise.reject(new Error('请通过 LLMgo 桌面程序打开'))
  return window.llmgo.invoke(action, body) as Promise<T>
}
