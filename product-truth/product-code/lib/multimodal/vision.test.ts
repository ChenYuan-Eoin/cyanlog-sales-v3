import { describe, it, expect } from 'vitest'
import { analyzeVision, detectStamp, detectSignature } from './vision'

describe('analyzeVision', () => {
  it('should return degraded result for invalid image', async () => {
    const result = await analyzeVision('invalid-base64')
    expect(result.degraded).toBe(true)
    expect(result.provider).toBe('manual-fallback')
  })
})

describe('detectStamp', () => {
  it('should detect no stamp for invalid image', async () => {
    const result = await detectStamp('invalid-base64')
    expect(result.hasStamp).toBe(false)
    expect(result.confidence).toBe(0.9)
  })
})

describe('detectSignature', () => {
  it('should detect no signature for invalid image', async () => {
    const result = await detectSignature('invalid-base64')
    expect(result.hasSignature).toBe(false)
    expect(result.confidence).toBe(0.9)
  })
})
