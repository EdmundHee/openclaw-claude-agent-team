import { useState, useEffect } from 'react';
import Dashboard from './components/Dashboard.jsx';
import { useAgentSocket } from './hooks/useAgentSocket.js';

// Global animation keyframes
const globalStyles = `
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0f0f1a; overflow-x: hidden; }
`;

export default function App() {
  const { agents, connected } = useAgentSocket();
  const [demoMode, setDemoMode] = useState(false);
  const [demoAgents, setDemoAgents] = useState([]);

  // Toggle demo mode if no real agents
  useEffect(() => {
    if (demoMode) {
      // Simulate agents for preview/development
      const demo = [
        { id: 'demo-1', name: 'researcher', status: 'working', tool: 'WebSearch', toolStatus: 'Searching: React patterns', createdAt: 1 },
        { id: 'demo-2', name: 'coder', status: 'working', tool: 'Edit', toolStatus: 'Editing App.jsx', createdAt: 2 },
        { id: 'demo-3', name: 'reviewer', status: 'idle', tool: null, createdAt: 3 },
        { id: 'demo-4', name: 'tester', status: 'waiting', tool: null, createdAt: 4 },
        { id: 'demo-5', name: 'deployer', status: 'idle', tool: null, createdAt: 5 },
      ];
      setDemoAgents(demo);

      // Simulate activity
      const interval = setInterval(() => {
        setDemoAgents(prev => prev.map(a => {
          const rand = Math.random();
          if (rand < 0.1) {
            return { ...a, status: 'working', tool: 'Bash', toolStatus: 'Running tests' };
          } else if (rand < 0.15) {
            return { ...a, status: 'idle', tool: null, toolStatus: null };
          }
          return a;
        }));
      }, 3000);

      return () => clearInterval(interval);
    }
  }, [demoMode]);

  const displayAgents = demoMode ? demoAgents : agents;

  return (
    <>
      <style>{globalStyles}</style>
      <Dashboard agents={displayAgents} />

      {/* Connection status + demo toggle */}
      <div style={styles.statusBar}>
        <div style={styles.connectionStatus}>
          <div style={{
            ...styles.connectionDot,
            backgroundColor: connected ? '#00b894' : '#e17055',
          }} />
          <span style={styles.connectionText}>
            {connected ? 'Connected' : 'Reconnecting...'}
          </span>
        </div>

        <button
          onClick={() => setDemoMode(!demoMode)}
          style={styles.demoButton}
        >
          {demoMode ? 'LIVE MODE' : 'DEMO MODE'}
        </button>
      </div>
    </>
  );
}

const styles = {
  statusBar: {
    position: 'fixed',
    bottom: '12px',
    right: '16px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    zIndex: 100,
  },
  connectionStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    background: 'rgba(15, 15, 26, 0.9)',
    padding: '6px 12px',
    borderRadius: '8px',
    border: '1px solid #1a1a2e',
  },
  connectionDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
  },
  connectionText: {
    fontFamily: '"Inter", sans-serif',
    fontSize: '11px',
    color: '#636e72',
  },
  demoButton: {
    fontFamily: '"Press Start 2P", monospace',
    fontSize: '8px',
    color: '#b2bec3',
    background: 'rgba(15, 15, 26, 0.9)',
    border: '1px solid #1a1a2e',
    borderRadius: '8px',
    padding: '8px 12px',
    cursor: 'pointer',
    letterSpacing: '1px',
    transition: 'all 0.2s',
  },
};
