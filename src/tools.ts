import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import prompts from 'prompts';
import chalk from 'chalk';

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

export const toolsList: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Reads the contents of a file from the local file system. Always specify the relative or absolute path.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The path of the file to read',
        },
      },
      required: ['path'],
    },
    requiresConfirmation: false,
    execute: async (args: { path: string }) => {
      const resolvedPath = path.resolve(process.cwd(), args.path);
      if (!fs.existsSync(resolvedPath)) {
        return `Error: File not found at ${resolvedPath}`;
      }
      const stat = fs.statSync(resolvedPath);
      if (!stat.isFile()) {
        return `Error: Path ${resolvedPath} is a directory, not a file.`;
      }
      // Read a maximum of 100KB to prevent context blowup
      const LIMIT = 100 * 1024;
      if (stat.size > LIMIT) {
        const stream = fs.readFileSync(resolvedPath, 'utf-8');
        return stream.slice(0, LIMIT) + '\n\n... [File content truncated to first 100KB]';
      }
      return fs.readFileSync(resolvedPath, 'utf-8');
    },
  },
  {
    name: 'write_file',
    description: 'Writes content to a file in the local file system. If the file exists, it will be overwritten. Parent directories are created automatically.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The path where the file should be written',
        },
        content: {
          type: 'string',
          description: 'The complete text content to write to the file',
        },
      },
      required: ['path', 'content'],
    },
    requiresConfirmation: true,
    execute: async (args: { path: string; content: string }) => {
      const resolvedPath = path.resolve(process.cwd(), args.path);
      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(resolvedPath, args.content, 'utf-8');
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
      const resolvedPath = path.resolve(process.cwd(), targetDir);
      if (!fs.existsSync(resolvedPath)) {
        return `Error: Directory not found at ${resolvedPath}`;
      }
      const stat = fs.statSync(resolvedPath);
      if (!stat.isDirectory()) {
        return `Error: Path ${resolvedPath} is a file, not a directory.`;
      }

      const files = fs.readdirSync(resolvedPath);
      if (files.length === 0) {
        return `Directory is empty.`;
      }

      let output = `Contents of directory "${targetDir}":\n`;
      for (const file of files) {
        if (file === 'node_modules' || file === '.git' || file === 'dist') {
          continue;
        }
        const fullPath = path.join(resolvedPath, file);
        try {
          const fstat = fs.statSync(fullPath);
          if (fstat.isDirectory()) {
            output += `📁 ${file}/\n`;
          } else {
            output += `📄 ${file} (${fstat.size} bytes)\n`;
          }
        } catch (e) {
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
        command: {
          type: 'string',
          description: 'The command to execute in the terminal',
        },
      },
      required: ['command'],
    },
    requiresConfirmation: true,
    execute: async (args: { command: string }) => {
      return new Promise<string>((resolve) => {
        // Set a timeout of 60 seconds
        const child = exec(args.command, { timeout: 60000 }, (error, stdout, stderr) => {
          let output = '';
          if (stdout) {
            output += stdout;
          }
          if (stderr) {
            output += `\n[STDERR]\n${stderr}`;
          }
          if (error) {
            output += `\n[EXECUTION ERROR] ${error.message}`;
          }
          if (!output.trim()) {
            output = `Command executed successfully but returned no output.`;
          }
          resolve(output);
        });
      });
    },
  },
];

/**
 * Execute a tool by name, optionally prompting user for confirmation if safeMode is enabled.
 */
export async function executeTool(name: string, args: any, safeMode: boolean): Promise<string> {
  const tool = toolsList.find(t => t.name === name);
  if (!tool) {
    return `Error: Tool "${name}" is not implemented.`;
  }

  if (safeMode && tool.requiresConfirmation) {
    console.log(chalk.yellow(`\n⚠️  [Tadoe Safe Mode] Action authorization requested.`));
    if (name === 'write_file') {
      console.log(chalk.yellow(`   Action: Write/Overwrite file: ${args.path}`));
      console.log(chalk.gray(`   Content preview (first 150 chars):\n${String(args.content).slice(0, 150)}...`));
    } else if (name === 'run_command') {
      console.log(chalk.yellow(`   Action: Run command: ${args.command}`));
    }

    const response = await prompts({
      type: 'confirm',
      name: 'approve',
      message: 'Do you authorize this action?',
      initial: false,
    });

    if (!response.approve) {
      console.log(chalk.red(`🚫 Action denied by user.\n`));
      return `Error: User denied permission to execute the tool "${name}".`;
    }
    console.log(chalk.green(`✔️  Action approved. Executing...\n`));
  }

  try {
    return await tool.execute(args);
  } catch (error) {
    return `Error executing tool "${name}": ${(error as Error).message}`;
  }
}
