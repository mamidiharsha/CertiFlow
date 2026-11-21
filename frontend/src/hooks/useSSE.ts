import { useEffect, useRef, useState, useCallback } from 'react';

interface SSEOptions {
  onBatchStatusChanged?: (data: Record<string, unknown>) => void;
  onCertificateIssued?: (data: Record<string, unknown>) => void;
  onMessage?: (event: string, data: Record<string, unknown>) => void;
}

export function useSSE(options: SSEOptions) {
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource('/api/events/stream', { withCredentials: true });
    eventSourceRef.current = es;

    es.onopen = () => {
      setConnected(true);
    };

    es.onerror = () => {
      setConnected(false);
      es.close();
      eventSourceRef.current = null;
      // Auto-reconnect after 3 seconds
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, 3000);
    };

    es.addEventListener('batch_status_changed', (e) => {
      try {
        const data = JSON.parse(e.data);
        optionsRef.current.onBatchStatusChanged?.(data);
        optionsRef.current.onMessage?.('batch_status_changed', data);
      } catch {
        // ignore parse errors
      }
    });

    es.addEventListener('certificate_issued', (e) => {
      try {
        const data = JSON.parse(e.data);
        optionsRef.current.onCertificateIssued?.(data);
        optionsRef.current.onMessage?.('certificate_issued', data);
      } catch {
        // ignore parse errors
      }
    });

    for (const eventName of ['certificate_cancelled', 'batch_stale', 'delivery_status_changed']) {
      es.addEventListener(eventName, (e) => {
        try {
          optionsRef.current.onMessage?.(eventName, JSON.parse(e.data));
        } catch {
          // Ignore malformed event payloads.
        }
      });
    }

    // Generic message handler
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        optionsRef.current.onMessage?.('message', data);
      } catch {
        // ignore parse errors
      }
    };
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [connect]);

  return { connected };
}
