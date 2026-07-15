export const FAVICON_CANVAS_SIZE = 512
export const FAVICON_SAFE_PADDING = 64

export type FaviconPlacement = {
  x: number
  y: number
  width: number
  height: number
}
export function calculateFaviconPlacement(
  sourceWidth: number,
  sourceHeight: number,
  canvasSize = FAVICON_CANVAS_SIZE,
  padding = FAVICON_SAFE_PADDING
): FaviconPlacement {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error('品牌图形尺寸无效')
  }
  const available = canvasSize - padding * 2
  if (available <= 0) throw new Error('Favicon 安全边距超过画布')
  const scale = Math.min(available / sourceWidth, available / sourceHeight)
  const width = sourceWidth * scale
  const height = sourceHeight * scale
  return {
    x: (canvasSize - width) / 2,
    y: (canvasSize - height) / 2,
    width,
    height,
  }
}

async function loadImage(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
    } catch {
      // Safari 对部分 SVG 不支持 createImageBitmap，继续使用 HTMLImageElement。
    }
  }

  const objectUrl = URL.createObjectURL(file)
  const image = new Image()
  image.decoding = 'async'
  image.src = objectUrl
  try {
    await image.decode()
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(objectUrl),
    }
  } catch (error) {
    URL.revokeObjectURL(objectUrl)
    throw error
  }
}

export async function createSquareFaviconFile(file: File): Promise<File> {
  const image = await loadImage(file)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = FAVICON_CANVAS_SIZE
    canvas.height = FAVICON_CANVAS_SIZE
    const context = canvas.getContext('2d')
    if (!context) throw new Error('浏览器无法创建 Favicon 画布')
    const placement = calculateFaviconPlacement(image.width, image.height)
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(image.source, placement.x, placement.y, placement.width, placement.height)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error('浏览器无法导出 Favicon PNG')), 'image/png')
    })
    const basename = file.name.replace(/\.[^.]+$/, '') || 'brand-symbol'
    return new File([blob], `${basename}-square.png`, { type: 'image/png', lastModified: Date.now() })
  } finally {
    image.close()
  }
}
