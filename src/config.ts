import fs from 'fs';
import path from 'path';
import os from 'os';
import dotenv from 'dotenv';

// Load local .env if it exists
dotenv.config();

export interface Config {
  apiUrl: string;
  apiKey: string;
  model: string;
  safeMode: boolean;
  sessionsDir: string;
  memoryFile: string;
  configFile: string;
}

const TADOE_DIR = path.join(os.homedir(), '.tadoe');

const DEFAULTS: Config = {
  apiUrl: 'http://localhost:1234/v1',
  apiKey: 'lm-studio',
  model: 'auto',
  safeMode: true,
  sessionsDir: path.join(TADOE_DIR, 'sessions'),
  memoryFile: path.join(TADOE_DIR, 'memory.json'),
  configFile: path.join(TADOE_DIR, 'config.json'),
};

export function loadConfig(): Config {
  // Ensure .tadoe base directory exists
  if (!fs.existsSync(TADOE_DIR)) {
    fs.mkdirSync(TADOE_DIR, { recursive: true });
  }

  let fileConfig: Partial<Config> = {};
  if (fs.existsSync(DEFAULTS.configFile)) {
    try {
      const data = fs.readFileSync(DEFAULTS.configFile, 'utf-8');
      fileConfig = JSON.parse(data);
    } catch (e) {
      console.warn(`[Config] Warning: Failed to parse config file at ${DEFAULTS.configFile}. Using defaults.`);
    }
  }

  // Load from environment or fall back to fileConfig / DEFAULTS
  const apiUrl = process.env.TADOE_API_URL || fileConfig.apiUrl || DEFAULTS.apiUrl;
  const apiKey = process.env.TADOE_API_KEY || fileConfig.apiKey || DEFAULTS.apiKey;
  const model = process.env.TADOE_MODEL || fileConfig.model || DEFAULTS.model;
  
  let safeMode = DEFAULTS.safeMode;
  if (process.env.TADOE_SAFE_MODE !== undefined) {
    safeMode = process.env.TADOE_SAFE_MODE === 'true';
  } else if (fileConfig.safeMode !== undefined) {
    safeMode = fileConfig.safeMode;
  }

  const sessionsDir = process.env.TADOE_SESSIONS_DIR || fileConfig.sessionsDir || DEFAULTS.sessionsDir;
  const memoryFile = process.env.TADOE_MEMORY_FILE || fileConfig.memoryFile || DEFAULTS.memoryFile;

  // Create session directory
  if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir, { recursive: true });
  }

  return {
    apiUrl,
    apiKey,
    model,
    safeMode,
    sessionsDir,
    memoryFile,
    configFile: DEFAULTS.configFile,
  };
}

export async function detectActiveModel(config: Config): Promise<string> {
  if (config.model !== 'auto') {
    return config.model;
  }

  try {
    const url = `${config.apiUrl.replace(/\/$/, '')}/models`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      const data = (await response.json()) as any;
      if (data && data.data && data.data.length > 0) {
        // Return first loaded model name
        return data.data[0].id;
      }
    }
  } catch (err) {
    // If server is not active or call fails, don't fail immediately, just print warning
  }

  // Fallback if autodetection fails
  return 'local-model';
}

export function saveConfig(partialConfig: Partial<Config>) {
  const current = loadConfig();
  const updated = { ...current, ...partialConfig };
  fs.writeFileSync(current.configFile, JSON.stringify(updated, null, 2), 'utf-8');
}
