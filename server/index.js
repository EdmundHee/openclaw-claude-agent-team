// Testing agent detection
import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { AgentWatcher } from './agentWatcher.js';
import { SessionScanner } from './sessionScanner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const CLAUDE_DIR = path.join(process.env.HOME, '.claude', 'projects');
const OPENCLAW_WS = process.env.OPENCLAW_WS || 'ws://127.0.0.1:18789';

const app = express();
app.use(cors());
app.use(express.json());

// Serve static client build in production
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));

const server = createServer(app);
const wss = new WebSocketServer({ server });

// --- State ---
const agents = new Map(); // agentId -> { id, name, status, tool, toolStatus, project, projectPath, tokens, taskHistory, currentTask, ... }
const watchers = new Map(); // sessionFile -> AgentWatcher
const scanner = new SessionScanner(CLAUDE_DIR);

// OpenClaw gateway state
let openclawStatus = {
  connected: false,
  status: 'disconnected', // disconnected | idle | working
  message: null,
  tokens: { input: 0, output: 0 }, // NEW: Token tracking
  taskHistory: [] // NEW: Task history
};

// --- Broadcast to all dashboard clients ---
function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(data);
  });
}

function broadcastOpenclawStatus() {
  broadcast({ type: 'openclaw:status', openclaw: openclawStatus });
}

// --- OpenClaw Gateway Connection ---
let openclawWs = null;
let openclawReconnectTimer = null;

function connectOpenClaw() {
  if (openclawWs && openclawWs.readyState === WebSocket.OPEN) return;

  try {
    openclawWs = new WebSocket(OPENCLAW_WS);

    openclawWs.on('open', () => {
      console.log('🦞 Connected to OpenClaw gateway');
      openclawStatus = { connected: true, status: 'idle', message: null, tokens: { input: 0, output: 0 }, taskHistory: [] };
      broadcastOpenclawStatus();
    });

    openclawWs.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        handleOpenClawMessage(msg);
      } catch (e) {
        // Non-JSON message
      }
    });

    openclawWs.on('close', () => {
      openclawStatus = { connected: false, status: 'disconnected', message: null, tokens: { input: 0, output: 0 }, taskHistory: [] };
      broadcastOpenclawStatus();
      // Reconnect after 5 seconds
      openclawReconnectTimer = setTimeout(connectOpenClaw, 5000);
    });

    openclawWs.on('error', () => {
      // Will trigger 'close' event
      openclawWs = null;
    });
  } catch (e) {
    openclawStatus = { connected: false, status: 'disconnected', message: null, tokens: { input: 0, output: 0 }, taskHistory: [] };
    broadcastOpenclawStatus();
    openclawReconnectTimer = setTimeout(connectOpenClaw, 5000);
  }
}

function handleOpenClawMessage(msg) {
  // Handle OpenClaw gateway events
  if (msg.type === 'agent:status' || msg.type === 'status') {
    openclawStatus.status = msg.status || 'idle';
    openclawStatus.message = msg.message || null;
    if (msg.tokens) openclawStatus.tokens = msg.tokens;
    broadcastOpenclawStatus();
  }

  if (msg.type === 'tool:start' || msg.type === 'tool_use') {
    openclawStatus.status = 'working';
    openclawStatus.message = msg.tool || msg.name || 'Processing...';
    broadcastOpenclawStatus();
  }

  if (msg.type === 'tool:done' || msg.type === 'tool_result') {
    openclawStatus.status = 'idle';
    openclawStatus.message = null;
    broadcastOpenclawStatus();
  }
}

