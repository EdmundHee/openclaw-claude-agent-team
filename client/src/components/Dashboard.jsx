import { useMemo } from 'react';
import AgentCard from './AgentCard.jsx';

/**
 * Dashboard Grid Layout — 3 columns, auto-expanding rows
 *
 * Default (≤6 agents):
 * ┌──────────────┬─────────┬─────────┬─────────┐
 * │              │ Agent 1 │ Agent 2 │ Agent 3 │
 * │   OpenClaw   ├─────────┼─────────┼─────────┤
 * │   (2 rows)   │ Agent 4 │ Agent 5 │ Agent 6 │
 * └──────────────┴─────────┴─────────┴─────────┘
 *
 * When row 1+2 are full, expands:
 * ┌──────────────┬─────────┬─────────┬─────────┐
 * │              │ Agent 1 │ Agent 2 │ Agent 3 │
 * │              ├─────────┼─────────┼─────────┤
 * │   OpenClaw   │ Agent 4 │ Agent 5 │ Agent 6 │
 * │   (3 rows)   ├─────────┼─────────┼─────────┤
 * │              │ Agent 7 │ Agent 8 │ Agent 9 │
 * └──────────────┴─────────┴─────────┴─────────┘
 *
 * Keeps growing as more agents are added.
 */

const COLS = 3;
const MIN_ROWS = 2;

// Sprite sheets for agents - matches sprite config order
const AGENT_SPRITES = [
  '/sprites/agent-designer.svg',
  '/sprites/agent-frontend.svg',
  '/sprites/agent-backend.svg',
  '/sprites/agent-qa.svg',
];

export default function Dashboard({ agents, openclaw = {} }) {
  const sortedAgents = useMemo(() => {
    return [...agents]
      .filter(a => !a.isSubagent)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }, [agents]);

  const subAgents = useMemo(() => {
    return agents.filter(a => a.isSubagent);
  }, [agents]);

  const allAgents = [...sortedAgents, ...subAgents];

  // Calculate how many rows we need (minimum 2)
  const filledSlots = allAgents.length;
  const rowsNeeded = Math.max(MIN_ROWS, Math.ceil(filledSlots / COLS));

  // Total slots = rows × columns
  const totalSlots = rowsNeeded * COLS;

  // Build slots — fill with agents or empty
  const slots = [];
  for (let i = 0; i < totalSlots; i++) {
    slots.push(allAgents[i] || null);
  }

  // Compute team summary
  const workingCount = agents.filter(a => a.status === 'working').length;
  const waitingCount = agents.filter(a => a.status === 'waiting').length;
  const idleCount = agents.filter(a => a.status === 'idle').length;

  // Unique projects across all agents
  const projects = useMemo(() => {
    const set = new Set();
    agents.forEach(a => { if (a.project) set.add(a.project); });
    return Array.from(set);
  }, [agents]);

  // OpenClaw status: use gateway status if connected, else derive from team
  const openclawConnected = openclaw?.connected ?? false;
  const openclawStatus = openclawConnected
    ? (openclaw.status || 'idle')
    : (workingCount > 0 ? 'working' : 'idle');
  const openclawMessage = openclawConnected
    ? (openclaw.message || (workingCount > 0 ? `${projects.length} project${projects.length !== 1 ? 's' : ''} active` : null))
    : (workingCount > 0 ? `${projects.length} project${projects.length !== 1 ? 's' : ''} active` : null);

  // Dynamic grid styles
  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: `2fr repeat(${COLS}, 1fr)`,
    gridTemplateRows: `repeat(${rowsNeeded}, 1fr)`,
    gap: '12px',
    flex: 1,
    minHeight: 0,
  };

  const openclawCellStyle = {
    gridRow: `1 / ${rowsNeeded + 1}`, // Span ALL rows
    gridColumn: '1 / 2',
  };

  return (
    <div style={styles.wrapper}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>OPENCLAW DASHBOARD</h1>
        <div style={styles.stats}>
          <span style={styles.statItem}>
            <span style={{ ...styles.statDot, backgroundColor: '#00b894' }} />
            {workingCount} working
          </span>
          <span style={styles.statItem}>
            <span style={{ ...styles.statDot, backgroundColor: '#fdcb6e' }} />
            {waitingCount} waiting
          </span>
          <span style={styles.statItem}>
            <span style={{ ...styles.statDot, backgroundColor: '#636e72' }} />
            {idleCount} idle
          </span>
          <span style={styles.statItem}>
            {agents.length} total
          </span>
        </div>
      </div>

      {/* Grid */}
      <div style={gridStyle}>
        {/* OpenClaw - spans all rows */}
        <div style={openclawCellStyle}>
          <AgentCard
            agent={{
              name: 'OpenClaw',
              status: openclawStatus,
              tool: openclawMessage,
              toolStatus: openclawMessage,
              openclawConnected,
            }}
            isOpenClaw={true}
            spriteSheet="/sprites/openclaw-v2.svg"
          />
        </div>

        {/* Agent slots */}
        {slots.map((agent, i) => (
          <div key={`slot-${i}`} style={styles.agentCell}>
            {agent ? (
              <AgentCard 
                agent={agent} 
                paletteIndex={i} 
                spriteSheet={AGENT_SPRITES[i] || null}
              />
            ) : (
              <EmptySlot index={i + 1} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptySlot({ index }) {
  return (
    <div style={styles.emptySlot}>
      <div style={styles.emptyIcon}>
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <rect x="8" y="8" width="16" height="16" rx="4" stroke="#2d3436" strokeWidth="2" strokeDasharray="4 3" />
          <line x1="16" y1="12" x2="16" y2="20" stroke="#2d3436" strokeWidth="2" />
          <line x1="12" y1="16" x2="20" y2="16" stroke="#2d3436" strokeWidth="2" />
        </svg>
      </div>
      <span style={styles.emptyLabel}>SLOT {index}</span>
    </div>
  );
}

const styles = {
  wrapper: {
    minHeight: '100vh',
    background: '#ffffff',
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0 4px',
  },
  title: {
    fontFamily: '"Press Start 2P", monospace',
    fontSize: '16px',
    color: '#FF6B35',
    margin: 0,
    letterSpacing: '2px',
  },
  stats: {
    display: 'flex',
    gap: '16px',
    alignItems: 'center',
  },
  statItem: {
    fontFamily: '"Inter", sans-serif',
    fontSize: '13px',
    color: '#b2bec3',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  statDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    display: 'inline-block',
  },
  agentCell: {
    minHeight: '180px',
  },
  emptySlot: {
    height: '100%',
    border: '2px dashed #1a1a2e',
    borderRadius: '12px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    opacity: 0.4,
  },
  emptyIcon: {
    opacity: 0.5,
  },
  emptyLabel: {
    fontFamily: '"Press Start 2P", monospace',
    fontSize: '7px',
    color: '#2d3436',
    letterSpacing: '1px',
  },
};
