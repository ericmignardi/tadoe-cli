# Product Requirements Document — Tadoe CLI

## Overview

**Tadoe CLI** is a local-model-powered terminal AI agent designed to replace paid cloud-based coding assistants (Claude CLI, Gemini CLI) with a fully self-hosted alternative. It connects to locally running LLM servers and provides an identical developer experience — interactive chat, agentic tool execution, file context injection, and session management — without any external API dependencies or subscription costs.

---

## Problem Statement

Modern AI-powered terminal agents like Claude Code and Gemini CLI require cloud API keys tied to paid subscription plans. For developers who:

- Want to keep their code and prompts entirely local for privacy reasons
- Cannot justify recurring API costs for personal or hobby projects
- Prefer open-weight models they can run on their own hardware
- Want full control over the model, context, and execution environment

…there is no turnkey solution that replicates the full CLI agent experience using local models.

---

## Goals

1. **Feature parity with Claude CLI / Gemini CLI** — Provide the same interactive terminal experience including streaming responses, slash commands, file injection, tool calling, and session persistence.
2. **Zero cloud dependency** — All inference happens locally via LM Studio, Ollama, or any OpenAI-compatible local server.
3. **Drop-in replacement** — A developer familiar with Claude CLI or Gemini CLI should feel immediately at home.
4. **Safe by default** — No file writes or command execution without explicit user approval.

---

## Target Users

| Persona | Need |
|---|---|
| **Solo developer** | AI coding assistance without API costs |
| **Privacy-conscious engineer** | Code never leaves the local machine |
| **Open-source enthusiast** | Run open-weight models (Llama, Qwen, Mistral) on own hardware |
| **Hobbyist / student** | Free, unlimited AI terminal agent for learning |

---

## Functional Requirements

### FR-1: Interactive REPL

- **FR-1.1**: Launch an interactive terminal session with a clean `>` prompt.
- **FR-1.2**: Accept multi-line natural language input.
- **FR-1.3**: Stream model responses token-by-token with live display.
- **FR-1.4**: Render final responses as formatted terminal markdown with a left-border visual frame.
- **FR-1.5**: Display elapsed time and approximate token count after each response.

### FR-2: Local Model Integration

- **FR-2.1**: Connect to any OpenAI-compatible local API endpoint (default: `http://127.0.0.1:1234/v1`).
- **FR-2.2**: Auto-detect the currently loaded model from the `/v1/models` endpoint.
- **FR-2.3**: Allow model override via CLI flag (`-m`) or environment variable (`TADOE_MODEL`).
- **FR-2.4**: Support streaming (`stream: true`) via Server-Sent Events (SSE).

### FR-3: Agentic Tool Calling

- **FR-3.1**: Instruct the local model via system prompt to emit structured `<tool_call>` XML tags.
- **FR-3.2**: Parse tool calls from the streamed response without displaying raw tags to the user.
- **FR-3.3**: Execute tools and return results to the model for multi-turn reasoning (ReAct loop).
- **FR-3.4**: Support up to 10 sequential tool calls per user prompt.
- **FR-3.5**: Implemented tools:

| Tool | Description | Modifying |
|---|---|---|
| `read_file` | Read a file's contents | No |
| `write_file` | Create or overwrite a file | Yes |
| `list_dir` | List directory contents | No |
| `run_command` | Execute a shell command | Yes |

### FR-4: Safe Mode

- **FR-4.1**: Enabled by default.
- **FR-4.2**: Intercept all modifying tool calls (`write_file`, `run_command`) and prompt the user for `Y/n` approval before execution.
- **FR-4.3**: Display a preview of the action (file path, command string, content snippet) in the approval prompt.
- **FR-4.4**: Allow disabling via `--no-safe` flag or `TADOE_SAFE_MODE=false`.

### FR-5: Input Parsing

- **FR-5.1**: Detect slash commands (`/help`, `/quit`, `/clear`, `/tools`, `/chat`, `/memory`).
- **FR-5.2**: Detect file references (`@path/to/file`) and inject file contents into the prompt context.
- **FR-5.3**: Detect directory references (`@path/to/dir/`) and inject a recursive tree summary.
- **FR-5.4**: Detect shell escapes (`!command`) and execute them immediately, displaying output inline.

### FR-6: Session Management

