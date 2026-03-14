import CharacterSprite from './CharacterSprite.jsx';

const STATUS_COLORS = {
  idle: { bg: '#1a1a2e', border: '#16213e', glow: 'transparent', dot: '#636e72' },
  working: { bg: '#1a1a2e', border: '#00b894', glow: 'rgba(0, 184, 148, 0.3)', dot: '#00b894' },
  waiting: { bg: '#1a1a2e', border: '#fdcb6e', glow: 'rgba(253, 203, 110, 0.3)', dot: '#fdcb6e' },
  disconnected: { bg: '#1a1a2e', border: '#636e72', glow: 'transparent', dot: '#e17055' },
};

const STATUS_LABELS = {
  idle: 'IDLE',
  working: 'WORKING',
  waiting: 'WAITING',
};

export default function AgentCard({ agent, paletteIndex = 0, isOpenClaw = false }) {
  const status = agent?.status || 'idle';
  const colors = STATUS_COLORS[status] || STATUS_COLORS.idle;
  const spriteSize = isOpenClaw ? 128 : 80;

  return (
    <div style={{
      ...styles.card,
      borderColor: colors.border,
      boxShadow: `0 0 20px ${colors.glow}, inset 0 1px 0 rgba(255,255,255,0.05)`,
      height: '100%',
    }}>
      {/* Status indicator dot */}
      <div style={styles.statusRow}>
        <div style={{
          ...styles.statusDot,
          backgroundColor: colors.dot,
          boxShadow: status !== 'idle' ? `0 0 8px ${colors.dot}` : 'none',
          animation: status === 'working' ? 'pulse 1.5s ease-in-out infinite' : 'none',
        }} />
        <span style={{
          ...styles.statusLabel,
          color: colors.dot,
        }}>
          {STATUS_LABELS[status]}
        </span>
      </div>

      {/* Character sprite */}
      <div style={styles.spriteContainer}>
        <CharacterSprite
          status={status === 'waiting' ? 'idle' : status === 'working' ? 'working' : 'idle'}
          paletteIndex={paletteIndex}
          isOpenClaw={isOpenClaw}
          size={spriteSize}
        />
      </div>

      {/* Tool activity */}
      {agent?.tool && (
        <div style={styles.toolBadge}>
          <span style={styles.toolIcon}>&#9881;</span>
          <span style={styles.toolText}>
            {agent.toolStatus || agent.tool}
          </span>
        </div>
      )}

      {/* Project badge (for non-OpenClaw agents) */}
      {!isOpenClaw && agent?.project && (
        <div style={styles.projectBadge}>
          <span style={styles.projectIcon}>&#128193;</span>
          <span style={styles.projectText}>{agent.project}</span>
        </div>
      )}

      {/* Agent name */}
      <div style={styles.nameContainer}>
        <span style={{
          ...styles.name,
          fontSize: isOpenClaw ? '11px' : '9px',
        }}>
          {isOpenClaw ? 'OPENCLAW' : (agent?.name || 'Agent')}
        </span>
        {isOpenClaw && (
          <span style={styles.role}>Product Manager</span>
        )}
        {isOpenClaw && agent?.openclawConnected === false && (
          <span style={styles.disconnectedBadge}>GATEWAY OFFLINE</span>
        )}
        {agent?.isSubagent && (
          <span style={styles.subagentBadge}>SUB-AGENT</span>
        )}
      </div>
    </div>
  );
}

const styles = {
  card: {
    background: '#1a1a2e',
    border: '2px solid #16213e',
    borderRadius: '12px',
    padding: '16px 12px 12px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    transition: 'all 0.3s ease',
    position: 'relative',
    overflow: 'hidden',
  },
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    alignSelf: 'flex-start',
  },
  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    transition: 'all 0.3s ease',
  },
  statusLabel: {
    fontFamily: '"Press Start 2P", monospace',
    fontSize: '7px',
    letterSpacing: '1px',
    transition: 'color 0.3s ease',
  },
  spriteContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  toolBadge: {
    background: 'rgba(0, 184, 148, 0.15)',
    border: '1px solid rgba(0, 184, 148, 0.3)',
    borderRadius: '6px',
    padding: '4px 8px',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    maxWidth: '100%',
    overflow: 'hidden',
  },
  toolIcon: {
    fontSize: '10px',
    color: '#00b894',
    flexShrink: 0,
  },
  toolText: {
    fontFamily: '"Inter", sans-serif',
    fontSize: '10px',
    color: '#b2bec3',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  nameContainer: {
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '2px',
  },
  name: {
    fontFamily: '"Press Start 2P", monospace',
    color: '#dfe6e9',
    letterSpacing: '1px',
    textTransform: 'uppercase',
  },
  role: {
    fontFamily: '"Inter", sans-serif',
    fontSize: '10px',
    color: '#636e72',
    fontWeight: '500',
  },
  subagentBadge: {
    fontFamily: '"Press Start 2P", monospace',
    fontSize: '6px',
    color: '#a29bfe',
    background: 'rgba(162, 155, 254, 0.15)',
    padding: '2px 6px',
    borderRadius: '4px',
    letterSpacing: '1px',
  },
  disconnectedBadge: {
    fontFamily: '"Press Start 2P", monospace',
    fontSize: '6px',
    color: '#e17055',
    background: 'rgba(225, 112, 85, 0.15)',
    padding: '2px 6px',
    borderRadius: '4px',
    letterSpacing: '1px',
  },
  projectBadge: {
    background: 'rgba(108, 92, 231, 0.15)',
    border: '1px solid rgba(108, 92, 231, 0.3)',
    borderRadius: '6px',
    padding: '3px 8px',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    maxWidth: '100%',
    overflow: 'hidden',
  },
  projectIcon: {
    fontSize: '9px',
    flexShrink: 0,
  },
  projectText: {
    fontFamily: '"Inter", sans-serif',
    fontSize: '9px',
    color: '#a29bfe',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    fontWeight: '600',
  },
};
