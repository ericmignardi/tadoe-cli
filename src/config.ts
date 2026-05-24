import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import dotenv from 'dotenv';
import { SECRET_FILE_MODE } from './constants.js';
import { keychainGet } from './keychain.js';

export interface Config {
  apiUrl: string;
  apiKey: string;
  model: string;
  safeMode: boolean;
  sessionsDir: string;
  memoryFile: string;
  historyFile: string;
  configFile: string;
}

const TADOE_DIR = path.join(os.homedir(), '.tadoe');

const DEFAULTS: Config = {
  apiUrl: 'http://127.0.0.1:1234/v1',
  apiKey: 'lm-studio',
  model: 'auto',
  safeMode: true,
  sessionsDir: path.join(TADOE_DIR, 'sessions'),
  memoryFile: path.join(TADOE_DIR, 'memory.json'),
  historyFile: path.join(TADOE_DIR, 'history'),
  configFile: path.join(TADOE_DIR, 'config.json'),
};

// localhost resolves to ::1 on Windows by default, which the LM Studio server
// does not listen on. Pin to IPv4 instead.
function preferIPv4(url: string): string {
  return url.replace(/\/\/localhost([:/])/i, '//127.0.0.1$1');
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function loadConfig(): Promise<Config> {
  dotenv.config();

  if (!(await exists(TADOE_DIR))) {
    await fs.mkdir(TADOE_DIR, { recursive: true });
  }

  let fileConfig: Partial<Config> = {};
  if (await exists(DEFAULTS.configFile)) {
    try {
      fileConfig = JSON.parse(await fs.readFile(DEFAULTS.configFile, 'utf-8'));
    } catch {
      console.warn(`[Config] Failed to parse ${DEFAULTS.configFile}. Using defaults.`);
    }
  }

  const apiUrl = preferIPv4(process.env.TADOE_API_URL || fileConfig.apiUrl || DEFAULTS.apiUrl);

  // Priority: env var → OS keychain → config file → default. The keychain
  // is preferred to plaintext config storage when present.
  const keychainKey = await keychainGet();
  const apiKey = process.env.TADOE_API_KEY || keychainKey || fileConfig.apiKey || DEFAULTS.apiKey;
  const model = process.env.TADOE_MODEL || fileConfig.model || DEFAULTS.model;

  let safeMode = DEFAULTS.safeMode;
  if (process.env.TADOE_SAFE_MODE !== undefined) {
    safeMode = process.env.TADOE_SAFE_MODE === 'true';
  } else if (fileConfig.safeMode !== undefined) {
    safeMode = fileConfig.safeMode;
  }

  const sessionsDir = process.env.TADOE_SESSIONS_DIR || fileConfig.sessionsDir || DEFAULTS.sessionsDir;
  const memoryFile = process.env.TADOE_MEMORY_FILE || fileConfig.memoryFile || DEFAULTS.memoryFile;
  const historyFile = process.env.TADOE_HISTORY_FILE || fileConfig.historyFile || DEFAULTS.historyFile;

  if (!(await exists(sessionsDir))) {
    await fs.mkdir(sessionsDir, { recursive: true });
  }

  return {
    apiUrl,
    apiKey,
    model,
    safeMode,
    sessionsDir,
    memoryFile,
    historyFile,
    configFile: DEFAULTS.configFile,
  };
}

export async function detectActiveModel(config: Config): Promise<string> {
  if (config.model !== 'auto') return config.model;

  try {
    const url = `${config.apiUrl.replace(/\/$/, '')}/models`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      const data = (await response.json()) as { data?: { id: string }[] };
      if (data?.data && data.data.length > 0) {
        return data.data[0].id;
      }
    }
  } catch {
    // server unreachable — fall through to placeholder
  }

  return 'local-model';
}

/**
 * Persist non-secret config to disk. The apiKey is NEVER written here — it
 * lives in the OS keychain (see keychain.ts) or in the user's env.
 */
export async function saveConfig(partialConfig: Partial<Omit<Config, 'apiKey'>>): Promise<void> {
  const current = await loadConfig();
  const updated = { ...current, ...partialConfig };
  // Strip apiKey before persisting so it never lands in plaintext.
  const { apiKey: _apiKey, ...safe } = updated;
  void _apiKey;
  await fs.writeFile(current.configFile, JSON.stringify(safe, null, 2), { encoding: 'utf-8', mode: SECRET_FILE_MODE });
}
