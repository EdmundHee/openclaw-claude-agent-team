import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { AgentWatcher } from './agentWatcher.js';
import { SessionScanner } from './sessionScanner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const CLAUDE_DIR = path.join(process.env.HOME, '.claude', 'projects');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static client build in production
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));

const server = createServer(app);
const wss = new WebSocketServer({ server });

// --- State ---
const agents = new Map(); // agentId -> { id, name, status, tool, sessionFile, ... }
const watchers = new Map(); // sessionFile -> AgentWatcher
const scanner = new SessionScanner(CLAUDE_DIR);

// --- Broadcast to all clients ---
function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(data);
  });
}

// --- Agent lifecycle ---
function addAgent(agentInfo) {
  agents.set(agentInfo.id, agentInfo);
  broadcast({ type: 'agent:added', agent: agentInfo });

  if (agentInfo.sessionFile && !watchers.has(agentInfo.sessionFile)) {
    const watcher = new AgentWatcher(agentInfo.sessionFile, agentInfo.id, (event) => {
      // Update agent state
      const agent = agents.get(agentInfo.id);
      if (!agent) return;

      if (event.type === 'tool_start') {
        agent.status = 'working';
        agent.tool = event.toolName;
        agent.toolStatus = event.status;
      } else if (event.type === 'tool_done') {
        // Check if other tools still active
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
        // A sub-agent was spawned via Task tool
        const subId = `${agentInfo.id}-sub-${event.subagentId}`;
        if (!agents.has(subId)) {
          addAgent({
            id: subId,
            name: event.taskDescription || `Sub-agent ${event.subagentId}`,
            status: 'working',
            tool: null,
            toolStatus: null,
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

app.get('/api/sessions', async (req, res) => {
  try {
    const sessions = await scanner.scan();
    res.json(sessions);
  } catch (err) {
    res.json([]);
  }
});

app.post('/api/agents/watch', (req, res) => {
  const { sessionFile, name } = req.body;
  const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  addAgent({
    id,
    name: name || path.basename(sessionFile, '.jsonl'),
    status: 'idle',
    tool: null,
    toolStatus: null,
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
  // Send current state on connect
  ws.send(JSON.stringify({
    type: 'snapshot',
    agents: Array.from(agents.values())
  }));
});

// --- Auto-scan for active sessions ---
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
          name: session.project || path.basename(session.file, '.jsonl'),
          status: 'idle',
          tool: null,
          toolStatus: null,
          sessionFile: session.file,
          parentId: null,
          isSubagent: false,
          createdAt: Date.now()
        });
      }
    }
  } catch (err) {
    // Silently continue if scan fails
  }
}

// Scan periodically for new sessions
setInterval(autoScan, 10000);

// --- Start ---
server.listen(PORT, () => {
  console.log(`🐾 OpenClaw Dashboard running at http://localhost:${PORT}`);
  console.log(`   Watching: ${CLAUDE_DIR}`);
  autoScan();
});
