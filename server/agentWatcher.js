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

export class AgentWatcher {
  constructor(filePath, agentId, onEvent) {
    this.filePath = filePath;
    this.agentId = agentId;
    this.onEvent = onEvent;

    this.fileOffset = 0;
    this.lineBuffer = '';
    this.activeTools = new Map(); // toolId -> { name, status }
    this.subagentTools = new Map(); // toolId -> subagentId

    this._fsWatcher = null;
    this._pollInterval = null;
    this._permissionTimer = null;
    this._stopped = false;
  }

  get activeToolCount() {
    return this.activeTools.size;
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

    if (type === 'assistant' && message?.content) {
      // Look for tool_use blocks
      for (const block of message.content) {
        if (block.type === 'tool_use') {
          const toolName = block.name;
          const toolId = block.id;

          this.activeTools.set(toolId, { name: toolName });

          // Check if this is a sub-agent spawn
          if (SUBAGENT_TOOLS.has(toolName)) {
            const taskDesc = block.input?.description || block.input?.prompt?.slice(0, 60) || 'Sub-task';
            this.subagentTools.set(toolId, toolId);
            this.onEvent({
              type: 'subagent_start',
              subagentId: toolId,
              taskDescription: taskDesc
            });
          }

          const status = this._formatToolStatus(toolName, block.input);
          this.onEvent({
            type: 'tool_start',
            toolId,
            toolName,
            status
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

          // Check if sub-agent completed
          if (this.subagentTools.has(toolId)) {
            this.onEvent({
              type: 'subagent_done',
              subagentId: toolId
            });
            this.subagentTools.delete(toolId);
          }

          this.activeTools.delete(toolId);
          this.onEvent({ type: 'tool_done', toolId });
        }
      }
    }

    // turn_duration signals end of turn
    if (type === 'system' && record.subtype === 'turn_duration') {
      this.activeTools.clear();
      this.subagentTools.clear();
      this.onEvent({ type: 'status_change', status: 'idle' });
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
        return `Running command`;
      case 'Grep':
        return `Searching: ${input.pattern || ''}`.slice(0, 50);
      case 'Glob':
        return `Finding files: ${input.pattern || ''}`.slice(0, 50);
      case 'Task':
      case 'Agent':
        return `Delegating: ${(input.description || input.prompt || '').slice(0, 50)}`;
      case 'WebSearch':
        return `Searching web: ${(input.query || '').slice(0, 40)}`;
      case 'WebFetch':
        return `Fetching: ${(input.url || '').slice(0, 40)}`;
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
