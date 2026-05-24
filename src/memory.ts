import fs from 'fs/promises';
import path from 'path';
import { SECRET_FILE_MODE } from './constants.js';

export async function loadMemory(filePath: string): Promise<string> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(raw);
    return data.memory || '';
  } catch {
    return '';
  }
}

export async function saveMemory(filePath: string, memory: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify({ memory }, null, 2), { encoding: 'utf-8', mode: SECRET_FILE_MODE });
}
