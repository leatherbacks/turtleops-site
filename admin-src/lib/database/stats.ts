import { supabase } from '../supabase';
import type { Observation, Turtle, SurveySession } from '../types';

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

/**
 * Get comprehensive statistics for the dashboard.
 * Fetches turtle_name alongside turtle_id to avoid a sequential follow-up query.
 */
export async function getEnhancedStats(orgId: string): Promise<EnhancedStats> {
  const currentYear = new Date().getFullYear();
  const yearStart = new Date(currentYear, 0, 1).toISOString();

  // Get yesterday's date range for "last night" observations
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  const yesterdayStart = yesterday.toISOString();
  const yesterdayEnd = new Date(yesterday.getTime() + 24 * 60 * 60 * 1000).toISOString();

  try {
    // All queries in a single parallel batch — no sequential follow-ups
    const [
      { count: totalTurtles },
      { count: observationsThisYear },
      { count: lastNightObservations },
      { data: sessions },
      { count: activeVolunteers },
      { data: nestingObs },
      { data: turtleObsCounts },
    ] = await Promise.all([
      supabase.from('turtles').select('*', { count: 'exact', head: true }).eq('org_id', orgId),
      supabase.from('observations').select('*', { count: 'exact', head: true }).eq('org_id', orgId).gte('encounter_date', yearStart),
      supabase.from('observations').select('*', { count: 'exact', head: true }).eq('org_id', orgId).gte('encounter_date', yesterdayStart).lt('encounter_date', yesterdayEnd),
      supabase.from('survey_sessions').select('check_in_time, check_out_time').eq('org_id', orgId).not('check_out_time', 'is', null).gte('check_in_time', yearStart),
      supabase.from('survey_sessions').select('*', { count: 'exact', head: true }).eq('org_id', orgId).is('check_out_time', null),
      supabase.from('observations').select('nesting_status').eq('org_id', orgId).gte('encounter_date', yearStart).in('nesting_status', ['nested', 'attempted_nest']),
      // Only fetch turtle_id to minimize payload — resolve name with a single follow-up
      supabase.from('observations').select('turtle_id').eq('org_id', orgId).gte('encounter_date', yearStart).not('turtle_id', 'is', null),
    ]);

    // Calculate volunteer hours
    let totalHours = 0;
    let sessionCount = 0;
    if (sessions) {
      sessions.forEach((session: any) => {
        const checkIn = new Date(session.check_in_time);
        const checkOut = new Date(session.check_out_time!);
        const hours = (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60);
        totalHours += hours;
        sessionCount++;
      });
    }

    const avgSessionDuration = sessionCount > 0 ? totalHours / sessionCount : 0;

    // Nesting success rate
    const nested = nestingObs?.filter((o: any) => o.nesting_status === 'nested').length || 0;
    const attempted = nestingObs?.length || 0;
    const nestingSuccessRate = attempted > 0 ? (nested / attempted) * 100 : 0;

    // Count observations per turtle (only turtle_id in payload — minimal data transfer)
    const turtleCounts = new Map<string, number>();
    turtleObsCounts?.forEach((obs: any) => {
      if (obs.turtle_id) {
        turtleCounts.set(obs.turtle_id, (turtleCounts.get(obs.turtle_id) || 0) + 1);
      }
    });

    const recaptures = Array.from(turtleCounts.values()).filter((count) => count > 1).length;
    const totalWithObs = turtleCounts.size;
    const recaptureRate = totalWithObs > 0 ? (recaptures / totalWithObs) * 100 : 0;

    // Most sighted turtle — fetch name only for the single winner
    let mostSightedTurtle: { name: string; count: number } | null = null;
    if (turtleCounts.size > 0) {
      const sortedTurtles = Array.from(turtleCounts.entries()).sort((a, b) => b[1] - a[1]);
      const [mostSightedId, count] = sortedTurtles[0];
      const { data: turtleData } = await supabase
        .from('turtles')
        .select('name')
        .eq('id', mostSightedId)
        .single();
      if (turtleData?.name) {
        mostSightedTurtle = { name: turtleData.name, count };
      }
    }

    return {
      totalTurtles: totalTurtles || 0,
      observationsThisYear: observationsThisYear || 0,
      lastNightObservations: lastNightObservations || 0,
      volunteerHours: Math.round(totalHours * 10) / 10,
      activeVolunteers: activeVolunteers || 0,
      avgSessionDuration: Math.round(avgSessionDuration * 10) / 10,
      nestingSuccessRate: Math.round(nestingSuccessRate * 10) / 10,
      recaptureRate: Math.round(recaptureRate * 10) / 10,
      mostSightedTurtle,
    };
  } catch (error) {
    console.error('Error fetching enhanced stats:', error);
    return {
      totalTurtles: 0,
      observationsThisYear: 0,
      lastNightObservations: 0,
      volunteerHours: 0,
      activeVolunteers: 0,
      avgSessionDuration: 0,
      nestingSuccessRate: 0,
      recaptureRate: 0,
      mostSightedTurtle: null,
    };
  }
}

