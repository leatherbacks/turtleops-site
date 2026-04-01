import { useState, useEffect, useCallback, useRef } from 'react';
import { getEnhancedStats, getRecentStats } from '@/lib/database/stats';

// Module-level cache — survives component remounts and page navigations
const statsCache: {
  data: EnhancedStats | null;
  timestamp: number;
} = { data: null, timestamp: 0 };

const CACHE_TTL = 60_000; // 1 minute

interface EnhancedStats {
  totalTurtles: number;
  observationsThisYear: number;
  lastNightObservations: number;
  volunteerHours: number;
  activeVolunteers: number;
  avgSessionDuration: number;
  nestingSuccessRate: number;
  recaptureRate: number;
  mostSightedTurtle: {
    name: string;
    count: number;
  } | null;
}

interface RecentStats {
  totalTurtles: number;
  observationsThisYear: number;
  lastNightObservations: number;
}

interface UseStatsOptions {
  orgId?: string;
  autoRefresh?: boolean;
  refreshInterval?: number; // in milliseconds
}

interface UseStatsReturn {
  stats: EnhancedStats | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

/**
 * Hook to fetch and manage enhanced statistics with auto-refresh support
 */
export function useStats(options: UseStatsOptions = {}): UseStatsReturn {
  const { orgId, autoRefresh = false, refreshInterval = 30000 } = options;

  const isCacheValid = statsCache.data && (Date.now() - statsCache.timestamp) < CACHE_TTL;
  const [stats, setStats] = useState<EnhancedStats | null>(isCacheValid ? statsCache.data : null);
  const [loading, setLoading] = useState(!isCacheValid);
  const [error, setError] = useState<Error | null>(null);

  const fetchStats = useCallback(async () => {
    if (!orgId) return;
    try {
      setError(null);
      const data = await getEnhancedStats(orgId);
      statsCache.data = data;
      statsCache.timestamp = Date.now();
      setStats(data);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err : new Error('Failed to fetch stats'));
      console.error('Error fetching stats:', err);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  // Initial fetch — skip if cache is fresh or orgId not yet available
  useEffect(() => {
    if (!orgId) return;

    if (statsCache.data && (Date.now() - statsCache.timestamp) < CACHE_TTL) {
      setStats(statsCache.data);
      setLoading(false);
      return;
    }

    let isMounted = true;

    const loadStats = async () => {
      try {
        setError(null);
        const data = await getEnhancedStats(orgId);
        if (isMounted) {
          statsCache.data = data;
          statsCache.timestamp = Date.now();
          setStats(data);
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        if (isMounted) {
          setError(err instanceof Error ? err : new Error('Failed to fetch stats'));
          console.error('Error fetching stats:', err);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadStats();

    return () => {
      isMounted = false;
    };
  }, [orgId]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;

    let isMounted = true;

    const interval = setInterval(() => {
      if (isMounted) {
        fetchStats();
      }
    }, refreshInterval);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [autoRefresh, refreshInterval, fetchStats]);

  return {
    stats,
    loading,
    error,
    refresh: fetchStats,
  };
}

interface UseRecentStatsReturn {
  stats: RecentStats | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

/**
 * Hook to fetch basic recent statistics (lighter than enhanced stats)
 */
export function useRecentStats(options: UseStatsOptions = {}): UseRecentStatsReturn {
  const { orgId, autoRefresh = false, refreshInterval = 30000 } = options;

  const [stats, setStats] = useState<RecentStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchStats = useCallback(async () => {
    if (!orgId) return;
    try {
      setError(null);
      const data = await getRecentStats(orgId);
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch recent stats'));
      console.error('Error fetching recent stats:', err);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  // Initial fetch
  useEffect(() => {
    if (orgId) fetchStats();
  }, [fetchStats, orgId]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;

    let isMounted = true;

    const interval = setInterval(() => {
      if (isMounted) {
        fetchStats();
      }
    }, refreshInterval);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [autoRefresh, refreshInterval, fetchStats]);

  return {
    stats,
    loading,
    error,
    refresh: fetchStats,
  };
}
