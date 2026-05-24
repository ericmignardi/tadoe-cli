import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { exec } from 'child_process';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

import { Config, saveConfig, detectActiveModel } from './config.js';
import { printAsciiLogo } from './ascii.js';
import { parseInput } from './parser.js';
import { ChatMessage, saveSession, loadSession, listSessions, deleteSession } from './sessions.js';
import { runAgentLoop } from './llm.js';
import { toolsList } from './tools.js';

// Register markdown terminal renderer with Claude-like styling
marked.use(markedTerminal({
  reflowText: true,
  width: Math.min(process.stdout.columns || 80, 100),
  tab: 2,
} as any) as any);

export function loadMemory(filePath: string): string {
  if (!fs.existsSync(filePath)) return '';
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return data.memory || '';
  } catch {
    return '';
  }
}

export function saveMemory(filePath: string, memory: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify({ memory }, null, 2), 'utf-8');
}

/**
 * Runs a shell escape command synchronously (awaited).
 */
async function runShellEscape(command: string): Promise<void> {
  console.log(chalk.dim(`  $ ${command}\n`));
  return new Promise((resolve) => {
    exec(command, (err, stdout, stderr) => {
      if (stdout) {
        process.stdout.write(stdout);
      }
      if (stderr) {
        process.stderr.write(chalk.red(stderr));
      }
      if (err) {
        console.log(chalk.red(`  Exit code: ${(err as any).code}`));
      }
      console.log();
      resolve();
    });
  });
}

/**
 * Renders markdown text with a left-border like Claude CLI.
 */
function renderAssistantBlock(text: string): string {
  const border = chalk.magenta('│');
  try {
    const rendered = marked.parse(text) as string;
    const lines = rendered.split('\n');
    return lines.map(line => `  ${border} ${line}`).join('\n');
  } catch {
    const lines = text.split('\n');
    return lines.map(line => `  ${border} ${line}`).join('\n');
  }
}

/**
 * Prompt the user for input using readline (matches Claude CLI's clean `>` prompt).
 */
function promptUser(rl: readline.Interface): Promise<string | null> {
  return new Promise((resolve) => {
    rl.question(chalk.bold.magenta('\n> '), (answer) => {
      resolve(answer);
    });

    // Handle Ctrl+C gracefully
    rl.once('close', () => {
      resolve(null);
    });
  });
}

/**
 * Interactive REPL terminal session styled like Claude CLI.
 */
