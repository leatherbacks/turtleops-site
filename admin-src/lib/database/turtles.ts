import { supabase } from '../supabase';
import type { Turtle } from '../types';

export interface TurtleFilters {
  searchQuery?: string; // Search by name or tag
  species?: string;
  hasName?: boolean; // True for named, false for UNNAMED-
  needsResearch?: boolean;
}

export interface TurtleWithStats extends Turtle {
  observation_count?: number;
  last_observation_date?: string;
}

/**
 * Get all turtles with optional filters
 */
export async function getTurtles(filters?: TurtleFilters): Promise<Turtle[]> {
  try {
    let query = supabase
      .from('turtles')
      .select('*')
      .order('name', { ascending: true });

    // Apply filters
    if (filters) {
      if (filters.searchQuery) {
        // Search across name and tag fields
        query = query.or(
          `name.ilike.%${filters.searchQuery}%,lrf.ilike.%${filters.searchQuery}%,rrf.ilike.%${filters.searchQuery}%,rff.ilike.%${filters.searchQuery}%,lff.ilike.%${filters.searchQuery}%`
        );
      }
      if (filters.species) {
        query = query.eq('species', filters.species);
      }
      if (filters.hasName !== undefined) {
        if (filters.hasName) {
          query = query.not('name', 'ilike', 'UNNAMED-%');
        } else {
          query = query.ilike('name', 'UNNAMED-%');
        }
      }
      if (filters.needsResearch !== undefined) {
        query = query.eq('needs_research', filters.needsResearch);
      }
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching turtles:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching turtles:', error);
    return [];
  }
}

/**
 * Get count of turtles matching filters
 */
export async function getTurtlesCount(filters?: TurtleFilters): Promise<number> {
  try {
    let query = supabase
      .from('turtles')
      .select('id', { count: 'exact', head: true });

    // Apply same filters as getTurtles
    if (filters) {
      if (filters.searchQuery) {
        query = query.or(
          `name.ilike.%${filters.searchQuery}%,lrf.ilike.%${filters.searchQuery}%,rrf.ilike.%${filters.searchQuery}%,rff.ilike.%${filters.searchQuery}%,lff.ilike.%${filters.searchQuery}%`
        );
      }
      if (filters.species) {
        query = query.eq('species', filters.species);
      }
      if (filters.hasName !== undefined) {
        if (filters.hasName) {
          query = query.not('name', 'ilike', 'UNNAMED-%');
        } else {
          query = query.ilike('name', 'UNNAMED-%');
        }
      }
      if (filters.needsResearch !== undefined) {
        query = query.eq('needs_research', filters.needsResearch);
      }
    }

    const { count, error } = await query;

    if (error) {
      console.error('Error counting turtles:', error);
      return 0;
    }

    return count || 0;
  } catch (error) {
    console.error('Error counting turtles:', error);
    return 0;
  }
}

/**
 * Get single turtle by ID
 */
export async function getTurtleById(id: string): Promise<Turtle | null> {
  try {
    const { data, error } = await supabase
      .from('turtles')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching turtle:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error fetching turtle:', error);
    return null;
  }
}

/**
 * Get turtles with temporary UNNAMED- names
 */
export async function getUnnamedTurtles(): Promise<Turtle[]> {
  try {
    const { data, error } = await supabase
      .from('turtles')
      .select('*')
      .ilike('name', 'UNNAMED-%')
      .order('first_encountered_at', { ascending: false });

    if (error) {
      console.error('Error fetching unnamed turtles:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching unnamed turtles:', error);
    return [];
  }
}

/**
 * Get turtles flagged for research
 */
export async function getTurtlesNeedingResearch(): Promise<Turtle[]> {
  try {
    const { data, error } = await supabase
      .from('turtles')
      .select('*')
      .eq('needs_research', true)
      .order('research_flagged_at', { ascending: false });

    if (error) {
      console.error('Error fetching turtles needing research:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching turtles needing research:', error);
    return [];
  }
}

/**
 * Get tag history for a turtle
 */
export async function getTagHistoryForTurtle(turtleId: string) {
  try {
    const { data, error } = await supabase
      .from('tag_history')
      .select('*')
      .eq('turtle_id', turtleId)
      .order('changed_at', { ascending: false });

    if (error) {
      console.error('Error fetching tag history:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching tag history:', error);
    return [];
  }
}

/**
 * Get additional tags for a turtle
 */
export async function getAdditionalTagsForTurtle(turtleId: string) {
  try {
    const { data, error } = await supabase
      .from('turtle_additional_tags')
      .select('*')
      .eq('turtle_id', turtleId)
      .order('added_at', { ascending: false });

    if (error) {
      console.error('Error fetching additional tags:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching additional tags:', error);
    return [];
  }
}

/**
 * Export turtles to CSV format
 */
export function exportTurtlesToCSV(turtles: Turtle[]): string {
  const headers = [
    'ID',
    'Name',
    'Species',
    'LRF',
    'RRF',
    'RFF',
    'LFF',
    'First Encountered',
    'Last Encountered',
    'Encounter Count',
    'Needs Research',
    'Suggested Name',
  ];

  const rows = turtles.map(turtle => [
    turtle.id,
    turtle.name || '',
    turtle.species || '',
    turtle.lrf || '',
    turtle.rrf || '',
    turtle.rff || '',
    turtle.lff || '',
    turtle.first_encountered_at ? new Date(turtle.first_encountered_at).toLocaleDateString() : '',
    turtle.last_encountered_at ? new Date(turtle.last_encountered_at).toLocaleDateString() : '',
    turtle.encounter_count || 0,
    turtle.needs_research ? 'Yes' : 'No',
    turtle.suggested_name || '',
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.join(','))
  ].join('\n');

  return csvContent;
}
