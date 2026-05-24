import fs from 'fs/promises';
import readline from 'readline';
import chalk from 'chalk';
import { SECRET_FILE_MODE } from './constants.js';

const MAX_HISTORY = 1000;

export interface InputSession {
  prompt(): Promise<string | null>;
  close(): void;
}

async function loadHistory(historyFile: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(historyFile, 'utf-8');
    const items: string[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        items.push(JSON.parse(trimmed) as string);
      } catch {
        // tolerate corrupted line
      }
    }
    return items.slice(-MAX_HISTORY);
  } catch {
    return [];
  }
}

async function appendHistory(historyFile: string, entry: string): Promise<void> {
  try {
    await fs.appendFile(historyFile, JSON.stringify(entry) + '\n', { encoding: 'utf-8', mode: SECRET_FILE_MODE });
  } catch {
    // best-effort — history is non-critical
  }
}

/**
 * Builds a prompt session that supports:
 *   - persistent history (up/down arrow) backed by `historyFile`
 *   - multi-line input via trailing backslash continuation
 *   - returning `null` from prompt() when stdin closes (Ctrl+C / Ctrl+D)
 */
export async function createInputSession(historyFile: string): Promise<InputSession> {
  const history = await loadHistory(historyFile);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    history: [...history].reverse(), // readline expects newest-first
    historySize: MAX_HISTORY,
    removeHistoryDuplicates: true,
  });

  const initialPrompt = chalk.bold.magenta('\n> ');
  const continuationPrompt = chalk.bold.magenta('… ');

  let closed = false;
  rl.once('close', () => {
    closed = true;
  });

  const askLine = (prompt: string): Promise<string | null> => new Promise(resolve => {
    if (closed) return resolve(null);
    let resolved = false;
    const onClose = () => {
      if (resolved) return;
      resolved = true;
      resolve(null);
    };
    rl.once('close', onClose);
    rl.question(prompt, (answer: string) => {
      if (resolved) return;
      resolved = true;
      rl.removeListener('close', onClose);
      resolve(answer);
    });
  });

  return {
    async prompt() {
      const lines: string[] = [];
      let first = true;
      while (true) {
        const line = await askLine(first ? initialPrompt : continuationPrompt);
        if (line === null) return null;
        first = false;

        // Trailing backslash means "keep going" — accumulate and re-prompt.
        if (line.endsWith('\\')) {
          lines.push(line.slice(0, -1));
          continue;
        }
        lines.push(line);
        const result = lines.join('\n');
        if (result.trim()) {
          await appendHistory(historyFile, result);
        }
        return result;
      }
    },
    close() {
      rl.close();
    },
  };
}
