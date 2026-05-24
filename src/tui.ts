import prompts from 'prompts';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

import { Config, saveConfig, detectActiveModel } from './config.js';
import { printAsciiLogo } from './ascii.js';
import { parseInput } from './parser.js';
import { ChatMessage, saveSession, loadSession, listSessions, deleteSession } from './sessions.js';
import { runAgentLoop } from './llm.js';
import { toolsList } from './tools.js';

// Register markdown terminal renderer
marked.use(markedTerminal() as any);

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
  console.log(chalk.yellow(`⚙️  Running shell command: "${command}"\n`));
  return new Promise((resolve) => {
    exec(command, (err, stdout, stderr) => {
      if (stdout) {
        process.stdout.write(stdout);
      }
      if (stderr) {
        process.stderr.write(chalk.red(stderr));
      }
      if (err) {
        console.log(chalk.red(`\n❌ Command failed with exit code: ${(err as any).code}`));
      }
      console.log();
      resolve();
    });
  });
}

/**
 * Interactive REPL terminal session.
 */
export async function startInteractiveSession(config: Config, initialSessionId?: string) {
  printAsciiLogo();

  // Detect active model name
  const activeModel = await detectActiveModel(config);
  console.log(chalk.green(`🟢 Connected to LM Studio API: ${chalk.bold(config.apiUrl)}`));
  console.log(chalk.green(`🤖 Loaded Model: ${chalk.bold(activeModel)}`));
  console.log(chalk.gray(`💡 Type ${chalk.yellow('/help')} to see available commands or ${chalk.yellow('@filename')} to include context.`));
  console.log(chalk.gray(`💡 Type ${chalk.yellow('!command')} to run a shell command directly.\n`));

  // Merge the detected model back into the config so llm.ts uses it
  const activeConfig = { ...config, model: activeModel };

  let messages: ChatMessage[] = [];
  let sessionId = initialSessionId || `session_${Date.now()}`;

  if (initialSessionId) {
    try {
      messages = loadSession(activeConfig.sessionsDir, initialSessionId);
      console.log(chalk.cyan(`🔄 Resumed chat session: ${chalk.bold(initialSessionId)} (${messages.length} messages loaded)\n`));
    } catch (e) {
      console.log(chalk.red(`❌ Failed to resume session: ${(e as Error).message}. Starting new session.`));
      sessionId = `session_${Date.now()}`;
    }
  }

  // Load persistent memory
  let memory = loadMemory(activeConfig.memoryFile);

  while (true) {
    // Prompt the user for input
    const response = await prompts({
      type: 'text',
      name: 'input',
      message: chalk.magenta('Tadoe >'),
    });

    // If Ctrl+C or empty exit
    if (response.input === undefined) {
      console.log(chalk.yellow('\n👋 Saving session and exiting. Goodbye!'));
      saveSession(activeConfig.sessionsDir, sessionId, messages);
      break;
    }

    const input = response.input.trim();
    if (!input) continue;

    // Parse the input
    const parsed = await parseInput(input);

    if (parsed.type === 'shell') {
      // Direct shell escape e.g. !git status
      await runShellEscape(parsed.content);
      continue;
    }

    if (parsed.type === 'slash') {
      // Process Slash commands
      const cmd = parsed.commandName;
      const args = parsed.args || [];

      if (cmd === 'exit' || cmd === 'quit') {
        console.log(chalk.yellow('👋 Saving session and exiting. Goodbye!'));
        saveSession(activeConfig.sessionsDir, sessionId, messages);
        break;
      }

      if (cmd === 'clear') {
        console.clear();
        continue;
      }

      if (cmd === 'help') {
        console.log(chalk.cyan(`\n📚 ${chalk.bold('Tadoe CLI Commands:')}`));
        console.log(`  ${chalk.yellow('/help')}                   Show this help menu`);
        console.log(`  ${chalk.yellow('/clear')}                  Clear the console screen`);
        console.log(`  ${chalk.yellow('/tools')}                  List all available agentic tools`);
        console.log(`  ${chalk.yellow('/exit')} or ${chalk.yellow('/quit')}        Exit the interactive session`);
        console.log(`  ${chalk.yellow('/chat list')}             List all saved chat sessions`);
        console.log(`  ${chalk.yellow('/chat resume <name>')}    Resume a saved chat session`);
        console.log(`  ${chalk.yellow('/chat save <name>')}      Save current session as <name>`);
        console.log(`  ${chalk.yellow('/chat delete <name>')}    Delete a saved session`);
        console.log(`  ${chalk.yellow('/memory list')}           Show current persistent memories`);
        console.log(`  ${chalk.yellow('/memory add <text>')}     Add instructions to persistent memory`);
        console.log(`  ${chalk.yellow('/memory clear')}          Clear all persistent memory`);
        console.log();
        continue;
      }

      if (cmd === 'tools') {
        console.log(chalk.cyan(`\n🛠️  ${chalk.bold('Available Agent Tools:')}`));
        toolsList.forEach(t => {
          console.log(`  - ${chalk.yellow(t.name)}: ${t.description}`);
        });
        console.log();
        continue;
      }

      if (cmd === 'chat') {
        const sub = args[0]?.toLowerCase();
        const tag = args.slice(1).join('_').trim();

        if (sub === 'list') {
          const list = listSessions(activeConfig.sessionsDir);
          if (list.length === 0) {
            console.log(chalk.gray('No saved sessions found.'));
          } else {
            console.log(chalk.cyan(`\n📂 Saved Sessions:`));
            list.forEach(s => {
              console.log(`  - ${chalk.yellow(s.id)} (${s.messageCount} messages, last active: ${s.lastUpdated})`);
            });
            console.log();
          }
        } else if (sub === 'save') {
          if (!tag) {
            console.log(chalk.red('❌ Please provide a session tag. E.g. `/chat save feature_branch`'));
          } else {
            sessionId = tag;
            saveSession(activeConfig.sessionsDir, sessionId, messages);
            console.log(chalk.green(`✔️  Session saved as: ${chalk.bold(sessionId)}\n`));
          }
        } else if (sub === 'resume') {
          if (!tag) {
            console.log(chalk.red('❌ Please provide a session tag. E.g. `/chat resume feature_branch`'));
          } else {
            try {
              messages = loadSession(activeConfig.sessionsDir, tag);
              sessionId = tag;
              console.log(chalk.green(`🔄 Resumed chat session: ${chalk.bold(sessionId)} (${messages.length} messages loaded)\n`));
            } catch (e) {
              console.log(chalk.red(`❌ ${(e as Error).message}`));
            }
          }
        } else if (sub === 'delete') {
          if (!tag) {
            console.log(chalk.red('❌ Please provide a session tag. E.g. `/chat delete old_chat`'));
          } else {
            deleteSession(activeConfig.sessionsDir, tag);
            console.log(chalk.green(`✔️  Session ${chalk.bold(tag)} deleted.`));
          }
        } else {
          console.log(chalk.red('❌ Invalid `/chat` command. Use: `/chat [list|save|resume|delete]`'));
        }
        continue;
      }

      if (cmd === 'memory') {
        const sub = args[0]?.toLowerCase();
        const text = args.slice(1).join(' ').trim();

        if (sub === 'list') {
          if (!memory.trim()) {
            console.log(chalk.gray('Memory is currently empty.'));
          } else {
            console.log(chalk.cyan(`\n🧠 Persistent Memory:\n`));
            console.log(chalk.italic(memory));
            console.log();
          }
        } else if (sub === 'add') {
          if (!text) {
            console.log(chalk.red('❌ Please specify text to add to memory. E.g. `/memory add prefer ESM imports`'));
          } else {
            memory = memory ? `${memory}\n${text}` : text;
            saveMemory(activeConfig.configFile.replace('config.json', 'memory.json'), memory);
            console.log(chalk.green(`🧠 Memory updated.`));
          }
        } else if (sub === 'clear') {
          memory = '';
          saveMemory(activeConfig.configFile.replace('config.json', 'memory.json'), memory);
          console.log(chalk.green('🧠 Memory cleared.'));
        } else {
          console.log(chalk.red('❌ Invalid `/memory` command. Use: `/memory [list|add|clear]`'));
        }
        continue;
      }

      console.log(chalk.red(`❌ Unknown command: /${cmd}. Type /help for assistance.`));
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
      console.log(chalk.blue(`📎 Injected context from: ${parsed.injectedContext.map(i => i.path).join(', ')}`));
    }

    messages.push({ role: 'user', content: finalPrompt });

    // Output formatting setup
    process.stdout.write(chalk.magenta('\nTadoe: '));
    let assistantResponse = '';

    // Run the ReAct agent loop
    messages = await runAgentLoop(activeConfig, messages, memory, (chunk) => {
      // Accumulate raw typing text for later rendering
      assistantResponse += chunk;
    });

    const assistantMsg = messages[messages.length - 1];
    if (assistantMsg && assistantMsg.role === 'assistant') {
      const markdownAnswer = assistantMsg.content.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim();
      
      // Reprint beautifully rendered markdown to replace raw typing stream
      if (markdownAnswer) {
        console.log('\n' + chalk.gray('━'.repeat(50)));
        try {
          process.stdout.write(await marked.parse(markdownAnswer));
        } catch (e) {
          process.stdout.write(markdownAnswer);
        }
        console.log(chalk.gray('━'.repeat(50)) + '\n');
      }
    }

    // Auto-save session periodically
    saveSession(activeConfig.sessionsDir, sessionId, messages);
  }
}
