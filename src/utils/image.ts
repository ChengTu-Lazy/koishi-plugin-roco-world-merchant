const PNG_SIGNATURE = '89504e470d0a1a0a'

export function isPngBase64(value?: string) {
  if (!value) return false

  try {
    return Buffer.from(value, 'base64').subarray(0, 8).toString('hex') === PNG_SIGNATURE
  } catch {
    return false
  }
}
