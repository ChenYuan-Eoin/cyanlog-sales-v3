// REQ: WP10. CI must execute checks rather than print success labels.
import { describe, it, expect } from 'vitest'
import { checkRequirementStructure } from './check-requirement-structure.mjs'
const valid = 'requirements:\n  F001:\n    name: Fixture\n    status: in_progress\n    feature_packet: packet.md\n'
describe('requirement structural validation', () => {
  it('checks a valid declared packet', () => expect(checkRequirementStructure(valid, p => p === 'packet.md').errors).toEqual([]))
  it('rejects duplicate IDs', () => expect(checkRequirementStructure(valid + valid.replace('requirements:\n', '')).errors).toContain('Duplicate requirement: F001'))
  it('rejects an invented completion state', () => expect(checkRequirementStructure(valid.replace('in_progress', 'trust_me')).errors).toHaveLength(1))
  it('rejects a broken packet reference', () => expect(checkRequirementStructure(valid, () => false).errors).toHaveLength(1))
  it('rejects an empty registry', () => expect(checkRequirementStructure('requirements:\n').errors).toHaveLength(1))
})
