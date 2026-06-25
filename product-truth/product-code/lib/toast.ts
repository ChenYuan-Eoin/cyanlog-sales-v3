/**
 * 轻量级反馈提示和确认工具
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

export function confirmAction(
  message: string,
  options: {
    title?: string
    confirmText?: string
    cancelText?: string
    danger?: boolean
  } = {}
): Promise<boolean> {
  const {
    title = '确认操作',
    confirmText = '确认',
    cancelText = '取消',
    danger = false,
  } = options

  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.className = 'fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/40 px-4'

    const dialog = document.createElement('div')
    dialog.className = 'w-full max-w-sm rounded-lg bg-white p-5 shadow-xl'
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')

    const heading = document.createElement('h2')
    heading.className = 'text-base font-semibold text-slate-900'
    heading.textContent = title

    const body = document.createElement('p')
    body.className = 'mt-2 whitespace-pre-line text-sm leading-6 text-slate-600'
    body.textContent = message

    const actions = document.createElement('div')
    actions.className = 'mt-5 flex justify-end gap-2'

    const cancelButton = document.createElement('button')
    cancelButton.type = 'button'
    cancelButton.className = 'h-9 rounded-md border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50'
    cancelButton.textContent = cancelText

    const confirmButton = document.createElement('button')
    confirmButton.type = 'button'
    confirmButton.className = `h-9 rounded-md px-4 text-sm font-medium text-white ${
      danger ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-900 hover:bg-slate-800'
    }`
    confirmButton.textContent = confirmText

    const close = (value: boolean) => {
      overlay.remove()
      resolve(value)
    }

    cancelButton.addEventListener('click', () => close(false))
    confirmButton.addEventListener('click', () => close(true))
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close(false)
    })

    actions.append(cancelButton, confirmButton)
    dialog.append(heading, body, actions)
    overlay.append(dialog)
    document.body.appendChild(overlay)
    confirmButton.focus()
  })
}

/**
 * 统一的错误处理包装器
 * 用于替换吞掉异常的空处理
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
