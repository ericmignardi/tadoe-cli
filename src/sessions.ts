import fs from 'fs/promises';
import path from 'path';
import { SECRET_FILE_MODE } from './constants.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface SessionSummary {
  id: string;
  lastUpdated: string;
  lastUpdatedMs: number;
  messageCount: number;
}

function sessionPath(sessionsDir: string, sessionId: string): string {
  const baseName = sessionId.endsWith('.jsonl') ? sessionId : `${sessionId}.jsonl`;
  return path.join(sessionsDir, baseName);
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Append one or more messages as JSONL lines. The first write creates the
 * file with secret-file permissions; subsequent writes use append mode.
 */
export async function appendMessages(sessionsDir: string, sessionId: string, messages: ChatMessage[]): Promise<void> {
  if (messages.length === 0) return;
  await fs.mkdir(sessionsDir, { recursive: true });
  const filePath = sessionPath(sessionsDir, sessionId);
  const block = messages.map(m => JSON.stringify(m)).join('\n') + '\n';

  if (await exists(filePath)) {
    await fs.appendFile(filePath, block, 'utf-8');
  } else {
    await fs.writeFile(filePath, block, { encoding: 'utf-8', mode: SECRET_FILE_MODE });
  }
}

/**
 * Full-rewrite save — used when renaming a session via /chat save <name>.
 * For the per-turn happy path, prefer `appendMessages`.
 */
export async function saveSession(sessionsDir: string, sessionId: string, messages: ChatMessage[]): Promise<void> {
  await fs.mkdir(sessionsDir, { recursive: true });
  const filePath = sessionPath(sessionsDir, sessionId);
  const body = messages.map(m => JSON.stringify(m)).join('\n') + (messages.length ? '\n' : '');
  await fs.writeFile(filePath, body, { encoding: 'utf-8', mode: SECRET_FILE_MODE });
}

export async function loadSession(sessionsDir: string, sessionId: string): Promise<ChatMessage[]> {
  const filePath = sessionPath(sessionsDir, sessionId);
  if (!(await exists(filePath))) {
    throw new Error(`Session '${sessionId}' not found at ${filePath}`);
  }
  const raw = await fs.readFile(filePath, 'utf-8');
  const out: ChatMessage[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as ChatMessage);
    } catch {
      // skip corrupted line
    }
  }
  return out;
}

export async function listSessions(sessionsDir: string): Promise<SessionSummary[]> {
  if (!(await exists(sessionsDir))) return [];
  try {
    const files = (await fs.readdir(sessionsDir)).filter(f => f.endsWith('.jsonl'));
    const results: SessionSummary[] = [];
    for (const file of files) {
      const filePath = path.join(sessionsDir, file);
      try {
        const stat = await fs.stat(filePath);
        const raw = await fs.readFile(filePath, 'utf-8');
        const count = raw.split('\n').filter(l => l.trim().length > 0).length;
        results.push({
          id: path.basename(file, '.jsonl'),
          lastUpdated: new Date(stat.mtimeMs).toLocaleString(),
          lastUpdatedMs: stat.mtimeMs,
          messageCount: count,
        });
      } catch {
        // skip unreadable session
      }
    }
    return results.sort((a, b) => b.lastUpdatedMs - a.lastUpdatedMs);
  } catch (err) {
    console.error(`Error reading sessions: ${(err as Error).message}`);
    return [];
  }
}

export async function deleteSession(sessionsDir: string, sessionId: string): Promise<void> {
  const filePath = sessionPath(sessionsDir, sessionId);
  try {
    await fs.unlink(filePath);
  } catch {
    // already gone — ignore
  }
}
