import { useState, useEffect, useRef, useCallback } from 'react';

// Use same host and WebSocket path - Express handles both HTTP and WS
const WS_URL = `/ws`;

export function useAgentSocket() {
  const [agents, setAgents] = useState([]);
  const [openclaw, setOpenclaw] = useState({
    connected: false,
    status: 'disconnected',
    message: null,
  });
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      console.log('[WS] Connected to OpenClaw server');
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case 'snapshot':
          setAgents(msg.agents || []);
          if (msg.openclaw) setOpenclaw(msg.openclaw);
          break;

        case 'agent:added':
          setAgents(prev => {
            if (prev.find(a => a.id === msg.agent.id)) return prev;
            return [...prev, msg.agent];
          });
          break;

        case 'agent:updated':
          setAgents(prev =>
            prev.map(a => a.id === msg.agent.id ? { ...a, ...msg.agent } : a)
          );
          break;

        case 'agent:removed':
          setAgents(prev => prev.filter(a => a.id !== msg.id));
          break;

        case 'openclaw:status':
          setOpenclaw(msg.openclaw);
          break;
      }
    };

    ws.onclose = () => {
      setConnected(false);
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [connect]);

  return { agents, openclaw, connected };
}
