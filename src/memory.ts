import fs from 'fs';
import path from 'path';

export function loadMemory(filePath: string): string {
  if (!fs.existsSync(filePath)) return '';
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return data.memory || '';
  } catch {
    return '';
  }
}

export function saveMemory(filePath: string, memory: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify({ memory }, null, 2), 'utf-8');
}
