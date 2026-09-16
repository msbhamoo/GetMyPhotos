import { compressImage, offscreenCanvas } from './imaging.js'

self.onmessage = async ({ data: { id, file } }) => {
  if (typeof OffscreenCanvas === 'undefined') {
    self.postMessage({ id, error: 'NO_OFFSCREEN' })
    return
  }
  try {
    const result = await compressImage(file, offscreenCanvas)
    self.postMessage({ id, ...result })
  } catch (e) {
    self.postMessage({ id, error: String(e?.message || e) })
  }
}
