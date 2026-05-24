export const AGENT_MAX_TURNS = 10;
export const FILE_READ_LIMIT_BYTES = 100 * 1024;
export const SHELL_EXEC_TIMEOUT_MS = 60_000;
export const SHELL_EXEC_MAX_BUFFER = 10 * 1024 * 1024;
export const DIR_TREE_MAX_DEPTH = 2;
export const TOOL_RESULT_PREVIEW_CHARS = 120;
export const WRITE_PREVIEW_CHARS = 150;
export const SECRET_FILE_MODE = 0o600;

export const TOOL_CALL_OPEN = '<tool_call>';
export const TOOL_CALL_CLOSE = '</tool_call>';
export const TOOL_RESULT_OPEN = '<tool_result>';
export const TOOL_RESULT_CLOSE = '</tool_result>';

export const SKIP_DIR_NAMES = new Set(['node_modules', '.git', 'dist']);
