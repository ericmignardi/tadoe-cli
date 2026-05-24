import chalk from 'chalk';
import { Config } from './config.js';
import { ChatMessage, saveSession, loadSession, listSessions, deleteSession } from './sessions.js';
import { toolsList } from './tools.js';
import { saveMemory } from './memory.js';

export interface CommandContext {
  config: Config;
  args: string[];
  /** Mutable session state owned by the REPL. */
  state: {
    messages: ChatMessage[];
    sessionId: string;
    memory: string;
  };
}

export interface CommandResult {
  /** If true, the REPL should exit after this command. */
  exit?: boolean;
  /** If true, the REPL should clear the screen. */
  clear?: boolean;
}

export type CommandHandler = (ctx: CommandContext) => CommandResult | void;

function printHelp() {
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
}

function printTools() {
  console.log('');
  console.log(chalk.bold('  Available Tools:'));
  console.log(chalk.dim('  ─────────────────────────────────────────'));
  toolsList.forEach(t => {
    const tag = t.requiresConfirmation ? chalk.yellow(' (requires approval)') : '';
    console.log(`  ${chalk.cyan(t.name)}${tag}`);
    console.log(chalk.dim(`    ${t.description}`));
  });
  console.log('');
}

const chat: CommandHandler = ({ config, args, state }) => {
  const sub = args[0]?.toLowerCase();
  const tag = args.slice(1).join('_').trim();

  switch (sub) {
    case 'list': {
      const list = listSessions(config.sessionsDir);
      if (list.length === 0) {
        console.log(chalk.dim('\n  No saved sessions.\n'));
        return;
      }
      console.log('');
      console.log(chalk.bold('  Saved Sessions:'));
      list.forEach(s => {
        console.log(chalk.dim(`  • ${chalk.white(s.id)} — ${s.messageCount} messages — ${s.lastUpdated}`));
      });
      console.log('');
      return;
    }
    case 'save': {
      if (!tag) return void console.log(chalk.red('  Usage: /chat save <name>'));
      state.sessionId = tag;
      saveSession(config.sessionsDir, state.sessionId, state.messages);
      console.log(chalk.green(`  ✓ Session saved: ${state.sessionId}\n`));
      return;
    }
    case 'resume': {
      if (!tag) return void console.log(chalk.red('  Usage: /chat resume <name>'));
      try {
        state.messages = loadSession(config.sessionsDir, tag);
        state.sessionId = tag;
        console.log(chalk.green(`  ✓ Resumed: ${state.sessionId} (${state.messages.length} messages)\n`));
      } catch (e) {
        console.log(chalk.red(`  ${(e as Error).message}`));
      }
      return;
    }
    case 'delete': {
      if (!tag) return void console.log(chalk.red('  Usage: /chat delete <name>'));
      deleteSession(config.sessionsDir, tag);
      console.log(chalk.green(`  ✓ Deleted: ${tag}`));
      return;
    }
    default:
      console.log(chalk.red('  Usage: /chat [list|save|resume|delete]'));
  }
};

const memory: CommandHandler = ({ config, args, state }) => {
  const sub = args[0]?.toLowerCase();
  const text = args.slice(1).join(' ').trim();

  switch (sub) {
    case 'list': {
      if (!state.memory.trim()) {
        console.log(chalk.dim('\n  No memories stored.\n'));
        return;
      }
      console.log('');
      console.log(chalk.bold('  Memories:'));
      state.memory.split('\n').forEach(line => console.log(chalk.dim(`  • ${line}`)));
      console.log('');
      return;
    }
    case 'add': {
      if (!text) return void console.log(chalk.red('  Usage: /memory add <text>'));
      state.memory = state.memory ? `${state.memory}\n${text}` : text;
      saveMemory(config.memoryFile, state.memory);
      console.log(chalk.green('  ✓ Memory updated.'));
      return;
    }
    case 'clear': {
      state.memory = '';
      saveMemory(config.memoryFile, state.memory);
      console.log(chalk.green('  ✓ Memory cleared.'));
      return;
    }
    default:
      console.log(chalk.red('  Usage: /memory [list|add|clear]'));
  }
};

export const commandHandlers: Record<string, CommandHandler> = {
  help: () => printHelp(),
  tools: () => printTools(),
  clear: () => ({ clear: true }),
  exit: () => ({ exit: true }),
  quit: () => ({ exit: true }),
  chat,
  memory,
};
