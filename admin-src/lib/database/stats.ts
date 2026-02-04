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
 * Get comprehensive statistics for the dashboard
 */
export async function getEnhancedStats(): Promise<EnhancedStats> {
  const currentYear = new Date().getFullYear();
  const yearStart = new Date(currentYear, 0, 1).toISOString();

  // Get yesterday's date range for "last night" observations
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  const yesterdayStart = yesterday.toISOString();
  const yesterdayEnd = new Date(yesterday.getTime() + 24 * 60 * 60 * 1000).toISOString();

  try {
    // Total turtles
    const { count: totalTurtles } = await supabase
      .from('turtles')
      .select('*', { count: 'exact', head: true });

    // Observations this year
    const { count: observationsThisYear } = await supabase
      .from('observations')
      .select('*', { count: 'exact', head: true })
      .gte('encounter_date', yearStart);

    // Last night observations
    const { count: lastNightObservations } = await supabase
      .from('observations')
      .select('*', { count: 'exact', head: true })
      .gte('encounter_date', yesterdayStart)
      .lt('encounter_date', yesterdayEnd);

    // Volunteer hours and active volunteers
    const { data: sessions } = await supabase
      .from('survey_sessions')
      .select('check_in_time, check_out_time')
      .not('check_out_time', 'is', null);

    let totalHours = 0;
    let sessionCount = 0;
    if (sessions) {
      sessions.forEach((session) => {
        const checkIn = new Date(session.check_in_time);
        const checkOut = new Date(session.check_out_time!);
        const hours = (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60);
        totalHours += hours;
        sessionCount++;
      });
    }

    // Active volunteers (currently checked in)
    const { count: activeVolunteers } = await supabase
      .from('survey_sessions')
      .select('*', { count: 'exact', head: true })
      .is('check_out_time', null);

    // Average session duration
    const avgSessionDuration = sessionCount > 0 ? totalHours / sessionCount : 0;

    // Nesting success rate
    const { data: nestingObs } = await supabase
      .from('observations')
      .select('nesting_status')
      .gte('encounter_date', yearStart)
      .in('nesting_status', ['nested', 'attempted_nest']);

    const nested = nestingObs?.filter((o) => o.nesting_status === 'nested').length || 0;
    const attempted = nestingObs?.length || 0;
    const nestingSuccessRate = attempted > 0 ? (nested / attempted) * 100 : 0;

    // Recapture rate (turtles with multiple observations)
    const { data: turtleObsCounts } = await supabase
      .from('observations')
      .select('turtle_id')
      .gte('encounter_date', yearStart);

    const turtleCounts = new Map<string, number>();
    turtleObsCounts?.forEach((obs) => {
      if (obs.turtle_id) {
        turtleCounts.set(obs.turtle_id, (turtleCounts.get(obs.turtle_id) || 0) + 1);
      }
    });

    const recaptures = Array.from(turtleCounts.values()).filter((count) => count > 1).length;
    const totalWithObs = turtleCounts.size;
    const recaptureRate = totalWithObs > 0 ? (recaptures / totalWithObs) * 100 : 0;

    // Most sighted turtle
    let mostSightedTurtle: { name: string; count: number } | null = null;
    if (turtleCounts.size > 0) {
      const sortedTurtles = Array.from(turtleCounts.entries()).sort((a, b) => b[1] - a[1]);
      const [mostSightedId, count] = sortedTurtles[0];

      const { data: turtle } = await supabase
        .from('turtles')
        .select('name')
        .eq('id', mostSightedId)
        .single();

      if (turtle) {
        mostSightedTurtle = { name: turtle.name, count };
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
export async function getRecentStats(): Promise<RecentStats> {
  const currentYear = new Date().getFullYear();
  const yearStart = new Date(currentYear, 0, 1).toISOString();

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  const yesterdayStart = yesterday.toISOString();
  const yesterdayEnd = new Date(yesterday.getTime() + 24 * 60 * 60 * 1000).toISOString();

  try {
    const { count: totalTurtles } = await supabase
      .from('turtles')
      .select('*', { count: 'exact', head: true });

    const { count: observationsThisYear } = await supabase
      .from('observations')
      .select('*', { count: 'exact', head: true })
      .gte('encounter_date', yearStart);

    const { count: lastNightObservations } = await supabase
      .from('observations')
      .select('*', { count: 'exact', head: true })
      .gte('encounter_date', yesterdayStart)
      .lt('encounter_date', yesterdayEnd);

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
export async function getActiveSessionsAll(): Promise<ActiveSession[]> {
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
 * Force checkout a volunteer session
 */
export async function forceCheckoutSession(sessionId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('survey_sessions')
      .update({ check_out_time: new Date().toISOString() })
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
