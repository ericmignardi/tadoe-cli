import fs from 'fs';
import path from 'path';
import { SECRET_FILE_MODE } from './constants.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface SessionData {
  id: string;
  lastUpdated: number;
  messages: ChatMessage[];
}

export interface SessionSummary {
  id: string;
  lastUpdated: string;
  lastUpdatedMs: number;
  messageCount: number;
}

function sessionPath(sessionsDir: string, sessionId: string): string {
  const baseName = sessionId.endsWith('.json') ? sessionId : `${sessionId}.json`;
  return path.join(sessionsDir, baseName);
}

export function saveSession(sessionsDir: string, sessionId: string, messages: ChatMessage[]): void {
  const data: SessionData = {
    id: sessionId,
    lastUpdated: Date.now(),
    messages,
  };
  fs.writeFileSync(sessionPath(sessionsDir, sessionId), JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: SECRET_FILE_MODE });
}

export function loadSession(sessionsDir: string, sessionId: string): ChatMessage[] {
  const filePath = sessionPath(sessionsDir, sessionId);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Session '${sessionId}' not found at ${filePath}`);
  }
  const session = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SessionData;
  return session.messages;
}

export function listSessions(sessionsDir: string): SessionSummary[] {
  if (!fs.existsSync(sessionsDir)) return [];

  try {
    const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
    const results: SessionSummary[] = [];

    for (const file of files) {
      const filePath = path.join(sessionsDir, file);
      try {
        const session = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SessionData;
        const mtime = fs.statSync(filePath).mtimeMs;
        const ms = session.lastUpdated || mtime;
        results.push({
          id: path.basename(file, '.json'),
          lastUpdated: new Date(ms).toLocaleString(),
          lastUpdatedMs: ms,
          messageCount: session.messages?.length ?? 0,
        });
      } catch {
        // skip unreadable session files
      }
    }

    return results.sort((a, b) => b.lastUpdatedMs - a.lastUpdatedMs);
  } catch (err) {
    console.error(`Error reading sessions: ${(err as Error).message}`);
    return [];
  }
}

export function deleteSession(sessionsDir: string, sessionId: string): void {
  const filePath = sessionPath(sessionsDir, sessionId);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
