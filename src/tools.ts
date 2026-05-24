import fs from 'fs/promises';
import path from 'path';
import { FILE_READ_LIMIT_BYTES, SKIP_DIR_NAMES } from './constants.js';
import { runShell, formatShellResult } from './shell.js';

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function resolveWithinCwd(targetPath: string): { ok: true; resolved: string } | { ok: false; error: string } {
  const resolved = path.resolve(process.cwd(), targetPath);
  const rel = path.relative(process.cwd(), resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { ok: false, error: `Error: Path "${targetPath}" escapes the workspace directory. Only paths inside ${process.cwd()} are permitted.` };
  }
  return { ok: true, resolved };
}

export interface ToolParameter {
  type: string;
  properties: Record<string, { type: string; description: string }>;
  required: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter;
  requiresConfirmation: boolean;
  execute: (args: any) => Promise<string>;
}

/**
 * Caller-supplied confirmation hook. Return true to allow the tool call.
 * If not provided (or returns true), execution proceeds without prompting.
 */
export type ConfirmHook = (name: string, args: any) => Promise<boolean>;

export const toolsList: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Reads the contents of a file from the local file system. Always specify the relative or absolute path.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The path of the file to read' },
      },
      required: ['path'],
    },
    requiresConfirmation: false,
    execute: async (args: { path: string }) => {
      const guard = resolveWithinCwd(args.path);
      if (!guard.ok) return guard.error;
      const resolvedPath = guard.resolved;
      let stat;
      try {
        stat = await fs.stat(resolvedPath);
      } catch {
        return `Error: File not found at ${resolvedPath}`;
      }
      if (!stat.isFile()) {
        return `Error: Path ${resolvedPath} is a directory, not a file.`;
      }
      if (stat.size > FILE_READ_LIMIT_BYTES) {
        const handle = await fs.open(resolvedPath, 'r');
        try {
          const buf = Buffer.alloc(FILE_READ_LIMIT_BYTES);
          const { bytesRead } = await handle.read(buf, 0, FILE_READ_LIMIT_BYTES, 0);
          return buf.slice(0, bytesRead).toString('utf-8') + '\n\n... [File content truncated]';
        } finally {
          await handle.close();
        }
      }
      return fs.readFile(resolvedPath, 'utf-8');
    },
  },
  {
    name: 'write_file',
    description: 'Writes content to a file in the local file system. If the file exists, it will be overwritten. Parent directories are created automatically.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The path where the file should be written' },
        content: { type: 'string', description: 'The complete text content to write to the file' },
      },
      required: ['path', 'content'],
    },
    requiresConfirmation: true,
    execute: async (args: { path: string; content: string }) => {
      const guard = resolveWithinCwd(args.path);
      if (!guard.ok) return guard.error;
      const resolvedPath = guard.resolved;
      const dir = path.dirname(resolvedPath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(resolvedPath, args.content, 'utf-8');
      return `Successfully wrote file to ${args.path}`;
    },
  },
  {
    name: 'list_dir',
    description: 'Lists the contents of a directory, showing file names, whether they are folders, and file sizes.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The directory path to list. Defaults to the current directory "." if not provided.',
        },
      },
      required: [],
    },
    requiresConfirmation: false,
    execute: async (args: { path?: string }) => {
      const targetDir = args.path || '.';
      const guard = resolveWithinCwd(targetDir);
      if (!guard.ok) return guard.error;
      const resolvedPath = guard.resolved;
      if (!(await exists(resolvedPath))) {
        return `Error: Directory not found at ${resolvedPath}`;
      }
      const stat = await fs.stat(resolvedPath);
      if (!stat.isDirectory()) {
        return `Error: Path ${resolvedPath} is a file, not a directory.`;
      }

      const files = await fs.readdir(resolvedPath);
      if (files.length === 0) return 'Directory is empty.';

      let output = `Contents of directory "${targetDir}":\n`;
      for (const file of files) {
        if (SKIP_DIR_NAMES.has(file)) continue;
        const fullPath = path.join(resolvedPath, file);
        try {
          const fstat = await fs.stat(fullPath);
          output += fstat.isDirectory()
            ? `📁 ${file}/\n`
            : `📄 ${file} (${fstat.size} bytes)\n`;
        } catch {
          output += `📄 ${file} (Error reading details)\n`;
        }
      }
      return output;
    },
  },
  {
    name: 'run_command',
    description: 'Runs a shell command on the local system and returns its stdout and stderr outputs. Use with caution.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command to execute in the terminal' },
      },
      required: ['command'],
    },
    requiresConfirmation: true,
    execute: async (args: { command: string }) => {
      const result = await runShell(args.command);
      return formatShellResult(result);
    },
  },
];

/**
 * Execute a tool by name. If the tool requires confirmation, the optional
 * `confirm` hook is consulted; if it resolves false, execution is denied.
 */
export async function executeTool(
  name: string,
  args: any,
  confirm?: ConfirmHook,
): Promise<string> {
  const tool = toolsList.find(t => t.name === name);
  if (!tool) return `Error: Tool "${name}" is not implemented.`;

  if (tool.requiresConfirmation && confirm) {
    const ok = await confirm(name, args);
    if (!ok) return `Error: User denied permission to execute the tool "${name}".`;
  }

  try {
    return await tool.execute(args);
  } catch (error) {
    return `Error executing tool "${name}": ${(error as Error).message}`;
  }
}
