import { useEffect, useRef, useState } from 'react';
import type { LogDto } from '@youtubeca/shared';
import { logStreamUrl } from '../lib/api';

/** SSE 실시간 로그 tail (§7.4 ③) */
export function useLogStream(options: { runId?: number; level?: string; enabled: boolean; max?: number }) {
  const [logs, setLogs] = useState<LogDto[]>([]);
  const [connected, setConnected] = useState(false);
  const max = options.max ?? 500;
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!options.enabled) {
      sourceRef.current?.close();
      sourceRef.current = null;
      setConnected(false);
      return;
    }

    const source = new EventSource(logStreamUrl({ runId: options.runId, level: options.level }));
    sourceRef.current = source;

    source.addEventListener('ready', () => setConnected(true));
    source.addEventListener('log', (event) => {
      try {
        const log = JSON.parse((event as MessageEvent<string>).data) as LogDto;
        setLogs((prev) => [...prev, log].slice(-max));
      } catch {
        // 형식이 깨진 이벤트는 무시한다
      }
    });
    source.onerror = () => setConnected(false);

    return () => {
      source.close();
      sourceRef.current = null;
      setConnected(false);
    };
  }, [options.enabled, options.runId, options.level, max]);

  return { logs, connected, clear: () => setLogs([]) };
}
