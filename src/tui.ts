import chalk from 'chalk';
import readline from 'readline';
import ora, { Ora } from 'ora';
import prompts from 'prompts';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

import { Config, detectActiveModel } from './config.js';
import { printAsciiLogo } from './ascii.js';
import { parseInput } from './parser.js';
import { ChatMessage, saveSession, loadSession } from './sessions.js';
import { runAgentLoop, AgentHooks } from './llm.js';
import { commandHandlers } from './commands.js';
import { loadMemory } from './memory.js';
import { runShell } from './shell.js';
import { TOOL_RESULT_PREVIEW_CHARS, WRITE_PREVIEW_CHARS } from './constants.js';

// markedTerminal's types are not aligned with marked v12; one cast is enough.
marked.use(markedTerminal({
  reflowText: true,
  width: Math.min(process.stdout.columns || 80, 100),
  tab: 2,
}) as unknown as Parameters<typeof marked.use>[0]);

export { loadMemory };

function renderAssistantBlock(text: string): string {
  const border = chalk.magenta('│');
  try {
    const rendered = marked.parse(text) as string;
    return rendered.split('\n').map(line => `  ${border} ${line}`).join('\n');
  } catch {
    return text.split('\n').map(line => `  ${border} ${line}`).join('\n');
  }
}

/** Stateful line-aware writer that prefixes every new line with the magenta border. */
function createStreamingWriter() {
  const border = chalk.magenta('│');
  const prefix = `  ${border} `;
  let atLineStart = true;
  let anyOutput = false;

  return {
    write(chunk: string) {
      if (!chunk) return;
      const parts = chunk.split('\n');
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (atLineStart && (part.length > 0 || i < parts.length - 1)) {
          process.stdout.write(prefix);
          atLineStart = false;
          anyOutput = true;
        }
        if (part) {
          process.stdout.write(part);
          anyOutput = true;
        }
        if (i < parts.length - 1) {
          process.stdout.write('\n');
          atLineStart = true;
        }
      }
    },
    finish() {
      if (anyOutput && !atLineStart) process.stdout.write('\n');
    },
    didOutput() {
      return anyOutput;
    },
  };
}

function promptUser(rl: readline.Interface): Promise<string | null> {
  return new Promise(resolve => {
    rl.question(chalk.bold.magenta('\n> '), answer => resolve(answer));
    rl.once('close', () => resolve(null));
  });
}

async function runShellEscape(command: string): Promise<void> {
  console.log(chalk.dim(`  $ ${command}\n`));
  const result = await runShell(command);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(chalk.red(result.stderr));
  if (result.error) console.log(chalk.red(`  Exit code: ${result.exitCode}`));
  console.log();
}

function displayToolAction(name: string, args: any): void {
  const border = chalk.dim('─'.repeat(40));
  const icons: Record<string, { icon: string; label: (a: any) => string }> = {
    read_file: { icon: '📄', label: a => `Read ${a.path || 'file'}` },
    write_file: { icon: '✏️', label: a => `Write ${a.path || 'file'}` },
    list_dir: { icon: '📁', label: a => `List ${a.path || '.'}` },
    run_command: { icon: '⚡', label: a => `Run \`${a.command || ''}\`` },
  };
  const entry = icons[name] ?? { icon: '🔧', label: () => name };

  console.log('');
  console.log(chalk.dim(`  ┌${border}┐`));
  console.log(chalk.dim('  │ ') + `${entry.icon} ${chalk.bold.cyan(entry.label(args))}` + chalk.dim(' │'));
  console.log(chalk.dim(`  └${border}┘`));
}

function displayToolResult(result: string, success: boolean): void {
  const firstLine = result.split('\n').find(l => l.trim()) ?? '';
  const preview = firstLine.length > TOOL_RESULT_PREVIEW_CHARS
    ? firstLine.slice(0, TOOL_RESULT_PREVIEW_CHARS) + '…'
    : firstLine;
  console.log(success ? chalk.dim('  ✓ ') + chalk.dim(preview) : chalk.red('  ✗ ') + chalk.dim(preview));
}

function displayApiError(err: Error): void {
  console.log(chalk.red(`\n  ❌ Error communicating with LLM API: ${err.message}`));
  console.log('');
  console.log(chalk.yellow('  Troubleshooting:'));
  console.log(chalk.dim('  1. Make sure LM Studio is running.'));
  console.log(chalk.dim('  2. Open the Local Server tab in LM Studio.'));
  console.log(chalk.dim('  3. Load a model and click "Start Server".'));
  console.log(chalk.dim('  4. Verify the server port is 1234.'));
  console.log('');
}

/** Confirmation hook for safe-mode tools. */
async function confirmTool(name: string, args: any): Promise<boolean> {
  console.log(chalk.yellow('\n⚠️  [Tadoe Safe Mode] Action authorization requested.'));
  if (name === 'write_file') {
    console.log(chalk.yellow(`   Action: Write/Overwrite file: ${args.path}`));
    console.log(chalk.gray(`   Content preview:\n${String(args.content).slice(0, WRITE_PREVIEW_CHARS)}...`));
  } else if (name === 'run_command') {
    console.log(chalk.yellow(`   Action: Run command: ${args.command}`));
  }

  const { approve } = await prompts({
    type: 'confirm',
    name: 'approve',
    message: 'Do you authorize this action?',
    initial: false,
  });

  if (!approve) {
    console.log(chalk.red('🚫 Action denied by user.\n'));
    return false;
  }
  console.log(chalk.green('✔️  Action approved. Executing...\n'));
  return true;
}