// --- Agent lifecycle ---
function addAgent(agentInfo) {
  // Initialize new fields
  agentInfo.tokens = agentInfo.tokens || { input: 0, output: 0 };
  agentInfo.taskHistory = agentInfo.taskHistory || [];
  agentInfo.currentTask = agentInfo.currentTask || null;
  
  agents.set(agentInfo.id, agentInfo);
  broadcast({ type: 'agent:added', agent: agentInfo });

  if (agentInfo.sessionFile && !watchers.has(agentInfo.sessionFile)) {
    const watcher = new AgentWatcher(agentInfo.sessionFile, agentInfo.id, (event) => {
      const agent = agents.get(agentInfo.id);
      if (!agent) return;

      if (event.type === 'tool_start') {
        agent.status = 'working';
        agent.tool = event.toolName;
        agent.toolStatus = event.status;
        agent.currentTask = event.task || null;
      } else if (event.type === 'tool_done') {
        if (watcher.activeToolCount === 0) {
          agent.status = 'idle';
          agent.tool = null;
          agent.toolStatus = null;
          agent.currentTask = null;
        }
      } else if (event.type === 'status_change') {
        agent.status = event.status;
        if (event.status === 'idle') {
          agent.tool = null;
          agent.toolStatus = null;
          agent.currentTask = null;
        }
        // NEW: Update tokens and history
        if (event.tokens) {
          agent.tokens = event.tokens;
        }
        if (event.taskHistory) {
          agent.taskHistory = event.taskHistory;
        }
      } else if (event.type === 'task_completed') {
        // NEW: Task completed - add to history
        if (event.task) {
          agent.taskHistory = agent.taskHistory || [];
          agent.taskHistory.push(event.task);
          // Keep last 50 tasks
          if (agent.taskHistory.length > 50) {
            agent.taskHistory = agent.taskHistory.slice(-50);
          }
        }
        if (event.tokens) {
          agent.tokens = event.tokens;
        }
      } else if (event.type === 'subagent_start') {
        const subId = `${agentInfo.id}-sub-${event.subagentId}`;
        if (!agents.has(subId)) {
          addAgent({
            id: subId,
            name: event.taskDescription || `Sub-agent ${event.subagentId}`,
            status: 'working',
            tool: null,
            toolStatus: null,
            project: agent.project,       // Inherit parent's project
            projectPath: agent.projectPath,
            parentId: agentInfo.id,
            passedFrom: event.passedFrom,  // NEW: Track who passed the task
            sessionFile: null,
            isSubagent: true,
            createdAt: Date.now(),
            tokens: { input: 0, output: 0 },
            taskHistory: [],
            currentTask: {
              toolName: 'Task',
              status: event.taskDescription,
              prompt: event.prompt
            }
          });
        }
      } else if (event.type === 'subagent_done') {
        const subId = `${agentInfo.id}-sub-${event.subagentId}`;
        
        // NEW: Transfer task history from subagent to parent
        const subAgent = agents.get(subId);
        if (subAgent && subAgent.taskHistory && subAgent.taskHistory.length > 0) {
          agent.taskHistory = agent.taskHistory || [];
          agent.taskHistory.push({
            toolName: 'Delegated',
            status: subAgent.name,
            passedTo: subId,
            passedFrom: event.passedFrom,
            completedAt: Date.now(),
            subtasks: subAgent.taskHistory
          });
        }
        
        removeAgent(subId);
      }

      // Always include new fields in broadcast
      agents.set(agentInfo.id, agent);
      broadcast({ type: 'agent:updated', agent: { ...agent } });
    });

    watcher.start();
    watchers.set(agentInfo.sessionFile, watcher);
  }
}

function removeAgent(agentId) {
  const agent = agents.get(agentId);
  if (!agent) return;

  if (agent.sessionFile && watchers.has(agent.sessionFile)) {
    watchers.get(agent.sessionFile).stop();
    watchers.delete(agent.sessionFile);
  }

  agents.delete(agentId);
  broadcast({ type: 'agent:removed', id: agentId });
}

// --- REST API ---
app.get('/api/agents', (req, res) => {
  res.json(Array.from(agents.values()));
});

app.get('/api/openclaw', (req, res) => {
  res.json(openclawStatus);
});

app.get('/api/sessions', async (req, res) => {
  try {
    const sessions = await scanner.scan();
    res.json(sessions);
  } catch (err) {
    res.json([]);
  }
});

// Get unique projects across all active agents
app.get('/api/projects', (req, res) => {
  const projects = new Map();
  for (const agent of agents.values()) {
    if (agent.project && !projects.has(agent.project)) {
      projects.set(agent.project, {
        name: agent.project,
        path: agent.projectPath,
        agentCount: 0,
        workingCount: 0,
        totalTokens: { input: 0, output: 0 },
        taskCount: 0
      });
    }
    if (agent.project) {
      const p = projects.get(agent.project);
      p.agentCount++;
      if (agent.status === 'working') p.workingCount++;
      if (agent.tokens) {
        p.totalTokens.input += agent.tokens.input || 0;
        p.totalTokens.output += agent.tokens.output || 0;
      }
      if (agent.taskHistory) {
        p.taskCount += agent.taskHistory.length;
      }
    }
  }
  res.json(Array.from(projects.values()));
});

