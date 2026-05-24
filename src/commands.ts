import chalk from 'chalk';
import prompts from 'prompts';
import { Config } from './config.js';
import { ChatMessage, saveSession, loadSession, listSessions, deleteSession } from './sessions.js';
import { toolsList } from './tools.js';
import { saveMemory } from './memory.js';
import { keychainAvailable, keychainSet, keychainDelete } from './keychain.js';

export interface CommandContext {
  config: Config;
  args: string[];
  /** Mutable session state owned by the REPL. */
  state: {
    messages: ChatMessage[];
    sessionId: string;
    persistedCount: number;
    memory: string;
  };
}

export interface CommandResult {
  /** If true, the REPL should exit after this command. */
  exit?: boolean;
  /** If true, the REPL should clear the screen. */
  clear?: boolean;
}

export type CommandHandler = (ctx: CommandContext) => Promise<CommandResult | void> | CommandResult | void;

function printHelp() {
  console.log('');
  console.log(chalk.bold('  Commands:'));
  console.log(chalk.dim('  ─────────────────────────────────────────'));
  console.log(`  ${chalk.yellow('/help')}                   Show this menu`);
  console.log(`  ${chalk.yellow('/clear')}                  Clear screen`);
  console.log(`  ${chalk.yellow('/tools')}                  List agent tools`);
  console.log(`  ${chalk.yellow('/login')}                  Store API key in OS keychain`);
  console.log(`  ${chalk.yellow('/logout')}                 Remove API key from OS keychain`);
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
  console.log(`  ${chalk.yellow('trailing \\\\')}              Continue on next line`);
  console.log(`  ${chalk.yellow('↑ / ↓')}                   Recall history`);
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

const chat: CommandHandler = async ({ config, args, state }) => {
  const sub = args[0]?.toLowerCase();
  const tag = args.slice(1).join('_').trim();

  switch (sub) {
    case 'list': {
      const list = await listSessions(config.sessionsDir);
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
      if (!tag) {
        console.log(chalk.red('  Usage: /chat save <name>'));
        return;
      }
      state.sessionId = tag;
      await saveSession(config.sessionsDir, state.sessionId, state.messages);
      state.persistedCount = state.messages.length;
      console.log(chalk.green(`  ✓ Session saved: ${state.sessionId}\n`));
      return;
    }
    case 'resume': {
      if (!tag) {
        console.log(chalk.red('  Usage: /chat resume <name>'));
        return;
      }
      try {
        state.messages = await loadSession(config.sessionsDir, tag);
        state.sessionId = tag;
        state.persistedCount = state.messages.length;
        console.log(chalk.green(`  ✓ Resumed: ${state.sessionId} (${state.messages.length} messages)\n`));
      } catch (e) {
        console.log(chalk.red(`  ${(e as Error).message}`));
      }
      return;
    }
    case 'delete': {
      if (!tag) {
        console.log(chalk.red('  Usage: /chat delete <name>'));
        return;
      }
      await deleteSession(config.sessionsDir, tag);
      console.log(chalk.green(`  ✓ Deleted: ${tag}`));
      return;
    }
    default:
      console.log(chalk.red('  Usage: /chat [list|save|resume|delete]'));
  }
};

const memory: CommandHandler = async ({ config, args, state }) => {
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
      if (!text) {
        console.log(chalk.red('  Usage: /memory add <text>'));
        return;
      }
      state.memory = state.memory ? `${state.memory}\n${text}` : text;
      await saveMemory(config.memoryFile, state.memory);
      console.log(chalk.green('  ✓ Memory updated.'));
      return;
    }
    case 'clear': {
      state.memory = '';
      await saveMemory(config.memoryFile, state.memory);
      console.log(chalk.green('  ✓ Memory cleared.'));
      return;
    }
    default:
      console.log(chalk.red('  Usage: /memory [list|add|clear]'));
  }
};

const login: CommandHandler = async () => {
  if (!(await keychainAvailable())) {
    console.log(chalk.red('  OS keychain is unavailable on this system.'));
    console.log(chalk.dim('  Falling back: set TADOE_API_KEY in your environment instead.'));
    return;
  }
  const { value } = await prompts({
    type: 'password',
    name: 'value',
    message: 'Enter API key (stored securely in OS keychain)',
  });
  if (!value) {
    console.log(chalk.dim('  Cancelled.'));
    return;
  }
  const result = await keychainSet(value);
  if (result.ok) {
    console.log(chalk.green('  ✓ API key saved to OS keychain. Restart Tadoe to use it.\n'));
  } else {
    console.log(chalk.red(`  Failed to save: ${result.error}`));
  }
};

const logout: CommandHandler = async () => {
  if (!(await keychainAvailable())) {
    console.log(chalk.dim('  OS keychain is unavailable on this system; nothing to remove.'));
    return;
  }
  const result = await keychainDelete();
  if (result.ok) {
    console.log(chalk.green('  ✓ API key removed from OS keychain. Restart Tadoe to apply.\n'));
  } else {
    console.log(chalk.red(`  Failed to remove: ${result.error}`));
  }
};

export const commandHandlers: Record<string, CommandHandler> = {
  help: () => printHelp(),
  tools: () => printTools(),
  clear: () => ({ clear: true }),
  exit: () => ({ exit: true }),
  quit: () => ({ exit: true }),
  login,
  logout,
  chat,
  memory,
};
