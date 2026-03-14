import { useMemo } from 'react';
import AgentCard from './AgentCard.jsx';

/**
 * Dashboard Grid Layout
 *
 * ┌──────────────┬─────────┬─────────┬─────────┬─────────┬─────────┐
 * │              │ Agent 1 │ Agent 2 │ Agent 3 │ Agent 4 │ Agent 5 │
 * │   OpenClaw   ├─────────┼─────────┼─────────┼─────────┼─────────┤
 * │   (2 rows)   │ Agent 6 │ Agent 7 │ Agent 8 │ Agent 9 │ Agent10 │
 * └──────────────┴─────────┴─────────┴─────────┴─────────┴─────────┘
 */

const MAX_AGENT_SLOTS = 10;

export default function Dashboard({ agents }) {
  // Separate main agents from sub-agents, sort by creation time
  const sortedAgents = useMemo(() => {
    return [...agents]
      .filter(a => !a.isSubagent)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }, [agents]);

  const subAgents = useMemo(() => {
    return agents.filter(a => a.isSubagent);
  }, [agents]);

  const allAgents = [...sortedAgents, ...subAgents];

  // Build 10 slots — fill with agents or empty
  const slots = [];
  for (let i = 0; i < MAX_AGENT_SLOTS; i++) {
    slots.push(allAgents[i] || null);
  }

  // Compute team summary
  const workingCount = agents.filter(a => a.status === 'working').length;
  const waitingCount = agents.filter(a => a.status === 'waiting').length;
  const idleCount = agents.filter(a => a.status === 'idle').length;

  // OpenClaw status is based on team activity
  const openclawStatus = workingCount > 0 ? 'working' : 'idle';

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
      <div style={styles.grid}>
        {/* OpenClaw - spans 2 rows */}
        <div style={styles.openclawCell}>
          <AgentCard
            agent={{ name: 'OpenClaw', status: openclawStatus, tool: workingCount > 0 ? `Managing ${workingCount} agent${workingCount > 1 ? 's' : ''}` : null }}
            isOpenClaw={true}
          />
        </div>

        {/* Agent slots - Row 1 */}
        {slots.slice(0, 5).map((agent, i) => (
          <div key={`slot-${i}`} style={styles.agentCell}>
            {agent ? (
              <AgentCard agent={agent} paletteIndex={i} />
            ) : (
              <EmptySlot index={i + 1} />
            )}
          </div>
        ))}

        {/* Agent slots - Row 2 */}
        {slots.slice(5, 10).map((agent, i) => (
          <div key={`slot-${i + 5}`} style={styles.agentCell}>
            {agent ? (
              <AgentCard agent={agent} paletteIndex={i + 5} />
            ) : (
              <EmptySlot index={i + 6} />
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
    background: '#0f0f1a',
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
  grid: {
    display: 'grid',
    gridTemplateColumns: '2fr repeat(5, 1fr)',
    gridTemplateRows: '1fr 1fr',
    gap: '12px',
    flex: 1,
    minHeight: 0,
  },
  openclawCell: {
    gridRow: '1 / 3', // Span 2 rows
    gridColumn: '1 / 2',
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
