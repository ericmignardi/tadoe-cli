import fs from 'fs';
import path from 'path';

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

export function saveSession(sessionsDir: string, sessionId: string, messages: ChatMessage[]): void {
  const filePath = path.join(sessionsDir, `${sessionId}.json`);
  const data: SessionData = {
    id: sessionId,
    lastUpdated: Date.now(),
    messages,
  };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export function loadSession(sessionsDir: string, sessionId: string): ChatMessage[] {
  // If the user specified a filename or just name, make sure we append .json if not present
  const baseName = sessionId.endsWith('.json') ? sessionId : `${sessionId}.json`;
  const filePath = path.join(sessionsDir, baseName);
  
  if (!fs.existsSync(filePath)) {
    throw new Error(`Session '${sessionId}' not found at ${filePath}`);
  }

  const fileData = fs.readFileSync(filePath, 'utf-8');
  const session = JSON.parse(fileData) as SessionData;
  return session.messages;
}

export function listSessions(sessionsDir: string): { id: string; lastUpdated: string; messageCount: number }[] {
  if (!fs.existsSync(sessionsDir)) {
    return [];
  }

  try {
    const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
    const results = files.map(file => {
      const filePath = path.join(sessionsDir, file);
      try {
        const fileData = fs.readFileSync(filePath, 'utf-8');
        const session = JSON.parse(fileData) as SessionData;
        const stats = fs.statSync(filePath);
        return {
          id: path.basename(file, '.json'),
          lastUpdated: new Date(session.lastUpdated || stats.mtimeMs).toLocaleString(),
          messageCount: session.messages ? session.messages.length : 0,
        };
      } catch (err) {
        return null;
      }
    });

    return results
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => b.id.localeCompare(a.id)); // Newest or largest ID first
  } catch (err) {
    console.error(`Error reading sessions: ${(err as Error).message}`);
    return [];
  }
}

export function deleteSession(sessionsDir: string, sessionId: string): void {
  const baseName = sessionId.endsWith('.json') ? sessionId : `${sessionId}.json`;
  const filePath = path.join(sessionsDir, baseName);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