/**
 * Get basic recent statistics
 */
export async function getRecentStats(orgId: string): Promise<RecentStats> {
  const currentYear = new Date().getFullYear();
  const yearStart = new Date(currentYear, 0, 1).toISOString();

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  const yesterdayStart = yesterday.toISOString();
  const yesterdayEnd = new Date(yesterday.getTime() + 24 * 60 * 60 * 1000).toISOString();

  try {
    const [
      { count: totalTurtles },
      { count: observationsThisYear },
      { count: lastNightObservations },
    ] = await Promise.all([
      supabase.from('turtles').select('*', { count: 'exact', head: true }).eq('org_id', orgId),
      supabase.from('observations').select('*', { count: 'exact', head: true }).eq('org_id', orgId).gte('encounter_date', yearStart),
      supabase.from('observations').select('*', { count: 'exact', head: true }).eq('org_id', orgId).gte('encounter_date', yesterdayStart).lt('encounter_date', yesterdayEnd),
    ]);

    return {
      totalTurtles: totalTurtles || 0,
      observationsThisYear: observationsThisYear || 0,
      lastNightObservations: lastNightObservations || 0,
    };
  } catch (error) {
    console.error('Error fetching recent stats:', error);
    return {
      totalTurtles: 0,
      observationsThisYear: 0,
      lastNightObservations: 0,
    };
  }
}

/**
 * Get all currently active survey sessions (checked in volunteers)
 */
export async function getActiveSessionsAll(orgId: string): Promise<ActiveSession[]> {
  try {
    const { data: sessions, error } = await supabase
      .from('survey_sessions')
      .select(`
        id,
        surveyor_id,
        surveyor_name,
        check_in_time,
        location_lat,
        location_lon
      `)
      .eq('org_id', orgId)
      .is('check_out_time', null)
      .order('check_in_time', { ascending: false });

    if (error) {
      console.error('Error fetching active sessions:', error);
      return [];
    }

    if (!sessions) return [];

    const now = new Date();
    return sessions.map((session: any) => {
      const checkInTime = new Date(session.check_in_time);
      const elapsedMs = now.getTime() - checkInTime.getTime();
      const elapsedHours = elapsedMs / (1000 * 60 * 60);

      const location =
        session.location_lat && session.location_lon
          ? {
              latitude: parseFloat(session.location_lat),
              longitude: parseFloat(session.location_lon),
            }
          : undefined;

      return {
        id: session.id,
        surveyor: {
          id: session.surveyor_id,
          full_name: session.surveyor_name || 'Unknown',
        },
        check_in_time: session.check_in_time,
        location,
        elapsed_hours: Math.round(elapsedHours * 10) / 10,
      };
    });
  } catch (error) {
    console.error('Error fetching active sessions:', error);
    return [];
  }
}

/**
 * Get recent observations for dashboard activity feed
 */
