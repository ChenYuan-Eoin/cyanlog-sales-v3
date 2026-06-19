/**
 * 轻量级 Toast 提示工具
 * 替代 alert() 和 console.log 错误处理
 */

export type ToastType = 'success' | 'error' | 'warning' | 'info'

interface ToastOptions {
  duration?: number
  position?: 'top' | 'bottom'
}

/**
 * 显示 Toast 提示
 */
export function toast(message: string, type: ToastType = 'info', options: ToastOptions = {}): void {
  const { duration = 3000, position = 'top' } = options

  // 创建 toast 元素
  const toastEl = document.createElement('div')
  toastEl.className = `fixed ${position === 'top' ? 'top-4' : 'bottom-4'} left-1/2 -translate-x-1/2 z-[100] px-4 py-2 rounded-lg shadow-lg text-sm font-medium animate-in fade-in slide-in-from-top-2 duration-200`

  // 根据类型设置样式
  const styles: Record<ToastType, string> = {
    success: 'bg-green-600 text-white',
    error: 'bg-red-600 text-white',
    warning: 'bg-amber-500 text-white',
    info: 'bg-slate-800 text-white',
  }
  toastEl.classList.add(...styles[type].split(' '))
  toastEl.textContent = message

  document.body.appendChild(toastEl)

  // 自动移除
  setTimeout(() => {
    toastEl.style.opacity = '0'
    toastEl.style.transform = 'translateX(-50%) translateY(-8px)'
    toastEl.style.transition = 'all 200ms ease-out'
    setTimeout(() => toastEl.remove(), 200)
  }, duration)
}

/**
 * 显示成功提示
 */
export function success(message: string, options?: ToastOptions): void {
  toast(message, 'success', options)
}

/**
 * 显示错误提示
 */
export function error(message: string, options?: ToastOptions): void {
  toast(message, 'error', options)
}

/**
 * 显示警告提示
 */
export function warning(message: string, options?: ToastOptions): void {
  toast(message, 'warning', options)
}

/**
 * 显示信息提示
 */
export function info(message: string, options?: ToastOptions): void {
  toast(message, 'info', options)
}

/**
 * 统一的错误处理包装器
 * 用于替换 try-catch 中的 // ignore
 */
export function handleError(err: unknown, context?: string): void {
  const message = err instanceof Error ? err.message : String(err)
  const fullMessage = context ? `${context}: ${message}` : message

  // 开发环境打印日志
  if (process.env.NODE_ENV === 'development') {
    console.error(fullMessage)
  }

  // 显示用户友好的错误提示
  error(fullMessage.slice(0, 100))
}
