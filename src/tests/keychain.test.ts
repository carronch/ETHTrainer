import { describe, it, expect, vi } from 'vitest'

// Mock execSync so tests work without hitting real Keychain
vi.mock('node:child_process', () => ({
  execSync: vi.fn((cmd: string) => {
    if (cmd.includes('find-generic-password')) return 'test_password\n'
    if (cmd.includes('add-generic-password')) return ''
    if (cmd.includes('delete-generic-password')) return ''
    return ''
  }),
}))

import { getKeychainPassword, setKeychainPassword } from '../wallet/keychain.js'

describe('Keychain', () => {
  it('retrieves a password', () => {
    const pw = getKeychainPassword('TestService', 'TestAccount')
    expect(pw).toBe('test_password')
  })

  it('sets a password without throwing', () => {
    expect(() => setKeychainPassword('TestService', 'TestAccount', 'my_password')).not.toThrow()
  })
})
