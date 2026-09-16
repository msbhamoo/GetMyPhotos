/** Shared by the Web Worker and the main-thread fallback. */
export async function compressImage(file, canvasFactory) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const web = await encode(bitmap, 1600, 0.8, canvasFactory)
    const thumb = await encode(bitmap, 400, 0.7, canvasFactory, web.mime)
    const hash = await sha1(await file.arrayBuffer())
    return { web: web.blob, thumb: thumb.blob, mime: web.mime, width: web.width, height: web.height, hash }
  } finally {
    bitmap.close?.()
  }
}

async function encode(bitmap, maxSide, quality, canvasFactory, forceMime) {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)
  const { canvas, toBlob } = canvasFactory(width, height)
  // Re-drawing onto a canvas also strips EXIF (including GPS location)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height)
  let blob = await toBlob(forceMime || 'image/webp', quality)
  if (blob.type !== 'image/webp' && blob.type !== 'image/jpeg') blob = await toBlob('image/jpeg', quality)
  return { blob, mime: blob.type, width, height }
}

async function sha1(buffer) {
  const digest = await crypto.subtle.digest('SHA-1', buffer)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const offscreenCanvas = (w, h) => {
  const canvas = new OffscreenCanvas(w, h)
  return { canvas, toBlob: (type, quality) => canvas.convertToBlob({ type, quality }) }
}

export const domCanvas = (w, h) => {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  return { canvas, toBlob: (type, quality) => new Promise((r) => canvas.toBlob(r, type, quality)) }
}
