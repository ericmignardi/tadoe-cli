/**
 * Thin wrapper around the OS keychain (macOS Keychain, Windows Credential
 * Manager, libsecret on Linux). Failures are swallowed and surfaced as
 * `null` so callers can fall back to env vars or file config.
 */

const SERVICE = 'tadoe-cli';
const ACCOUNT = 'api-key';

type Entry = { setPassword: (p: string) => void; getPassword: () => string | null; deletePassword: () => boolean };

async function loadEntry(): Promise<Entry | null> {
  try {
    const mod = (await import('@napi-rs/keyring')) as { Entry: new (service: string, account: string) => Entry };
    return new mod.Entry(SERVICE, ACCOUNT);
  } catch {
    return null;
  }
}

export async function keychainGet(): Promise<string | null> {
  const entry = await loadEntry();
  if (!entry) return null;
  try {
    const v = entry.getPassword();
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export async function keychainSet(value: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const entry = await loadEntry();
  if (!entry) return { ok: false, error: 'OS keychain unavailable on this system.' };
  try {
    entry.setPassword(value);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function keychainDelete(): Promise<{ ok: true } | { ok: false; error: string }> {
  const entry = await loadEntry();
  if (!entry) return { ok: false, error: 'OS keychain unavailable on this system.' };
  try {
    entry.deletePassword();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function keychainAvailable(): Promise<boolean> {
  return (await loadEntry()) !== null;
}
