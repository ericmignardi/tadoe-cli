import { Command } from 'commander';
import chalk from 'chalk';

import { loadConfig, detectActiveModel } from './config.js';
import { listSessions, ChatMessage } from './sessions.js';
import { startInteractiveSession, loadMemory } from './tui.js';
import { runAgentLoop } from './llm.js';

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }

    let data = '';
    process.stdin.setEncoding('utf-8');
    
    // Set a timeout to prevent hanging if stdin is not TTY but also empty
    const timeout = setTimeout(() => {
      resolve(data);
    }, 1000);

    process.stdin.on('data', (chunk) => {
      data += chunk;
    });

    process.stdin.on('end', () => {
      clearTimeout(timeout);
      resolve(data);
    });
  });
}

export async function runCli() {
  const program = new Command();
  
  program
    .name('tadoe')
    .description('Tadoe CLI: A local-model-powered Gemini/Claude CLI clone')
    .version('1.0.0')
    .option('-p, --prompt <prompt>', 'Send a single prompt and exit (non-interactive mode)')
    .option('-m, --model <model>', 'Specify the local model to run')
    .option('--api-url <url>', 'Override the local API server URL')
    .option('--no-safe', 'Disable Tadoe Safe Mode (runs file writes/commands without confirmation)')
    .option('--list-sessions', 'List all saved chat sessions')
    .option('--resume <session_id>', 'Resume a saved chat session by ID');

  program.parse(process.argv);
  const options = program.opts();

  // Load configuration and merge flags
  const config = loadConfig();
  if (options.model) config.model = options.model;
  if (options.apiUrl) config.apiUrl = options.apiUrl;
  if (options.safe === false) config.safeMode = false;

  // 1. Handle --list-sessions
  if (options['list-sessions'] || options.listSessions) {
    const list = listSessions(config.sessionsDir);
    if (list.length === 0) {
      console.log(chalk.gray('No saved sessions found.'));
    } else {
      console.log(chalk.cyan(`\n📂 Saved Sessions:`));
      list.forEach(s => {
        console.log(`  - ${chalk.yellow(s.id)} (${s.messageCount} messages, last active: ${s.lastUpdated})`);
      });
      console.log();
    }
    return;
  }

  // 2. Handle Piped stdin
  const stdinData = await readStdin();

  // 3. Handle Single Prompt Mode (Non-interactive)
  if (options.prompt || stdinData) {
    // If the model is 'auto', detect it
    const activeModel = await detectActiveModel(config);
    const activeConfig = { ...config, model: activeModel };

    let promptContent = options.prompt || '';
    if (stdinData) {
      promptContent = promptContent 
        ? `${promptContent}\n\n### Piped Input:\n${stdinData}`
        : stdinData;
    }

    const messages: ChatMessage[] = [
      { role: 'user', content: promptContent }
    ];

    const memory = loadMemory(activeConfig.memoryFile);

    // Stream the final response directly to stdout
    await runAgentLoop(activeConfig, messages, memory, (chunk) => {
      // Direct streaming output for script piping
      process.stdout.write(chunk);
    });

    console.log(); // Newline at the end
    return;
  }

  // 4. Fallback: Start interactive TUI session
  await startInteractiveSession(config, options.resume);
}
