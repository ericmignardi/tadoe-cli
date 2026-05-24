# Tadoe CLI

A fully-featured, local-model-powered terminal AI agent — a clone of Claude CLI and Gemini CLI designed to decouple developers from paid AI providers.

Tadoe CLI connects to **LM Studio** (or any OpenAI-compatible local API) and provides an interactive, agentic coding assistant directly in your terminal with streaming responses, tool execution, session management, and safe-mode file protections.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)
![License](https://img.shields.io/badge/License-ISC-lightgrey)

---

## Features

- **Interactive REPL** — Rich terminal session with streaming markdown rendering and a clean `>` prompt
- **Local Model Integration** — Connects to LM Studio, Ollama, or any OpenAI-compatible local endpoint
- **Auto Model Detection** — Automatically discovers the currently loaded model from your local server
- **Agentic Tool Calling** — ReAct loop enabling the model to read files, write code, list directories, and execute shell commands
- **Safe Mode** — Requires explicit `Y/n` approval before file writes or command execution
- **Slash Commands** — `/help`, `/quit`, `/clear`, `/tools`, `/chat`, `/memory`
- **File Context Injection** — Use `@filename` in prompts to inject file contents into the conversation
- **Directory Tree Injection** — Use `@src/` to inject a directory structure summary
- **Shell Escape** — Prefix with `!` to run terminal commands inline (e.g. `!git status`)
- **Session Management** — Auto-save, manual save/resume/delete conversation histories
- **Persistent Memory** — Store instructions that carry across all sessions
- **Non-Interactive Mode** — Pipe data or use `-p` for scripted one-shot queries
- **Claude CLI-Style Rendering** — Left-border response framing, compact tool boxes, token stats, and inline streaming

---

## Prerequisites

- **Node.js 18+** — [Download](https://nodejs.org/)
- **LM Studio** (recommended) — [Download](https://lmstudio.ai/)
  - Or any OpenAI-compatible local server (Ollama, llama.cpp, etc.)

---

## Installation

```bash
# Clone the repository
git clone https://github.com/ericmignardi/tadoe-cli.git
cd tadoe-cli

# Install dependencies
npm install

# Build the TypeScript source
npm run build

# Link the binary globally
npm link
```

After linking, the `tadoe` command is available system-wide from any directory.

---

## Quick Start

### 1. Start your local model server

Open **LM Studio**, load a model (e.g. Qwen 2.5 Coder, Llama 3), navigate to the **Local Server** tab, and click **Start Server**. The default port is `1234`.

### 2. Launch Tadoe CLI

```bash
tadoe
```

You'll see the Tadoe logo, your connected model, and a `>` prompt ready for input.

### 3. Ask a question

```
> Explain the difference between let and const in JavaScript
```

---

## Usage

### Interactive Mode

```bash
tadoe
```

### Single Prompt (Non-Interactive)

```bash
tadoe -p "What does this function do?"
```

### Pipe Input

```bash
cat src/index.ts | tadoe -p "Review this code for bugs"
```

### CLI Options

| Flag | Description |
|---|---|
| `-p, --prompt <text>` | Send a single prompt and exit |
| `-m, --model <name>` | Override the model name |
| `--api-url <url>` | Override the API endpoint |
| `--no-safe` | Disable safe mode confirmations |
| `--list-sessions` | List saved chat sessions |
| `--resume <id>` | Resume a saved session |
| `-V, --version` | Print version |
| `-h, --help` | Show help |

---

## Interactive Commands

### Slash Commands

| Command | Description |
|---|---|
| `/help` | Show all commands |
| `/quit` or `/exit` | Save session and exit |
| `/clear` | Clear the terminal |
| `/tools` | List available agent tools |
| `/chat list` | List saved sessions |
| `/chat save <name>` | Save current session |
| `/chat resume <name>` | Resume a session |
| `/chat delete <name>` | Delete a session |
| `/memory list` | Show persistent memories |
| `/memory add <text>` | Add to persistent memory |
| `/memory clear` | Clear all memories |

### Input Shortcuts

| Shortcut | Description |
|---|---|
| `@file.ts` | Inject file contents into prompt |
| `@src/` | Inject directory tree into prompt |
| `!git status` | Execute a shell command inline |
| `quit` or `exit` | Exit without the `/` prefix |

---

## Agent Tools

Tadoe CLI includes four built-in tools the model can invoke autonomously:

| Tool | Description | Requires Approval |
|---|---|---|
| `read_file` | Read contents of a local file | No |
| `write_file` | Write or overwrite a file | **Yes** |
| `list_dir` | List directory contents | No |
| `run_command` | Execute a shell command | **Yes** |

Tools marked with approval require explicit user confirmation when **Safe Mode** is enabled (default).

---

## Configuration

Tadoe CLI stores its configuration in `~/.tadoe/`:

```
~/.tadoe/
├── config.json      # User settings
├── memory.json      # Persistent memory
└── sessions/        # Saved conversation histories
    ├── session_1716556800000.json
    └── my_project.json
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `TADOE_API_URL` | `http://127.0.0.1:1234/v1` | Local API endpoint |
| `TADOE_API_KEY` | `lm-studio` | API key (if required) |
| `TADOE_MODEL` | `auto` | Model name or `auto` to detect |
| `TADOE_SAFE_MODE` | `true` | Enable/disable safe mode |

You can also create a `.env` file in your project directory.

---

## Project Structure

```
tadoe-cli/
├── bin/
│   └── tadoe.js          # Executable entry point
├── src/
│   ├── index.ts          # CLI bootstrap
│   ├── cli.ts            # Argument parsing (commander)
│   ├── config.ts         # Configuration & model detection
│   ├── ascii.ts          # Tadoe ASCII logo
│   ├── tui.ts            # Interactive REPL & rendering
│   ├── llm.ts            # LLM streaming & ReAct agent loop
│   ├── tools.ts          # File system & shell tools
│   ├── parser.ts         # Input parsing (@, /, !)
│   └── sessions.ts       # Session persistence
├── package.json
└── tsconfig.json
```

---

## Development

```bash
# Watch mode for development
npm run watch

# Build for production
npm run build
```

---

## License

ISC
