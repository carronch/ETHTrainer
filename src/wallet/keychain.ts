import { execSync } from 'node:child_process'

// macOS Keychain integration via the `security` CLI
// No native modules required — works on every Mac out of the box.

export function getKeychainPassword(service: string, account: string): string {
  // On Linux (server): read from KEYSTORE_PASSWORD env var
  if (process.platform !== 'darwin') {
    const pw = process.env['KEYSTORE_PASSWORD']
    if (!pw) throw new Error('KEYSTORE_PASSWORD not set in environment / .dev.vars')
    return pw
  }

  // On macOS: use Keychain
  try {
    const password = execSync(
      `security find-generic-password -s "${service}" -a "${account}" -w`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim()
    if (!password) throw new Error('Empty password returned from Keychain')
    return password
  } catch (err) {
    throw new Error(
      `Could not retrieve password from macOS Keychain.\n` +
      `Service: ${service}, Account: ${account}\n\n` +
      `Set it with:\n  security add-generic-password -s "${service}" -a "${account}" -w "your_password"\n\n` +
      `Original error: ${String(err)}`,
    )
  }
}

export function setKeychainPassword(service: string, account: string, password: string): void {
  execSync(
    `security add-generic-password -s "${service}" -a "${account}" -w "${password}" -U`,
    { stdio: 'pipe' },
  )
}

export function deleteKeychainPassword(service: string, account: string): void {
  try {
    execSync(`security delete-generic-password -s "${service}" -a "${account}"`, { stdio: 'pipe' })
  } catch {
    // Ignore if it doesn't exist
  }
}
