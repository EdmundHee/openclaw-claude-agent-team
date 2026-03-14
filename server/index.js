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
const agents = new Map(); // agentId -> { id, name, status, tool, project, projectPath, ... }
const watchers = new Map(); // sessionFile -> AgentWatcher
const scanner = new SessionScanner(CLAUDE_DIR);

// OpenClaw gateway state
let openclawStatus = {
  connected: false,
  status: 'disconnected', // disconnected | idle | working
  message: null,
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
      openclawStatus = { connected: true, status: 'idle', message: 'Gateway connected' };
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
      openclawStatus = { connected: false, status: 'disconnected', message: null };
      broadcastOpenclawStatus();
      // Reconnect after 5 seconds
      openclawReconnectTimer = setTimeout(connectOpenClaw, 5000);
    });

    openclawWs.on('error', () => {
      // Will trigger 'close' event
      openclawWs = null;
    });
  } catch (e) {
    openclawStatus = { connected: false, status: 'disconnected', message: null };
    broadcastOpenclawStatus();
    openclawReconnectTimer = setTimeout(connectOpenClaw, 5000);
  }
}

function handleOpenClawMessage(msg) {
  // Handle OpenClaw gateway events
  // Adapt based on OpenClaw's actual message protocol
  if (msg.type === 'agent:status' || msg.type === 'status') {
    openclawStatus.status = msg.status || 'idle';
    openclawStatus.message = msg.message || null;
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
      } else if (event.type === 'tool_done') {
        if (watcher.activeToolCount === 0) {
          agent.status = 'idle';
          agent.tool = null;
          agent.toolStatus = null;
        }
      } else if (event.type === 'status_change') {
        agent.status = event.status;
        if (event.status === 'idle') {
          agent.tool = null;
          agent.toolStatus = null;
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
            sessionFile: null,
            isSubagent: true,
            createdAt: Date.now()
          });
        }
      } else if (event.type === 'subagent_done') {
        const subId = `${agentInfo.id}-sub-${event.subagentId}`;
        removeAgent(subId);
      }

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
      });
    }
    if (agent.project) {
      const p = projects.get(agent.project);
      p.agentCount++;
      if (agent.status === 'working') p.workingCount++;
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
    isSubagent: false,
    createdAt: Date.now()
  });
  res.json({ id });
});

app.delete('/api/agents/:id', (req, res) => {
  removeAgent(req.params.id);
  res.json({ ok: true });
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
    for (const session of sessions) {
      const alreadyWatched = Array.from(agents.values()).some(
        a => a.sessionFile === session.file
      );
      if (!alreadyWatched && session.active) {
        addAgent({
          id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: session.sessionId.slice(0, 8),
          status: 'idle',
          tool: null,
          toolStatus: null,
          project: session.project,
          projectPath: session.projectPath,
          sessionFile: session.file,
          parentId: null,
          isSubagent: false,
          createdAt: Date.now()
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
