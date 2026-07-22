import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  legacyDocAdapterConfigured,
  validateLegacyDocWorkerProof,
} from './legacy-doc-adapter'

function configureLocalProof() {
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('DOC_ADAPTER_ENABLED', 'true')
  vi.stubEnv('DOC_ADAPTER_PROOF_SCOPE', 'trusted-fixture-local-proof')
  vi.stubEnv('DOC_ADAPTER_ISOLATION_BACKEND', 'bubblewrap')
  vi.stubEnv('DOC_ADAPTER_PYTHON_PATH', process.execPath)
  vi.stubEnv('DOC_ADAPTER_SOFFICE_PATH', process.execPath)
}

function validProof() {
  return {
    success: true,
    anchored: 1,
    unlocated: [],
    source_hash: 'a'.repeat(64),
    output_hash: 'b'.repeat(64),
    source_text_hash: 'c'.repeat(64),
    output_text_hash: 'c'.repeat(64),
    macro_streams_verified: 10,
    object_streams_verified: 0,
    page_geometry: [[612, 792]],
    native_comments_added: 1,
    target_load_macro_policy: 'MacroExecutionMode=0',
    conversion_macro_canary: 'not-proven',
    active_content_policy: 'disabled',
    network_isolation: 'network-namespace-unshared',
    isolation_backend: 'bubblewrap',
    proof_scope: 'trusted-fixture-local-proof',
  }
}

describe('legacy DOC local proof boundary', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('requires an explicit trusted-fixture proof scope', () => {
    configureLocalProof()
    vi.stubEnv('DOC_ADAPTER_PROOF_SCOPE', '')
    expect(legacyDocAdapterConfigured()).toBe(false)
  })

  it('can be enabled only as a non-production local proof', () => {
    configureLocalProof()
    expect(legacyDocAdapterConfigured()).toBe(true)

    vi.stubEnv('NODE_ENV', 'production')
    expect(legacyDocAdapterConfigured()).toBe(false)
  })

  it('rejects incomplete or internally inconsistent worker proof', () => {
    expect(validateLegacyDocWorkerProof(validProof())).toBe(true)
    expect(validateLegacyDocWorkerProof({ success: true })).toBe(false)
    expect(validateLegacyDocWorkerProof({
      ...validProof(),
      native_comments_added: 2,
    })).toBe(false)
    expect(validateLegacyDocWorkerProof({
      ...validProof(),
      source_text_hash: undefined,
      output_text_hash: undefined,
    })).toBe(false)
  })
})
