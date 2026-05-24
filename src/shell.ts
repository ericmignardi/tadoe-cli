import { exec } from 'child_process';
import { SHELL_EXEC_TIMEOUT_MS, SHELL_EXEC_MAX_BUFFER } from './constants.js';

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: Error;
}

export function runShell(command: string, timeoutMs: number = SHELL_EXEC_TIMEOUT_MS): Promise<ShellResult> {
  return new Promise((resolve) => {
    exec(command, { timeout: timeoutMs, maxBuffer: SHELL_EXEC_MAX_BUFFER }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        exitCode: error && typeof (error as NodeJS.ErrnoException).code === 'number'
          ? (error as NodeJS.ErrnoException).code as unknown as number
          : error ? 1 : 0,
        error: error || undefined,
      });
    });
  });
}

/** Combine stdout, stderr, and error message into one string, formatted for an LLM tool result. */
export function formatShellResult(result: ShellResult): string {
  let output = result.stdout;
  if (result.stderr) output += `\n[STDERR]\n${result.stderr}`;
  if (result.error) output += `\n[EXECUTION ERROR] ${result.error.message}`;
  if (!output.trim()) output = 'Command executed successfully but returned no output.';
  return output;
}
