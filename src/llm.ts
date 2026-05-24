import { Config } from './config.js';
import { ChatMessage } from './sessions.js';
import { executeTool, toolsList, ConfirmHook } from './tools.js';
import {
  AGENT_MAX_TURNS,
  TOOL_CALL_OPEN,
  TOOL_CALL_CLOSE,
  TOOL_RESULT_OPEN,
  TOOL_RESULT_CLOSE,
} from './constants.js';

export interface AgentHooks {
  /** Called for each assistant token that is NOT part of a tool call block. */
  onAssistantChunk?: (chunk: string) => void;
  /** Called once a tool call is parsed, before execution. */
  onToolStart?: (name: string, args: any) => void;
  /** Called with the tool result and success flag. */
  onToolResult?: (name: string, result: string, success: boolean) => void;
  /** Called if a tool call cannot be parsed. */
  onToolParseError?: (raw: string, error: Error) => void;
  /** Called if the LLM API itself fails. */
  onApiError?: (error: Error) => void;
  /** Called before each LLM request (e.g. to start a spinner). */
  onTurnStart?: (turn: number) => void;
  /** Called when the first token of a turn arrives (e.g. to stop a spinner). */
  onFirstToken?: () => void;
  /** Confirm tool execution; defaults to allow-all. */
  confirm?: ConfirmHook;
}

function buildSystemPrompt(workspaceDir: string, memory?: string): string {
  const toolsFormatted = toolsList.map(t =>
    `- Name: "${t.name}"\n  Description: ${t.description}\n  Parameters schema: ${JSON.stringify(t.parameters)}`
  ).join('\n\n');

  let prompt = `You are "Tadoe CLI", a powerful and intelligent terminal-based local AI agent.
You assist developers with programming tasks, repository navigation, file editing, and local shell execution.
The user's current workspace directory is: "${workspaceDir}"

You have access to the following local tools:
${toolsFormatted}

To call a tool, you MUST respond with a single tool call formatted exactly like this:
${TOOL_CALL_OPEN}
{
  "name": "tool_name",
  "arguments": {
    "arg1": "value1"
  }
}
${TOOL_CALL_CLOSE}

RULES:
1. ONLY call tools that are listed above.
2. When calling a tool, you MUST output ONLY the tool_call block and nothing else. Do not output conversational text before or after the tool call.
3. The environment will execute the tool and provide the results in the next turn as:
${TOOL_RESULT_OPEN}
[result content]
${TOOL_RESULT_CLOSE}
4. You can use multiple tools sequentially to complete a complex task.
5. Once you have completed all tasks or if you do not need tools, answer the user directly in standard markdown format.
6. Be concise and precise. Avoid excessive explanations.`;

  if (memory && memory.trim()) {
    prompt += `\n\n### User Memory (Persistent Context):\n${memory}`;
  }
  return prompt;
}

interface StreamChunk {
  choices: { delta?: { content?: string } }[];
}

export async function streamChatCompletion(
  config: Config,
  messages: ChatMessage[],
  onChunk: (chunk: string) => void,
): Promise<string> {
  const response = await fetch(`${config.apiUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: messages.map(m => ({ role: m.role, content: m.content, name: m.name })),
      stream: true,
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM API returned status ${response.status}: ${await response.text()}`);
  }
  if (!response.body) {
    throw new Error('LLM API returned empty response body.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let fullContent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === 'data: [DONE]') continue;
      if (!trimmed.startsWith('data: ')) continue;

      try {
        const json = JSON.parse(trimmed.slice(6)) as StreamChunk;
        const content = json.choices[0]?.delta?.content || '';
        if (content) {
          fullContent += content;
          onChunk(content);
        }
      } catch {
        // tolerate split chunks
      }
    }
  }

  return fullContent;
}

/**
 * Stateful filter: forwards streamed assistant text to `emit` while suppressing
 * any text from `<tool_call>` onward (including a partial tag at the buffer tail).
 */
function createToolCallFilter(emit: (text: string) => void) {
  let buffer = '';
  let printedTo = 0;
  let suppressing = false;

  return (chunk: string) => {
    buffer += chunk;
    if (suppressing) return;

    const idx = buffer.indexOf(TOOL_CALL_OPEN);
    if (idx !== -1) {
      if (idx > printedTo) emit(buffer.slice(printedTo, idx));
      printedTo = idx;
      suppressing = true;
      return;
    }

    // Hold back any partial prefix of TOOL_CALL_OPEN at the end of the buffer.
    let safeEnd = buffer.length;
    for (let i = TOOL_CALL_OPEN.length - 1; i > 0; i--) {
      if (buffer.endsWith(TOOL_CALL_OPEN.slice(0, i))) {
        safeEnd = buffer.length - i;
        break;
      }
    }
    if (safeEnd > printedTo) {
      emit(buffer.slice(printedTo, safeEnd));
      printedTo = safeEnd;
    }
  };
}

export async function runAgentLoop(
  config: Config,
  messages: ChatMessage[],
  memory: string,
  hooks: AgentHooks,
): Promise<ChatMessage[]> {
  const systemPrompt = buildSystemPrompt(process.cwd(), memory);
  const activeMessages = [...messages];
  const systemMsgIndex = activeMessages.findIndex(m => m.role === 'system');
  if (systemMsgIndex !== -1) {
    activeMessages[systemMsgIndex] = { role: 'system', content: systemPrompt };
  } else {
    activeMessages.unshift({ role: 'system', content: systemPrompt });
  }

  for (let turn = 1; turn <= AGENT_MAX_TURNS; turn++) {
    hooks.onTurnStart?.(turn);

    let fullResponse = '';
    let firstTokenSeen = false;
    const filter = createToolCallFilter(text => hooks.onAssistantChunk?.(text));

    try {
      await streamChatCompletion(config, activeMessages, chunk => {
        if (!firstTokenSeen) {
          firstTokenSeen = true;
          hooks.onFirstToken?.();
        }
        fullResponse += chunk;
        filter(chunk);
      });
    } catch (err) {
      hooks.onApiError?.(err as Error);
      break;
    }

    activeMessages.push({ role: 'assistant', content: fullResponse });

    const toolCallMatch = fullResponse.match(/<tool_call>([\s\S]*?)<\/tool_call>/);
    if (!toolCallMatch) break;

    const jsonStr = toolCallMatch[1].trim();
    let toolCall: { name: string; arguments: any };
    try {
      toolCall = JSON.parse(jsonStr);
    } catch (e) {
      hooks.onToolParseError?.(jsonStr, e as Error);
      activeMessages.push({
        role: 'user',
        content: `${TOOL_RESULT_OPEN}\nError: Failed to parse tool call JSON. Please use the exact schema and correct syntax.\n${TOOL_RESULT_CLOSE}`,
      });
      continue;
    }

    hooks.onToolStart?.(toolCall.name, toolCall.arguments);
    const toolResult = await executeTool(toolCall.name, toolCall.arguments, hooks.confirm);
    const success = !toolResult.startsWith('Error');
    hooks.onToolResult?.(toolCall.name, toolResult, success);

    activeMessages.push({
      role: 'user',
      content: `${TOOL_RESULT_OPEN}\n${toolResult}\n${TOOL_RESULT_CLOSE}`,
    });
  }

  return activeMessages;
}
