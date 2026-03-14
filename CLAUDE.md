# CLAUDE.md

This file provides guidance to Claude Code when working on this project.

## Project Overview

OpenClaw Dashboard is a local web-based real-time visualization tool for Claude Code agent teams. It monitors all Claude Code sessions across all projects globally and displays them in an animated grid alongside an OpenClaw orchestrator card.

## Architecture

Two-process setup:
- **Backend**: Node.js/Express server on port 3000 with WebSocket for real-time updates
- **Frontend**: React 19 + Vite dev server on port 3001 (proxies API/WS to backend)

In production, the built React app is served by Express directly from `client/dist/`.

## Key Technical Details

### JSONL Transcript Parsing
- Claude Code writes session transcripts at `~/.claude/projects/<project-hash>/<session-id>.jsonl`
- Project hashes encode the full path with `-` replacing `/`, `\`, `:` (e.g., `Users-edmund-code-my-project`)
- The watcher reads by byte offset with a line buffer for incomplete lines
- Triple-layer file watching for cross-platform reliability: `fs.watch()` + `fs.watchFile()` + `setInterval()`

### Agent States
- **idle**: No active tools, turn completed (signaled by `turn_duration` system event)
- **working**: One or more `tool_use` blocks active without corresponding `tool_result`
- **waiting**: 5 seconds elapsed since last tool started with no new data (permission needed)

### Grid Layout
- CSS Grid with 3 agent columns + 1 OpenClaw column (ratio: `2fr repeat(3, 1fr)`)
- OpenClaw card always spans all rows via dynamic `gridRow: 1 / N+1`
- Rows auto-expand: `Math.max(2, Math.ceil(agentCount / 3))`
- No separate bottom grid — all slots flow within the single grid

### OpenClaw Integration
- Connects to OpenClaw gateway at `ws://127.0.0.1:18789` (configurable via `OPENCLAW_WS` env)
- Auto-reconnects every 5 seconds on disconnect
- Falls back to deriving status from team activity when gateway is offline

### Character Sprites
- Procedural canvas-drawn characters (32×32 logical pixels, scaled to 80px or 128px)
- 10 color palettes for agents, special orange+crown palette for OpenClaw
- Supports swappable sprite sheet images via `sprites.config.json`
- Sprite sheet format: Row 0 = idle frames, Row 1 = working frames (32×32 each)

## Build & Run Commands

```bash
# Development (both servers)
npm run dev

# Server only
npm run server

# Client only (needs server running for API proxy)
npm run client

# Production build
npm run build

# Production start (serves built client from Express)
npm start
```

## Code Style

- ES Modules (`"type": "module"` in package.json)
- React 19 with functional components and hooks
- Inline styles (no CSS-in-JS library, no Tailwind)
- Fonts: "Press Start 2P" for pixel labels, "Inter" for body text

## File Conventions

- Server code in `server/` (plain .js, no TypeScript)
- Client code in `client/src/` (.jsx for React components)
- Static assets in `client/public/sprites/`
- Standalone preview at `preview.html` (no build step, mirrors React layout)

## Common Tasks

### Adding a new agent state
1. Add to `STATUS_COLORS` and `STATUS_LABELS` in `AgentCard.jsx`
2. Update detection logic in `agentWatcher.js` `_processRecord()`
3. Update the preview.html card template CSS classes

### Changing the grid column count
1. Update `COLS` constant in `Dashboard.jsx` and `preview.html`
2. Update `gridTemplateColumns` in both files

### Adding new tool detection
1. Add tool name to `READING_TOOLS` or `TYPING_TOOLS` set in `agentWatcher.js`
2. Add formatting case to `_formatToolStatus()`

### Swapping character artwork
1. Place sprite sheets in `client/public/sprites/`
2. Update `sprites.config.json` with paths and set `type: "spritesheet"`
3. Pass `spriteSheet` prop to `CharacterSprite` component
