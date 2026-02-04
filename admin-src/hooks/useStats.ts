import { useState, useEffect, useCallback } from 'react';
import { getEnhancedStats, getRecentStats } from '@/lib/database/stats';

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
  const { autoRefresh = false, refreshInterval = 30000 } = options;

  const [stats, setStats] = useState<EnhancedStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      setError(null);
      const data = await getEnhancedStats();
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch stats'));
      console.error('Error fetching stats:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchStats();
    }, refreshInterval);

    return () => clearInterval(interval);
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
  const { autoRefresh = false, refreshInterval = 30000 } = options;

  const [stats, setStats] = useState<RecentStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      setError(null);
      const data = await getRecentStats();
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch recent stats'));
      console.error('Error fetching recent stats:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchStats();
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, fetchStats]);

  return {
    stats,
    loading,
    error,
    refresh: fetchStats,
  };
}