- **FR-6.1**: Auto-save conversation history after every exchange to `~/.tadoe/sessions/`.
- **FR-6.2**: Support manual save with custom tags (`/chat save <name>`).
- **FR-6.3**: List all saved sessions (`/chat list`).
- **FR-6.4**: Resume a previous session (`/chat resume <name>` or `--resume <id>`).
- **FR-6.5**: Delete sessions (`/chat delete <name>`).

### FR-7: Persistent Memory

- **FR-7.1**: Store user-defined instructions in `~/.tadoe/memory.json`.
- **FR-7.2**: Inject stored memories into the system prompt for every conversation.
- **FR-7.3**: Manage via `/memory add`, `/memory list`, `/memory clear`.

### FR-8: Non-Interactive Mode

- **FR-8.1**: Accept a single prompt via `-p` flag and exit after response.
- **FR-8.2**: Accept piped stdin input (e.g. `cat file.ts | tadoe -p "review this"`).
- **FR-8.3**: Stream output directly to stdout for script integration.

### FR-9: Configuration

- **FR-9.1**: Load settings from environment variables, `.env` files, and `~/.tadoe/config.json`.
- **FR-9.2**: Priority order: CLI flags > environment variables > config file > defaults.
- **FR-9.3**: Configurable values: `apiUrl`, `apiKey`, `model`, `safeMode`.

---

## Non-Functional Requirements

### NFR-1: Performance

- Streaming latency should be limited only by the local model's inference speed — no artificial buffering.
- File reads capped at 100KB to prevent context overflow.
- Shell command execution timeout of 60 seconds.

### NFR-2: Compatibility

- Node.js 18+ required.
- Tested on Windows (PowerShell, CMD). Should work on macOS and Linux terminals.
- Compatible with LM Studio, Ollama, llama.cpp server, and any OpenAI-compatible local API.

### NFR-3: Security

- No data leaves the local machine.
- No telemetry, analytics, or external network calls (except to `127.0.0.1`).
- Safe mode prevents accidental file mutations.

### NFR-4: Usability

- CLI behavior and visual style modeled after Claude CLI for familiarity.
- Compact startup banner with model/connection status.
- Inline help accessible via `/help` at any time.
- Graceful error handling with actionable troubleshooting steps.

---

## Technical Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     User Terminal                        │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Input Parser (parser.ts)                         │  │
│  │  Detects: / commands  |  @files  |  !shell  |  text │
│  └──────────┬────────────┬──────────┬────────────────┘  │
│             │            │          │                    │
│     Slash Handler    File Reader  Shell Exec             │
│     (tui.ts)         (fs)        (child_process)         │
│             │                                            │
│  ┌──────────▼────────────────────────────────────────┐  │
│  │  Agent Loop (llm.ts)                              │  │
│  │  System Prompt → Stream API → Parse Tool Calls    │  │
│  │  → Execute Tools → Feed Results → Repeat          │  │
│  └──────────┬────────────────────────────────────────┘  │
│             │                                            │
│  ┌──────────▼────────────────────────────────────────┐  │
│  │  LM Studio / Local API (127.0.0.1:1234)           │  │
│  │  POST /v1/chat/completions (SSE stream)           │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## Technology Stack

| Layer | Technology |
|---|---|
| Language | TypeScript (ES2022, ESM) |
| Runtime | Node.js 18+ |
| CLI Framework | Commander.js |
| Terminal Styling | Chalk 5.x |
| Markdown Rendering | marked + marked-terminal |
| User Input | Node.js readline |
| Spinners | ora |
| Config | dotenv + JSON config files |

---

## Milestones

| Phase | Scope | Status |
|---|---|---|
| **v1.0** | Core REPL, streaming, tools, sessions, safe mode | ✅ Complete |
| **v1.1** | Claude CLI-style rendering overhaul | ✅ Complete |
| **v2.0** | MCP protocol support, multi-agent orchestration | Planned |
| **v2.1** | Plugin/extension system | Planned |
| **v3.0** | Fullscreen TUI mode (Ink-based React terminal) | Planned |

---

## Success Metrics

1. A developer can install Tadoe CLI and have a working local AI terminal agent in under 5 minutes.
2. All core Claude CLI workflows (chat, tool use, file context, sessions) are replicated.
3. Zero external API calls — all inference is local.
4. Safe mode prevents any unintended file or system modifications.
