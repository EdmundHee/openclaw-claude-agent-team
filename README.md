# OpenClaw Dashboard

A local web-based dashboard that visualizes Claude Code agent team activity across all your projects in real-time. Connects to [OpenClaw](https://github.com/openclaw/openclaw) as the orchestrating Product Manager.

## What It Does

- **Global monitoring** — Scans all projects in `~/.claude/projects/` and shows which agent is working on which project
- **Real-time status** — Watches Claude Code JSONL transcripts via triple-layer file watching (fs.watch + fs.watchFile + polling)
- **OpenClaw integration** — Connects to the OpenClaw gateway WebSocket to reflect orchestrator status
- **Auto-expanding grid** — OpenClaw card spans all rows; grid grows as more agents are detected
- **Animated characters** — Pixel-art procedural sprites with IDLE and WORKING states
- **Swappable artwork** — Drop in custom sprite sheets via `sprites.config.json`

## Layout

```
┌──────────────┬─────────┬─────────┬─────────┐
│              │ Agent 1 │ Agent 2 │ Agent 3 │
│              │ 📁 proj │ 📁 proj │ 📁 proj │
│   OpenClaw   ├─────────┼─────────┼─────────┤
│   PM         │ Agent 4 │ Agent 5 │ Agent 6 │
│              │ 📁 proj │ 📁 proj │ 📁 proj │
│ N projects   ├─────────┼─────────┼─────────┤
│ active       │ Agent 7 │  ...    │  ...    │ ← auto-expands
└──────────────┴─────────┴─────────┴─────────┘
```

## Quick Start

```bash
npm install
cd client && npm install && cd ..
npm run dev
```

Then open `http://localhost:3001`. The backend auto-discovers active Claude Code sessions and starts watching them.

To preview the UI without any active sessions, click **DEMO MODE** in the bottom-right corner.

## How It Works

### Backend (Node.js + Express + WebSocket)

1. **SessionScanner** scans `~/.claude/projects/` every 10 seconds for active JSONL files (modified within last 10 minutes)
2. **AgentWatcher** reads each JSONL transcript by byte offset, parsing `tool_use`, `tool_result`, and `turn_duration` records to determine agent state
3. State changes are broadcast to all connected dashboard clients via WebSocket
4. The server also connects to the OpenClaw gateway at `ws://127.0.0.1:18789` for orchestrator status

### Frontend (React + Vite)

- Single WebSocket connection receives agent snapshots and real-time updates
- Canvas-based procedural character sprites animate at 4 FPS
- CSS Grid auto-expands rows based on agent count; OpenClaw always spans all rows

### Claude Code Integration

The dashboard reads Claude Code's append-only JSONL transcript files without modifying anything. Claude Code writes these at:

```
~/.claude/projects/<project-hash>/<session-id>.jsonl
```

Each line is a JSON record. The watcher looks for:

| Record Type | What It Means |
|---|---|
| `assistant` with `tool_use` blocks | Agent started using a tool → WORKING |
| `user` with `tool_result` blocks | Tool completed |
| `system` with `turn_duration` | Turn ended → IDLE |
| `progress` | Sub-agent activity (resets permission timer) |

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Backend server port |
| `OPENCLAW_WS` | `ws://127.0.0.1:18789` | OpenClaw gateway WebSocket URL |

### Custom Artwork

Edit `sprites.config.json` to swap character artwork:

```json
{
  "agents": {
    "type": "spritesheet",
    "spriteSheets": ["/path/to/char_0.png", "/path/to/char_1.png"]
  }
}
```

Sprite sheet format: 32×32px frames, Row 0 = idle frames, Row 1 = working frames, minimum 2 frames per row.

## Project Structure

```
server/
  index.js              Express + WebSocket server + OpenClaw gateway
  agentWatcher.js       JSONL transcript parser with triple-layer file watching
  sessionScanner.js     Global project scanner with path decoding
client/src/
  App.jsx               Root with demo mode toggle
  components/
    Dashboard.jsx       Auto-expanding grid layout
    AgentCard.jsx       Card with status, sprite, tool + project badges
    CharacterSprite.jsx Canvas-based sprite with IDLE/WORKING animation
  hooks/
    useAgentSocket.js   WebSocket client with auto-reconnect
preview.html            Standalone demo (open directly in browser)
sprites.config.json     Character artwork configuration
```

## License

MIT
