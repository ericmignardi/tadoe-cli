import fs from 'fs';
import path from 'path';

export interface ParsedInput {
  type: 'text' | 'slash' | 'shell';
  content: string;
  commandName?: string;
  args?: string[];
  injectedContext?: { path: string; content: string; isDir: boolean }[];
}

/**
 * Parses user input to determine if it is a slash command, shell command, or normal text.
 * Resolves @file and @dir/ paths if found in text inputs.
 */
export async function parseInput(input: string, baseDir: string = process.cwd()): Promise<ParsedInput> {
  const trimmed = input.trim();

  // 1. Check Shell Commands starting with '!'
  if (trimmed.startsWith('!')) {
    const cmd = trimmed.slice(1).trim();
    return {
      type: 'shell',
      content: cmd,
    };
  }

  // 2. Check Slash Commands starting with '/'
  if (trimmed.startsWith('/')) {
    const parts = trimmed.split(/\s+/);
    const commandName = parts[0].slice(1).toLowerCase();
    const args = parts.slice(1);
    return {
      type: 'slash',
      content: trimmed,
      commandName,
      args,
    };
  }

  // 3. Resolve File/Directory references with '@'
  // Regex looks for @ followed by a path pattern. e.g. @package.json or @src/
  const regex = /(?:^|\s)@([a-zA-Z0-9_\-\.\/\\+]+)/g;
  let match;
  const resolvedContexts: { path: string; content: string; isDir: boolean }[] = [];
  const foundPaths = new Set<string>();

  while ((match = regex.exec(input)) !== null) {
    const targetPath = match[1];
    const absolutePath = path.resolve(baseDir, targetPath);

    if (foundPaths.has(absolutePath)) {
      continue;
    }
    foundPaths.add(absolutePath);

    if (fs.existsSync(absolutePath)) {
      try {
        const stat = fs.statSync(absolutePath);
        if (stat.isFile()) {
          // Read file content
          const content = fs.readFileSync(absolutePath, 'utf-8');
          resolvedContexts.push({
            path: targetPath,
            content,
            isDir: false,
          });
        } else if (stat.isDirectory()) {
          // List directory structure up to depth 2
          const dirTree = listDirectoryTree(absolutePath, 0, 2);
          resolvedContexts.push({
            path: targetPath,
            content: dirTree,
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
    } else {
      resolvedContexts.push({
        path: targetPath,
        content: `Error: File or directory does not exist at absolute path ${absolutePath}`,
        isDir: false,
      });
    }
  }

  return {
    type: 'text',
    content: input,
    injectedContext: resolvedContexts,
  };
}

/**
 * Lists directory structure recursively up to max depth.
 */
function listDirectoryTree(dirPath: string, currentDepth: number, maxDepth: number): string {
  if (currentDepth > maxDepth) {
    return '... [Max Depth Reached]';
  }

  try {
    const files = fs.readdirSync(dirPath);
    let output = '';
    const indent = '  '.repeat(currentDepth);

    for (const file of files) {
      if (file === 'node_modules' || file === '.git' || file === 'dist') {
        continue;
      }
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