app.post('/api/agents/watch', (req, res) => {
  const { sessionFile, name, project, projectPath } = req.body;
  const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  addAgent({
    id,
    name: name || path.basename(sessionFile, '.jsonl'),
    status: 'idle',
    tool: null,
    toolStatus: null,
    project: project || null,
    projectPath: projectPath || null,
    sessionFile,
    parentId: null,
    passedFrom: null,
    isSubagent: false,
    createdAt: Date.now(),
    tokens: { input: 0, output: 0 },
    taskHistory: [],
    currentTask: null
  });
  res.json({ id });
});

app.delete('/api/agents/:id', (req, res) => {
  removeAgent(req.params.id);
  res.json({ ok: true });
});

// NEW: Get detailed agent info including tokens and history
app.get('/api/agents/:id', (req, res) => {
  const agent = agents.get(req.params.id);
  if (!agent) {
    res.json({ error: 'Agent not found' });
    return;
  }
  
  // Get additional stats from watcher if available
  if (agent.sessionFile && watchers.has(agent.sessionFile)) {
    const watcher = watchers.get(agent.sessionFile);
    const stats = {
      ...agent,
      tokenStats: watcher.getTokenStats(),
      taskHistoryFull: watcher.getTaskHistory()
    };
    res.json(stats);
  } else {
    res.json(agent);
  }
});

// --- WebSocket ---
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({
    type: 'snapshot',
    agents: Array.from(agents.values()),
    openclaw: openclawStatus
  }));
});

// --- Auto-scan for active sessions across ALL projects ---
async function autoScan() {
  try {
    const sessions = await scanner.scan();
    
    // Role names based on index
    const roleNames = ['UI Designer', 'Frontend Dev', 'Backend Dev', 'QA Tester', 'DevOps', 'Data Engineer', 'Security', 'API Dev'];
    
    // Track running index per project for agents added in this scan
    const projectNewAgentIndex = {};
    
    for (const session of sessions) {
      const alreadyWatched = Array.from(agents.values()).some(
        a => a.sessionFile === session.file
      );
      if (!alreadyWatched && session.active) {
        // Get existing agent count for this project as starting index
        const existingCount = Object.keys(agents).filter(id => agents.get(id)?.project === session.project).length;
        
        // Use existing count + position in this batch
        if (!projectNewAgentIndex[session.project]) {
          projectNewAgentIndex[session.project] = existingCount;
        }
        
        const agentIndex = projectNewAgentIndex[session.project];
        projectNewAgentIndex[session.project]++; // Increment for next agent
        
        const roleName = agentIndex < roleNames.length ? roleNames[agentIndex] : `Agent ${agentIndex + 1}`;
        
        addAgent({
          id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: roleName,
          status: 'idle',
          tool: null,
          toolStatus: null,
          project: session.project,
          projectPath: session.projectPath,
          sessionFile: session.file,
          parentId: null,
          passedFrom: null,
          isSubagent: false,
          createdAt: Date.now(),
          tokens: { input: 0, output: 0 },
          taskHistory: [],
          currentTask: null
        });
      }
    }

    // Clean up stale agents (session file gone or inactive for 30min)
    for (const [id, agent] of agents) {
      if (agent.sessionFile && !agent.isSubagent) {
        try {
          const stat = fs.statSync(agent.sessionFile);
          const age = Date.now() - stat.mtimeMs;
          if (age > 30 * 60 * 1000) {
            removeAgent(id);
          }
        } catch (e) {
          removeAgent(id);
        }
      }
    }
  } catch (err) {
    // Silently continue if scan fails
  }
}

// Need fs for stale agent cleanup
import fs from 'fs';

// Scan periodically for new sessions
setInterval(autoScan, 10000);

// --- Start ---
server.listen(PORT, () => {
  console.log(`🐾 OpenClaw Dashboard running at http://localhost:${PORT}`);
  console.log(`   Watching Claude Code: ${CLAUDE_DIR}`);
  console.log(`   OpenClaw gateway: ${OPENCLAW_WS}`);
  autoScan();
  connectOpenClaw();
});