export async function startInteractiveSession(config: Config, initialSessionId?: string) {
  printAsciiLogo();

  // Detect active model name
  const activeModel = await detectActiveModel(config);

  // Compact status line (like Claude CLI's model info bar)
  const modelDisplay = chalk.bold.white(activeModel);
  const apiDisplay = chalk.dim(config.apiUrl);
  console.log(chalk.dim(`  Model: `) + modelDisplay + chalk.dim(`  •  `) + apiDisplay);
  console.log(chalk.dim(`  Safe mode: ${config.safeMode ? chalk.green('on') : chalk.red('off')}  •  /help for commands  •  /quit to exit\n`));

  // Merge the detected model back into the config so llm.ts uses it
  const activeConfig = { ...config, model: activeModel };

  let messages: ChatMessage[] = [];
  let sessionId = initialSessionId || `session_${Date.now()}`;

  if (initialSessionId) {
    try {
      messages = loadSession(activeConfig.sessionsDir, initialSessionId);
      console.log(chalk.dim(`  Resumed session: ${initialSessionId} (${messages.length} messages)\n`));
    } catch (e) {
      console.log(chalk.red(`  Failed to resume: ${(e as Error).message}\n`));
      sessionId = `session_${Date.now()}`;
    }
  }

  // Load persistent memory
  let memory = loadMemory(activeConfig.memoryFile);

  // Set up readline for native terminal input
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  while (true) {
    const rawInput = await promptUser(rl);

    // If Ctrl+C or stream closed
    if (rawInput === null) {
      console.log(chalk.dim('\n  Saving session and exiting. Goodbye!\n'));
      saveSession(activeConfig.sessionsDir, sessionId, messages);
      rl.close();
      break;
    }

    const input = rawInput.trim();
    if (!input) continue;

    // Check for exit/quit (with or without slash)
    const lowerInput = input.toLowerCase();
    if (lowerInput === 'exit' || lowerInput === 'quit') {
      console.log(chalk.dim('\n  Saving session and exiting. Goodbye!\n'));
      saveSession(activeConfig.sessionsDir, sessionId, messages);
      rl.close();
      break;
    }

    // Parse the input
    const parsed = await parseInput(input);

    if (parsed.type === 'shell') {
      await runShellEscape(parsed.content);
      continue;
    }

    if (parsed.type === 'slash') {
      const cmd = parsed.commandName;
      const args = parsed.args || [];

      if (cmd === 'exit' || cmd === 'quit') {
        console.log(chalk.dim('\n  Saving session and exiting. Goodbye!\n'));
        saveSession(activeConfig.sessionsDir, sessionId, messages);
        rl.close();
        break;
      }

      if (cmd === 'clear') {
        console.clear();
        continue;
      }

      if (cmd === 'help') {
        console.log('');
        console.log(chalk.bold('  Commands:'));
        console.log(chalk.dim('  ─────────────────────────────────────────'));
        console.log(`  ${chalk.yellow('/help')}                   Show this menu`);
        console.log(`  ${chalk.yellow('/clear')}                  Clear screen`);
        console.log(`  ${chalk.yellow('/tools')}                  List agent tools`);
        console.log(`  ${chalk.yellow('/quit')}                   Exit session`);
        console.log(`  ${chalk.yellow('/chat list')}              List saved sessions`);
        console.log(`  ${chalk.yellow('/chat save <name>')}       Save session`);
        console.log(`  ${chalk.yellow('/chat resume <name>')}     Resume session`);
        console.log(`  ${chalk.yellow('/chat delete <name>')}     Delete session`);
        console.log(`  ${chalk.yellow('/memory list')}            Show memories`);
        console.log(`  ${chalk.yellow('/memory add <text>')}      Add to memory`);
        console.log(`  ${chalk.yellow('/memory clear')}           Clear memory`);
        console.log('');
        console.log(chalk.bold('  Input Shortcuts:'));
        console.log(chalk.dim('  ─────────────────────────────────────────'));
        console.log(`  ${chalk.yellow('@file.ts')}                Inject file contents`);
        console.log(`  ${chalk.yellow('@src/')}                   Inject directory tree`);
        console.log(`  ${chalk.yellow('!git status')}             Run shell command`);
        console.log('');
        continue;
      }

      if (cmd === 'tools') {
        console.log('');
        console.log(chalk.bold('  Available Tools:'));
        console.log(chalk.dim('  ─────────────────────────────────────────'));
        toolsList.forEach(t => {
          const confirmTag = t.requiresConfirmation ? chalk.yellow(' (requires approval)') : '';
          console.log(`  ${chalk.cyan(t.name)}${confirmTag}`);
          console.log(chalk.dim(`    ${t.description}`));
        });
        console.log('');
        continue;
      }

      if (cmd === 'chat') {
        const sub = args[0]?.toLowerCase();
        const tag = args.slice(1).join('_').trim();

        if (sub === 'list') {
          const list = listSessions(activeConfig.sessionsDir);
          if (list.length === 0) {
            console.log(chalk.dim('\n  No saved sessions.\n'));
          } else {
            console.log('');
            console.log(chalk.bold('  Saved Sessions:'));
            list.forEach(s => {
              console.log(chalk.dim(`  • ${chalk.white(s.id)} — ${s.messageCount} messages — ${s.lastUpdated}`));
            });
            console.log('');
          }
        } else if (sub === 'save') {
          if (!tag) {
            console.log(chalk.red('  Usage: /chat save <name>'));
          } else {
            sessionId = tag;
            saveSession(activeConfig.sessionsDir, sessionId, messages);
            console.log(chalk.green(`  ✓ Session saved: ${sessionId}\n`));
          }
        } else if (sub === 'resume') {
          if (!tag) {
            console.log(chalk.red('  Usage: /chat resume <name>'));
          } else {
            try {
              messages = loadSession(activeConfig.sessionsDir, tag);
              sessionId = tag;
              console.log(chalk.green(`  ✓ Resumed: ${sessionId} (${messages.length} messages)\n`));
            } catch (e) {
              console.log(chalk.red(`  ${(e as Error).message}`));
            }
          }
        } else if (sub === 'delete') {
          if (!tag) {
            console.log(chalk.red('  Usage: /chat delete <name>'));
          } else {
            deleteSession(activeConfig.sessionsDir, tag);
            console.log(chalk.green(`  ✓ Deleted: ${tag}`));
          }
        } else {
          console.log(chalk.red('  Usage: /chat [list|save|resume|delete]'));
        }
        continue;
      }

      if (cmd === 'memory') {
        const sub = args[0]?.toLowerCase();
        const text = args.slice(1).join(' ').trim();

        if (sub === 'list') {
          if (!memory.trim()) {
            console.log(chalk.dim('\n  No memories stored.\n'));
          } else {
            console.log('');
            console.log(chalk.bold('  Memories:'));
            memory.split('\n').forEach(line => {
              console.log(chalk.dim(`  • ${line}`));
            });
            console.log('');
          }
        } else if (sub === 'add') {
          if (!text) {
            console.log(chalk.red('  Usage: /memory add <text>'));
          } else {
            memory = memory ? `${memory}\n${text}` : text;
            saveMemory(activeConfig.configFile.replace('config.json', 'memory.json'), memory);
            console.log(chalk.green('  ✓ Memory updated.'));
          }
        } else if (sub === 'clear') {
          memory = '';
          saveMemory(activeConfig.configFile.replace('config.json', 'memory.json'), memory);
          console.log(chalk.green('  ✓ Memory cleared.'));
        } else {
          console.log(chalk.red('  Usage: /memory [list|add|clear]'));
        }
        continue;
      }

      console.log(chalk.red(`  Unknown command: /${cmd}. Type /help for commands.`));
      continue;
    }

    // Normal Text input: call local LLM loop
    let finalPrompt = parsed.content;

    // Inject @file / @dir contexts
    if (parsed.injectedContext && parsed.injectedContext.length > 0) {
      finalPrompt += '\n\n### Injected Context:';
      for (const item of parsed.injectedContext) {
        if (item.isDir) {
          finalPrompt += `\n\nStructure of directory "${item.path}":\n\`\`\`\n${item.content}\n\`\`\``;
        } else {
          finalPrompt += `\n\nContent of file "${item.path}":\n\`\`\`\n${item.content}\n\`\`\``;
        }
      }
      console.log(chalk.dim(`  📎 Context: ${parsed.injectedContext.map(i => i.path).join(', ')}`));
    }

    messages.push({ role: 'user', content: finalPrompt });

    // Track start time for duration display
    const startTime = Date.now();

    // Run the ReAct agent loop — stream directly to terminal
    console.log('');
    messages = await runAgentLoop(activeConfig, messages, memory, (chunk) => {
      // Stream tokens directly inline — no buffering, no double-print
      process.stdout.write(chunk);
    });

    // After streaming completes, render the final markdown block with left-border
    const assistantMsg = messages[messages.length - 1];
    if (assistantMsg && assistantMsg.role === 'assistant') {
      const markdownAnswer = assistantMsg.content.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim();

      if (markdownAnswer) {
        // Clear raw streamed text and reprint with formatting
        // Move cursor up and clear lines for the raw text, then print formatted
        const rawLineCount = markdownAnswer.split('\n').length + 1;
        for (let i = 0; i < rawLineCount; i++) {
          process.stdout.write('\x1b[A\x1b[2K');
        }

        // Print with left-border like Claude CLI
        process.stdout.write(renderAssistantBlock(markdownAnswer));
        console.log('');
      }
    }

    // Duration and token estimate (Claude CLI shows this)
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const lastAssistant = messages[messages.length - 1];
    const charCount = lastAssistant?.content?.length || 0;
    const tokenEstimate = Math.round(charCount / 4);
    console.log(chalk.dim(`  ${elapsed}s  •  ~${tokenEstimate} tokens\n`));

    // Auto-save session
    saveSession(activeConfig.sessionsDir, sessionId, messages);
  }
}
