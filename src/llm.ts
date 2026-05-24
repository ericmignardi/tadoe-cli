import { Config } from './config.js';
import { ChatMessage } from './sessions.js';
import { executeTool, toolsList } from './tools.js';
import chalk from 'chalk';
import ora from 'ora';

/**
 * Builds the base system prompt containing tool documentation and rules.
 */
function getSystemPrompt(workspaceDir: string, memory?: string): string {
  const toolsFormatted = toolsList.map(t => {
    return `- Name: "${t.name}"
  Description: ${t.description}
  Parameters schema: ${JSON.stringify(t.parameters)}`;
  }).join('\n\n');

  let prompt = `You are "Tadoe CLI", a powerful and intelligent terminal-based local AI agent.
You assist developers with programming tasks, repository navigation, file editing, and local shell execution.
The user's current workspace directory is: "${workspaceDir}"

You have access to the following local tools:
${toolsFormatted}

To call a tool, you MUST respond with a single tool call formatted exactly like this:
<tool_call>
{
  "name": "tool_name",
  "arguments": {
    "arg1": "value1"
  }
}
</tool_call>

RULES:
1. ONLY call tools that are listed above.
2. When calling a tool, you MUST output ONLY the <tool_call> block and nothing else. Do not output conversational text before or after the tool call.
3. The environment will execute the tool and provide the results in the next turn as:
<tool_result>
[result content]
</tool_result>
4. You can use multiple tools sequentially to complete a complex task.
5. Once you have completed all tasks or if you do not need tools, answer the user directly in standard markdown format.
6. Be concise and precise. Avoid excessive explanations.`;

  if (memory && memory.trim()) {
    prompt += `\n\n### User Memory (Persistent Context):\n${memory}`;
  }

  return prompt;
}

/**
 * Streams chat completions from the OpenAI-compatible API.
 */
export async function streamChatCompletion(
  config: Config,
  messages: ChatMessage[],
  onChunk: (chunk: string) => void
): Promise<string> {
  const response = await fetch(`${config.apiUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: messages.map(m => ({ role: m.role, content: m.content, name: m.name })),
      stream: true,
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API returned status ${response.status}: ${errorText}`);
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
      if (!trimmed) continue;
      if (trimmed === 'data: [DONE]') continue;
      if (trimmed.startsWith('data: ')) {
        try {
          const json = JSON.parse(trimmed.slice(6));
          const choice = json.choices[0];
          const content = choice.delta?.content || '';
          if (content) {
            fullContent += content;
            onChunk(content);
          }
        } catch (e) {
          // Ignore parse errors for split chunks
        }
      }
    }
  }

  return fullContent;
}

/**
 * Runs the agentic ReAct loop.
 * Continues calling the LLM and executing tools until a final conversational response is reached.
 */
export async function runAgentLoop(
  config: Config,
  messages: ChatMessage[],
  memory: string,
  onUserOutput: (text: string) => void
): Promise<ChatMessage[]> {
  const workspaceDir = process.cwd();
  const systemPrompt = getSystemPrompt(workspaceDir, memory);

  // Set or update system message at index 0
  const activeMessages = [...messages];
  const systemMsgIndex = activeMessages.findIndex(m => m.role === 'system');
  if (systemMsgIndex !== -1) {
    activeMessages[systemMsgIndex] = { role: 'system', content: systemPrompt };
  } else {
    activeMessages.unshift({ role: 'system', content: systemPrompt });
  }

  const MAX_TURNS = 10;
  let turn = 0;

  while (turn < MAX_TURNS) {
    turn++;
    let fullResponse = '';
    let lastPrintedIndex = 0;

    // Helper to print streamed chunks without leaking the <tool_call> tags
    const handleChunk = (chunk: string) => {
      fullResponse += chunk;
      
      const toolCallIndex = fullResponse.indexOf('<tool_call>');
      if (toolCallIndex === -1) {
        // Look for partial prefix of "<tool_call>" at the end of the text
        let cutIndex = fullResponse.length;
        const tag = '<tool_call>';
        for (let i = tag.length - 1; i > 0; i--) {
          const sub = tag.slice(0, i);
          if (fullResponse.endsWith(sub)) {
            cutIndex = fullResponse.length - i;
            break;
          }
        }
        
        if (cutIndex > lastPrintedIndex) {
          const toPrint = fullResponse.slice(lastPrintedIndex, cutIndex);
          onUserOutput(toPrint);
          lastPrintedIndex += toPrint.length;
        }
      } else {
        // Tool call starts. Print everything up to its start
        if (toolCallIndex > lastPrintedIndex) {
          const toPrint = fullResponse.slice(lastPrintedIndex, toolCallIndex);
          onUserOutput(toPrint);
          lastPrintedIndex += toPrint.length;
        }
      }
    };

    // Spin up loading indicator if the model is thinking
    const spinner = ora({ text: 'Thinking...', color: 'magenta' }).start();

    try {
      await streamChatCompletion(config, activeMessages, (chunk) => {
        if (spinner.isSpinning) {
          spinner.stop();
        }
        handleChunk(chunk);
      });
      if (spinner.isSpinning) {
        spinner.stop();
      }
    } catch (err) {
      if (spinner.isSpinning) {
        spinner.stop();
      }
      console.log(chalk.red(`\n❌ Error communicating with LLM API: ${(err as Error).message}`));
      break;
    }

    // Append assistant's answer
    activeMessages.push({ role: 'assistant', content: fullResponse });

    // Detect if there is a tool call
    const toolCallMatch = fullResponse.match(/<tool_call>([\s\S]*?)<\/tool_call>/);
    if (!toolCallMatch) {
      // No tool calls, loop ends. This is the final message.
      break;
    }

    // Extract tool call
    const jsonStr = toolCallMatch[1].trim();
    let toolCall: { name: string; arguments: any };

    try {
      toolCall = JSON.parse(jsonStr);
    } catch (e) {
      console.log(chalk.red(`\n⚠️  Failed to parse tool call JSON: ${(e as Error).message}`));
      activeMessages.push({
        role: 'user',
        content: `<tool_result>\nError: Failed to parse tool call JSON. Please use the exact schema and correct syntax.\n</tool_result>`,
      });
      continue;
    }

    // Inform user of tool invocation
    console.log(chalk.cyan(`\n🤖 Calling Tool: ${chalk.bold(toolCall.name)} with arguments: ${JSON.stringify(toolCall.arguments)}`));

    // Execute tool
    const toolResult = await executeTool(toolCall.name, toolCall.arguments, config.safeMode);

    // Print status
    const summary = toolResult.length > 250 ? toolResult.slice(0, 250) + '...' : toolResult;
    console.log(chalk.gray(`   Result: ${summary.replace(/\n/g, ' ')}\n`));

    // Feed result back
    activeMessages.push({
      role: 'user',
      content: `<tool_result>\n${toolResult}\n</tool_result>`,
    });
  }

  // Return the full updated message history (including assistant answers and tool results)
  return activeMessages;
}
