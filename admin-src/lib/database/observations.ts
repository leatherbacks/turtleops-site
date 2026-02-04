import { supabase } from '../supabase';
import type { Observation } from '../types';

export interface ObservationFilters {
  turtleName?: string;
  observerName?: string;
  species?: string;
  dateFrom?: Date;
  dateTo?: Date;
  didNest?: boolean;
  beachSector?: string;
  searchQuery?: string;
  limit?: number;
  offset?: number;
}

export interface ObservationWithTurtle extends Observation {
  species?: string;
}

/**
 * Enhance observation with species from turtle join
 */
function enhanceWithSpecies(data: any): ObservationWithTurtle {
  const obs = { ...data } as ObservationWithTurtle;
  // Add species from joined turtles table
  if (data.turtles && data.turtles.species) {
    obs.species = data.turtles.species;
  }
  return obs;
}

/**
 * Get all observations with optional filters
 */
export async function getObservations(filters?: ObservationFilters): Promise<ObservationWithTurtle[]> {
  try {
    let query = supabase
      .from('observations')
      .select(`
        *,
        turtles!inner(species)
      `)
      .order('encounter_date', { ascending: false });

    // Apply filters
    if (filters) {
      if (filters.turtleName) {
        query = query.ilike('turtle_name', `%${filters.turtleName}%`);
      }
      if (filters.observerName) {
        query = query.ilike('observer_name', `%${filters.observerName}%`);
      }
      if (filters.dateFrom) {
        query = query.gte('encounter_date', filters.dateFrom.toISOString());
      }
      if (filters.dateTo) {
        query = query.lte('encounter_date', filters.dateTo.toISOString());
      }
      if (filters.didNest !== undefined) {
        query = query.eq('did_she_nest', filters.didNest);
      }
      if (filters.beachSector) {
        query = query.eq('beach_sector', filters.beachSector);
      }
      if (filters.searchQuery) {
        query = query.or(
          `turtle_name.ilike.%${filters.searchQuery}%,observer_name.ilike.%${filters.searchQuery}%,comments.ilike.%${filters.searchQuery}%`
        );
      }
      // Apply pagination
      if (filters.limit !== undefined) {
        query = query.limit(filters.limit);
      }
      if (filters.offset !== undefined) {
        query = query.range(filters.offset, filters.offset + (filters.limit || 25) - 1);
      }
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching observations:', error);
      return [];
    }

    return data ? data.map(enhanceWithSpecies) : [];
  } catch (error) {
    console.error('Error fetching observations:', error);
    return [];
  }
}

/**
 * Get a single observation by ID
 */
export async function getObservationById(id: string): Promise<ObservationWithTurtle | null> {
  try {
    const { data, error } = await supabase
      .from('observations')
      .select(`
        *,
        turtles!inner(species, name, lrf, rrf, rff, lff)
      `)
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching observation:', error);
      return null;
    }

    return enhanceWithSpecies(data);
  } catch (error) {
    console.error('Error fetching observation:', error);
    return null;
  }
}

/**
 * Get observations for a specific turtle
 */
export async function getObservationsByTurtle(turtleId: string): Promise<ObservationWithTurtle[]> {
  try {
    const { data, error } = await supabase
      .from('observations')
      .select(`
        *,
        turtles!inner(species)
      `)
      .eq('turtle_id', turtleId)
      .order('encounter_date', { ascending: false });

    if (error) {
      console.error('Error fetching turtle observations:', error);
      return [];
    }

    return data ? data.map(enhanceWithSpecies) : [];
  } catch (error) {
    console.error('Error fetching turtle observations:', error);
    return [];
  }
}

/**
 * Get recent observations (last 30 days)
 */
export async function getRecentObservations(days: number = 30): Promise<ObservationWithTurtle[]> {
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - days);

  return getObservations({ dateFrom });
}

/**
 * Get observations count by filters
 */
export async function getObservationsCount(filters?: ObservationFilters): Promise<number> {
  try {
    let query = supabase
      .from('observations')
      .select('id', { count: 'exact', head: true });

    // Apply same filters as getObservations
    if (filters) {
      if (filters.turtleName) {
        query = query.ilike('turtle_name', `%${filters.turtleName}%`);
      }
      if (filters.observerName) {
        query = query.ilike('observer_name', `%${filters.observerName}%`);
      }
      if (filters.dateFrom) {
        query = query.gte('encounter_date', filters.dateFrom.toISOString());
      }
      if (filters.dateTo) {
        query = query.lte('encounter_date', filters.dateTo.toISOString());
      }
      if (filters.didNest !== undefined) {
        query = query.eq('did_she_nest', filters.didNest);
      }
      if (filters.beachSector) {
        query = query.eq('beach_sector', filters.beachSector);
      }
    }

    const { count, error } = await query;

    if (error) {
      console.error('Error counting observations:', error);
      return 0;
    }

    return count || 0;
  } catch (error) {
    console.error('Error counting observations:', error);
    return 0;
  }
}

/**
 * Export observations to CSV format
 */
export function exportObservationsToCSV(observations: ObservationWithTurtle[]): string {
  const headers = [
    'ID',
    'Turtle Name',
    'Species',
    'Encounter Date',
    'Observer',
    'Beach Sector',
    'Did Nest',
    'Egg Count',
    'LRF',
    'RRF',
    'RFF',
    'LFF',
    'Temperature',
    'Tide Stage',
    'Latitude',
    'Longitude',
    'Comments',
  ];

  const rows = observations.map(obs => [
    obs.id,
    obs.turtle_name || '',
    obs.species || '',
    obs.encounter_date ? new Date(obs.encounter_date).toLocaleDateString() : '',
    obs.observer_name || '',
    obs.beach_sector || '',
    obs.did_she_nest === true ? 'Yes' : obs.did_she_nest === false ? 'No' : '',
    obs.egg_count || '',
    obs.tag_lrf || '',
    obs.tag_rrf || '',
    obs.tag_rff || '',
    obs.tag_lff || '',
    obs.temperature || '',
    obs.tide_stage || '',
    obs.latitude || '',
    obs.longitude || '',
    obs.comments ? `"${obs.comments.replace(/"/g, '""')}"` : '',
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.join(','))
  ].join('\n');

  return csvContent;
}
