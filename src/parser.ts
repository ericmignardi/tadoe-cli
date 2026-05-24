import fs from 'fs';
import path from 'path';
import { DIR_TREE_MAX_DEPTH, SKIP_DIR_NAMES } from './constants.js';

export interface InjectedContext {
  path: string;
  content: string;
  isDir: boolean;
}

export interface ParsedInput {
  type: 'text' | 'slash' | 'shell';
  content: string;
  commandName?: string;
  args?: string[];
  injectedContext?: InjectedContext[];
}

/**
 * Parses user input: shell escape (!), slash command (/), or text with @path injections.
 */
export async function parseInput(input: string, baseDir: string = process.cwd()): Promise<ParsedInput> {
  const trimmed = input.trim();

  if (trimmed.startsWith('!')) {
    return { type: 'shell', content: trimmed.slice(1).trim() };
  }

  if (trimmed.startsWith('/')) {
    const parts = trimmed.split(/\s+/);
    return {
      type: 'slash',
      content: trimmed,
      commandName: parts[0].slice(1).toLowerCase(),
      args: parts.slice(1),
    };
  }

  const regex = /(?:^|\s)@([a-zA-Z0-9_\-\.\/\\+]+)/g;
  const resolvedContexts: InjectedContext[] = [];
  const seen = new Set<string>();
  let match;

  while ((match = regex.exec(input)) !== null) {
    const targetPath = match[1];
    const absolutePath = path.resolve(baseDir, targetPath);
    if (seen.has(absolutePath)) continue;
    seen.add(absolutePath);

    if (!fs.existsSync(absolutePath)) {
      resolvedContexts.push({
        path: targetPath,
        content: `Error: File or directory does not exist at ${absolutePath}`,
        isDir: false,
      });
      continue;
    }

    try {
      const stat = fs.statSync(absolutePath);
      if (stat.isFile()) {
        resolvedContexts.push({
          path: targetPath,
          content: fs.readFileSync(absolutePath, 'utf-8'),
          isDir: false,
        });
      } else if (stat.isDirectory()) {
        resolvedContexts.push({
          path: targetPath,
          content: listDirectoryTree(absolutePath, 0, DIR_TREE_MAX_DEPTH),
          isDir: true,
        });
      }
    } catch (err) {
      resolvedContexts.push({
        path: targetPath,
        content: `Error reading file/directory: ${(err as Error).message}`,
        isDir: false,
      });
    }
  }

  return { type: 'text', content: input, injectedContext: resolvedContexts };
}

function listDirectoryTree(dirPath: string, currentDepth: number, maxDepth: number): string {
  if (currentDepth > maxDepth) return '... [Max Depth Reached]';

  try {
    const files = fs.readdirSync(dirPath);
    const indent = '  '.repeat(currentDepth);
    let output = '';

    for (const file of files) {
      if (SKIP_DIR_NAMES.has(file)) continue;
      const fullPath = path.join(dirPath, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        output += `${indent}📁 ${file}/\n`;
        output += listDirectoryTree(fullPath, currentDepth + 1, maxDepth);
      } else {
        output += `${indent}📄 ${file} (${stat.size} bytes)\n`;
      }
    }
    return output;
  } catch (err) {
    return `Error listing dir: ${(err as Error).message}`;
  }
}
