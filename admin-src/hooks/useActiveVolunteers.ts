import { useState, useEffect, useCallback } from 'react';
import { getActiveSessionsAll, forceCheckoutSession } from '@/lib/database/stats';

interface ActiveSession {
  id: string;
  surveyor: {
    id: string;
    full_name: string;
  };
  check_in_time: string;
  location?: {
    latitude: number;
    longitude: number;
  };
  elapsed_hours: number;
}

interface UseActiveVolunteersOptions {
  autoRefresh?: boolean;
  refreshInterval?: number; // in milliseconds, default 30000 (30s)
}

interface UseActiveVolunteersReturn {
  sessions: ActiveSession[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  forceCheckout: (sessionId: string) => Promise<boolean>;
}

/**
 * Hook to fetch and manage active volunteer sessions with auto-refresh
 */
export function useActiveVolunteers(
  options: UseActiveVolunteersOptions = {}
): UseActiveVolunteersReturn {
  const { autoRefresh = true, refreshInterval = 30000 } = options;

  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      setError(null);
      const data = await getActiveSessionsAll();
      setSessions(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch active sessions'));
      console.error('Error fetching active sessions:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleForceCheckout = useCallback(
    async (sessionId: string): Promise<boolean> => {
      const success = await forceCheckoutSession(sessionId);
      if (success) {
        // Refresh the list after checkout
        await fetchSessions();
      }
      return success;
    },
    [fetchSessions]
  );

  // Initial fetch
  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchSessions();
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, fetchSessions]);

  return {
    sessions,
    loading,
    error,
    refresh: fetchSessions,
    forceCheckout: handleForceCheckout,
  };
}