export async function getRecentActivity(orgId: string, limit: number = 10): Promise<{
  id: string;
  turtle_name: string | null;
  encounter_date: string;
  observer_name: string;
  did_she_nest: boolean | null;
  is_recapture: boolean;
  beach_sector: string | null;
}[]> {
  try {
    const { data, error } = await supabase
      .from('observations')
      .select('id, turtle_name, encounter_date, observer_name, did_she_nest, is_recapture, beach_sector')
      .eq('org_id', orgId)
      .order('encounter_date', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching recent activity:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching recent activity:', error);
    return [];
  }
}

/**
 * Get counts for action items (unnamed turtles, research flags, active alerts)
 */
export async function getActionItemCounts(orgId: string): Promise<{
  unnamedTurtles: number;
  researchFlags: number;
  activeAlerts: number;
}> {
  try {
    const [unnamed, research, alerts] = await Promise.all([
      supabase.from('turtles').select('id', { count: 'exact', head: true }).eq('org_id', orgId).ilike('name', 'UNNAMED-%'),
      supabase.from('turtles').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('needs_research', true),
      supabase.from('turtle_alerts').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('is_active', true),
    ]);

    return {
      unnamedTurtles: unnamed.count || 0,
      researchFlags: research.count || 0,
      activeAlerts: alerts.count || 0,
    };
  } catch (error) {
    console.error('Error fetching action item counts:', error);
    return { unnamedTurtles: 0, researchFlags: 0, activeAlerts: 0 };
  }
}

/**
 * Get last year's observation count for season comparison
 */
export async function getLastYearObservationCount(orgId: string): Promise<number> {
  try {
    const lastYear = new Date().getFullYear() - 1;
    const yearStart = new Date(lastYear, 0, 1).toISOString();
    const yearEnd = new Date(lastYear + 1, 0, 1).toISOString();

    const { count, error } = await supabase
      .from('observations')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .gte('encounter_date', yearStart)
      .lt('encounter_date', yearEnd);

    if (error) {
      console.error('Error fetching last year count:', error);
      return 0;
    }

    return count || 0;
  } catch (error) {
    console.error('Error fetching last year count:', error);
    return 0;
  }
}

/**
 * Get observations with GPS coordinates for the map view
 */
export async function getMapObservations(orgId: string, filters?: {
  yearFrom?: number;
  yearTo?: number;
  didNest?: boolean;
  species?: string;
}): Promise<{
  id: string;
  turtle_name: string | null;
  encounter_date: string;
  latitude: number;
  longitude: number;
  did_she_nest: boolean | null;
  is_recapture: boolean;
  beach_sector: string | null;
  observer_name: string;
  species: string | null;
}[]> {
  try {
    let query = supabase
      .from('observations')
      .select('id, turtle_name, encounter_date, latitude, longitude, did_she_nest, is_recapture, beach_sector, observer_name, turtles(species)')
      .eq('org_id', orgId)
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
      .order('encounter_date', { ascending: false })
      .limit(500);

    if (filters?.yearFrom) {
      query = query.gte('encounter_date', new Date(filters.yearFrom, 0, 1).toISOString());
    }
    if (filters?.yearTo) {
      query = query.lt('encounter_date', new Date(filters.yearTo + 1, 0, 1).toISOString());
    }
    if (filters?.didNest !== undefined) {
      query = query.eq('did_she_nest', filters.didNest);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching map observations:', error);
      return [];
    }

    return (data || []).map((obs: any) => ({
      id: obs.id,
      turtle_name: obs.turtle_name,
      encounter_date: obs.encounter_date,
      latitude: obs.latitude,
      longitude: obs.longitude,
      did_she_nest: obs.did_she_nest,
      is_recapture: obs.is_recapture,
      beach_sector: obs.beach_sector,
      observer_name: obs.observer_name,
      species: obs.turtles?.species || null,
    }));
  } catch (error) {
    console.error('Error fetching map observations:', error);
    return [];
  }
}

/**
 * Force checkout a volunteer session
 */
export async function forceCheckoutSession(orgId: string, sessionId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('survey_sessions')
      .update({ check_out_time: new Date().toISOString() })
      .eq('org_id', orgId)
      .eq('id', sessionId);

    if (error) {
      console.error('Error forcing checkout:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error forcing checkout:', error);
    return false;
  }
}