export async function startInteractiveSession(config: Config, initialSessionId?: string) {
  printAsciiLogo();

  const activeModel = await detectActiveModel(config);
  console.log(
    chalk.dim('  Model: ') + chalk.bold.white(activeModel)
    + chalk.dim('  •  ') + chalk.dim(config.apiUrl)
  );
  console.log(chalk.dim(`  Safe mode: ${config.safeMode ? chalk.green('on') : chalk.red('off')}  •  /help for commands  •  /quit to exit\n`));

  const activeConfig = { ...config, model: activeModel };

  const state = {
    messages: [] as ChatMessage[],
    sessionId: initialSessionId || `session_${Date.now()}`,
    memory: loadMemory(activeConfig.memoryFile),
  };

  if (initialSessionId) {
    try {
      state.messages = loadSession(activeConfig.sessionsDir, initialSessionId);
      console.log(chalk.dim(`  Resumed session: ${initialSessionId} (${state.messages.length} messages)\n`));
    } catch (e) {
      console.log(chalk.red(`  Failed to resume: ${(e as Error).message}\n`));
      state.sessionId = `session_${Date.now()}`;
    }
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

  const exit = () => {
    console.log(chalk.dim('\n  Saving session and exiting. Goodbye!\n'));
    saveSession(activeConfig.sessionsDir, state.sessionId, state.messages);
    rl.close();
  };

  while (true) {
    const rawInput = await promptUser(rl);
    if (rawInput === null) {
      exit();
      break;
    }

    const input = rawInput.trim();
    if (!input) continue;

    const lower = input.toLowerCase();
    if (lower === 'exit' || lower === 'quit') {
      exit();
      break;
    }

    const parsed = await parseInput(input);

    if (parsed.type === 'shell') {
      await runShellEscape(parsed.content);
      continue;
    }

    if (parsed.type === 'slash') {
      const handler = parsed.commandName ? commandHandlers[parsed.commandName] : undefined;
      if (!handler) {
        console.log(chalk.red(`  Unknown command: /${parsed.commandName}. Type /help for commands.`));
        continue;
      }
      const result = handler({ config: activeConfig, args: parsed.args || [], state }) || {};
      if (result.clear) {
        console.clear();
        printAsciiLogo();
        console.log(
          chalk.dim('  Model: ') + chalk.bold.white(activeModel)
          + chalk.dim('  •  ') + chalk.dim(activeConfig.apiUrl)
        );
        console.log(chalk.dim(`  Safe mode: ${activeConfig.safeMode ? chalk.green('on') : chalk.red('off')}  •  /help for commands  •  /quit to exit\n`));
      }
      if (result.exit) {
        exit();
        break;
      }
      continue;
    }

    // Text: build prompt with injected @context and run the agent loop.
    let finalPrompt = parsed.content;
    if (parsed.injectedContext && parsed.injectedContext.length > 0) {
      finalPrompt += '\n\n### Injected Context:';
      for (const item of parsed.injectedContext) {
        const kind = item.isDir ? 'Structure of directory' : 'Content of file';
        finalPrompt += `\n\n${kind} "${item.path}":\n\`\`\`\n${item.content}\n\`\`\``;
      }
      console.log(chalk.dim(`  📎 Context: ${parsed.injectedContext.map(i => i.path).join(', ')}`));
    }
    state.messages.push({ role: 'user', content: finalPrompt });

    const startTime = Date.now();
    const spinnerRef: { current: Ora | null } = { current: null };
    const stopSpinner = () => {
      if (spinnerRef.current && spinnerRef.current.isSpinning) spinnerRef.current.stop();
    };
    let writer = createStreamingWriter();

    const controller = new AbortController();
    let cancelled = false;
    const onSigint = () => {
      if (cancelled) return;
      cancelled = true;
      controller.abort();
      stopSpinner();
      console.log(chalk.yellow('\n  ⚠ Cancelled — returning to prompt.\n'));
    };
    process.on('SIGINT', onSigint);

    const hooks: AgentHooks = {
      onTurnStart: () => {
        spinnerRef.current = ora({ text: chalk.dim('Thinking…'), color: 'magenta', spinner: 'dots' }).start();
        writer = createStreamingWriter();
      },
      onFirstToken: () => {
        stopSpinner();
      },
      onAssistantChunk: chunk => {
        stopSpinner();
        writer.write(chunk);
      },
      onToolStart: (name, args) => {
        stopSpinner();
        writer.finish();
        displayToolAction(name, args);
      },
      onToolResult: (_name, result, success) => {
        displayToolResult(result, success);
      },
      onToolParseError: (_raw, err) => {
        stopSpinner();
        console.log(chalk.red(`\n  ⚠ Failed to parse tool call: ${err.message}`));
      },
      onApiError: err => {
        stopSpinner();
        displayApiError(err);
      },
      confirm: activeConfig.safeMode ? confirmTool : undefined,
      signal: controller.signal,
    };

    console.log('');
    try {
      state.messages = await runAgentLoop(activeConfig, state.messages, state.memory, hooks);
    } finally {
      process.off('SIGINT', onSigint);
    }
    stopSpinner();
    writer.finish();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const totalChars = state.messages.reduce((acc, m) => acc + (m.content?.length || 0), 0);
    const tokenEstimate = Math.round(totalChars / 4);
    console.log(chalk.dim(`  ${elapsed}s  •  ~${tokenEstimate} tokens (session)\n`));

    saveSession(activeConfig.sessionsDir, state.sessionId, state.messages);
  }
}
