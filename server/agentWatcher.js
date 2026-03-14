import fs from 'fs';
import path from 'path';

/**
 * Watches a Claude Code JSONL transcript file and emits state events.
 *
 * Claude Code writes session transcripts as append-only JSONL files at:
 *   ~/.claude/projects/<project-hash>/<session-id>.jsonl
 *
 * Record types we care about:
 *   - assistant: contains tool_use blocks (agent starts using a tool)
 *   - user: contains tool_result blocks (tool finished)
 *   - system: turn_duration signals end of a turn (agent goes idle)
 *   - progress: sub-agent tool forwarding
 */

const READING_TOOLS = new Set(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch']);
const TYPING_TOOLS = new Set(['Write', 'Edit', 'Bash', 'NotebookEdit']);
const SUBAGENT_TOOLS = new Set(['Task', 'Agent']);

// How long to wait before declaring "waiting for permission"
const PERMISSION_TIMEOUT_MS = 5000;

// Estimate tokens (rough approximation: 1 token ≈ 4 chars)
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export class AgentWatcher {
  constructor(filePath, agentId, onEvent) {
    this.filePath = filePath;
    this.agentId = agentId;
    this.onEvent = onEvent;

    this.fileOffset = 0;
    this.lineBuffer = '';
    this.activeTools = new Map(); // toolId -> { name, status, input }
    this.subagentTools = new Map(); // toolId -> subagentId

    // NEW: Token tracking
    this.tokens = { input: 0, output: 0 };
    
    // NEW: Task history
    this.taskHistory = [];
    
    // NEW: Current task details
    this.currentTask = null;

    this._fsWatcher = null;
    this._pollInterval = null;
    this._permissionTimer = null;
    this._stopped = false;
  }

  get activeToolCount() {
    return this.activeTools.size;
  }

  // NEW: Get token stats
  getTokenStats() {
    return { ...this.tokens };
  }

  // NEW: Get task history
  getTaskHistory() {
    return [...this.taskHistory];
  }

  start() {
    if (!fs.existsSync(this.filePath)) {
      // Poll until file appears
      this._pollInterval = setInterval(() => {
        if (fs.existsSync(this.filePath)) {
          clearInterval(this._pollInterval);
          this._startWatching();
        }
      }, 1000);
      return;
    }
    this._startWatching();
  }

  stop() {
    this._stopped = true;
    if (this._fsWatcher) {
      this._fsWatcher.close();
      this._fsWatcher = null;
    }
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
    if (this._permissionTimer) {
      clearTimeout(this._permissionTimer);
      this._permissionTimer = null;
    }
  }

  _startWatching() {
    // Read existing content first
    this._readNewContent();

    // Triple-layer watching (inspired by pixel-agents)
    // Layer 1: fs.watch (fast but unreliable on some OS)
    try {
      this._fsWatcher = fs.watch(this.filePath, () => {
        if (!this._stopped) this._readNewContent();
      });
    } catch (e) {
      // fs.watch not supported
    }

    // Layer 2: fs.watchFile (stat-based, reliable fallback)
    fs.watchFile(this.filePath, { interval: 1000 }, () => {
      if (!this._stopped) this._readNewContent();
    });

    // Layer 3: Manual polling
    this._pollInterval = setInterval(() => {
      if (!this._stopped) this._readNewContent();
    }, 2000);
  }

  _readNewContent() {
    try {
      const stat = fs.statSync(this.filePath);
      if (stat.size <= this.fileOffset) return;

      const fd = fs.openSync(this.filePath, 'r');
      const bufSize = stat.size - this.fileOffset;
      const buf = Buffer.alloc(bufSize);
      fs.readSync(fd, buf, 0, bufSize, this.fileOffset);
      fs.closeSync(fd);

      this.fileOffset = stat.size;
      const text = this.lineBuffer + buf.toString('utf-8');
      const lines = text.split('\n');

      // Last element may be incomplete line
      this.lineBuffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim()) {
          try {
            const record = JSON.parse(line);
            this._processRecord(record);
          } catch (e) {
            // Skip malformed lines
          }
        }
      }
    } catch (e) {
      // File may have been removed
    }
  }

  _processRecord(record) {
    const { type, message } = record;

    // NEW: Track tokens from message content
    if (message?.content) {
      for (const block of message.content) {
        if (block.type === 'text' && block.text) {
          if (type === 'assistant') {
            this.tokens.output += estimateTokens(block.text);
          } else if (type === 'user' && block.assistant && block.assistant.length > 0) {
            // Track input tokens from previous assistant messages
          }
        }
      }
    }

    if (type === 'assistant' && message?.content) {
      // Look for tool_use blocks
      for (const block of message.content) {
        if (block.type === 'tool_use') {
          const toolName = block.name;
          const toolId = block.id;

          // NEW: Store current task
          this.currentTask = {
            toolName,
            status: this._formatToolStatus(toolName, block.input),
            filePath: block.input?.file_path || null,
            pattern: block.input?.pattern || null,
            command: block.input?.command || null,
            prompt: block.input?.prompt?.slice(0, 100) || block.input?.description?.slice(0, 100) || null,
            startedAt: Date.now()
          };

          // NEW: Track tool input tokens
          const inputStr = JSON.stringify(block.input || {});
          this.tokens.input += estimateTokens(inputStr);

          this.activeTools.set(toolId, { 
            name: toolName, 
            status: this.currentTask.status,
            input: block.input
          });

          // Check if this is a sub-agent spawn
          if (SUBAGENT_TOOLS.has(toolName)) {
            const taskDesc = block.input?.description || block.input?.prompt?.slice(0, 60) || 'Sub-task';
            this.subagentTools.set(toolId, toolId);
            
            // NEW: Emit subagent_start with task info
            this.onEvent({
              type: 'subagent_start',
              subagentId: toolId,
              taskDescription: taskDesc,
              prompt: block.input?.prompt || block.input?.description || '',
              passedFrom: this.agentId
            });
          }

          const status = this._formatToolStatus(toolName, block.input);
          this.onEvent({
            type: 'tool_start',
            toolId,
            toolName,
            status,
            task: this.currentTask
          });

          this._resetPermissionTimer();
        }
      }
    }

    if (type === 'user' && message?.content) {
      // Look for tool_result blocks
      for (const block of message.content) {
        if (block.type === 'tool_result') {
          const toolId = block.tool_use_id;
          const toolData = this.activeTools.get(toolId);

          // NEW: Add to task history when tool completes
          if (toolData) {
            const completedTask = {
              toolName: toolData.name,
              status: toolData.status,
              filePath: toolData.input?.file_path || null,
              completedAt: Date.now(),
              duration: this.currentTask ? Date.now() - this.currentTask.startedAt : 0,
              result: block.content?.slice(0, 200) || null // First 200 chars of result
            };
            
            // Only add if not already in recent history
            const existingIndex = this.taskHistory.findIndex(
              t => t.toolName === completedTask.toolName && 
              t.filePath === completedTask.filePath &&
              Date.now() - t.completedAt < 60000 // Within last minute
            );
            
            if (existingIndex === -1) {
              this.taskHistory.push(completedTask);
              // Keep only last 50 tasks
              if (this.taskHistory.length > 50) {
                this.taskHistory = this.taskHistory.slice(-50);
              }
              
              this.onEvent({
                type: 'task_completed',
                task: completedTask,
                tokens: { ...this.tokens }
              });
            }
          }

          // Check if sub-agent completed
          if (this.subagentTools.has(toolId)) {
            this.onEvent({
              type: 'subagent_done',
              subagentId: toolId,
              passedFrom: this.agentId
            });
            this.subagentTools.delete(toolId);
          }

          this.activeTools.delete(toolId);
          this.currentTask = null;
          this.onEvent({ type: 'tool_done', toolId });
        }
      }
    }

    // turn_duration signals end of turn
    if (type === 'system' && record.subtype === 'turn_duration') {
      this.activeTools.clear();
      this.subagentTools.clear();
      this.currentTask = null;
      
      // NEW: Emit idle with final token count
      this.onEvent({ 
        type: 'status_change', 
        status: 'idle',
        tokens: { ...this.tokens },
        taskHistory: [...this.taskHistory]
      });
      this._clearPermissionTimer();
    }

    // Progress events (sub-agent activity)
    if (type === 'progress') {
      this._resetPermissionTimer();
    }
  }

  _formatToolStatus(toolName, input) {
    if (!input) return toolName;

    switch (toolName) {
      case 'Read':
        return `Reading ${input.file_path ? path.basename(input.file_path) : 'file'}`;
      case 'Write':
        return `Writing ${input.file_path ? path.basename(input.file_path) : 'file'}`;
      case 'Edit':
        return `Editing ${input.file_path ? path.basename(input.file_path) : 'file'}`;
      case 'Bash':
        return `Running: ${input.command ? input.command.slice(0, 40) : 'command'}`;
      case 'Grep':
        return `Searching: ${input.pattern || ''}`.slice(0, 50);
      case 'Glob':
        return `Finding: ${input.pattern || ''}`.slice(0, 50);
      case 'Task':
      case 'Agent':
        return `Delegating: ${(input.description || input.prompt || '').slice(0, 50)}`;
      case 'WebSearch':
        return `Web: ${(input.query || '').slice(0, 40)}`;
      case 'WebFetch':
        return `Fetch: ${(input.url || '').slice(0, 40)}`;
      default:
        return toolName;
    }
  }

  _resetPermissionTimer() {
    this._clearPermissionTimer();
    this._permissionTimer = setTimeout(() => {
      this.onEvent({ type: 'status_change', status: 'waiting' });
    }, PERMISSION_TIMEOUT_MS);
  }

  _clearPermissionTimer() {
    if (this._permissionTimer) {
      clearTimeout(this._permissionTimer);
      this._permissionTimer = null;
    }
  }
}
