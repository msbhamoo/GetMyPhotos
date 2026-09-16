/** Downscale a camera frame or picked file to a small JPEG for the selfie search. */
export async function toJpeg(source, max = 720, quality = 0.85) {
  let drawable, w, h
  if (source instanceof HTMLVideoElement) {
    drawable = source
    w = source.videoWidth
    h = source.videoHeight
  } else {
    drawable = await loadImage(source)
    w = drawable.width
    h = drawable.height
  }
  const scale = Math.min(1, max / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * scale)
  canvas.height = Math.round(h * scale)
  canvas.getContext('2d').drawImage(drawable, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}

async function loadImage(file) {
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {}
  }
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}
