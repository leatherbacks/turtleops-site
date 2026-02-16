import { supabase } from '../supabase';
import type { Turtle } from '../types';

export interface TurtleFilters {
  searchQuery?: string; // Search by name or tag
  species?: string;
  hasName?: boolean; // True for named, false for UNNAMED-
  needsResearch?: boolean;
  limit?: number; // Number of records to return
  offset?: number; // Number of records to skip
}

export interface TurtleWithStats extends Turtle {
  observation_count?: number;
  last_observation_date?: string;
}

/**
 * Apply common turtle filters to a query
 */
function applyTurtleFilters(query: any, filters?: TurtleFilters) {
  if (!filters) return query;
  if (filters.searchQuery) {
    const sanitized = filters.searchQuery.replace(/[^a-zA-Z0-9\-\s\/]/g, '');
    if (sanitized) {
      query = query.or(
        `name.ilike.%${sanitized}%,lrf.ilike.%${sanitized}%,rrf.ilike.%${sanitized}%,rff.ilike.%${sanitized}%,lff.ilike.%${sanitized}%`
      );
    }
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
  return query;
}

/**
 * Get turtles with count in a single query (eliminates duplicate DB call)
 */
export async function getTurtlesWithCount(filters?: TurtleFilters): Promise<{ data: Turtle[]; count: number }> {
  try {
    let query = supabase
      .from('turtles')
      .select('*', { count: 'exact' })
      .order('last_encountered_at', { ascending: false, nullsFirst: false })
      .order('name', { ascending: true });

    query = applyTurtleFilters(query, filters);

    // Apply pagination
    if (filters?.offset !== undefined) {
      query = query.range(filters.offset, filters.offset + (filters.limit || 25) - 1);
    } else if (filters?.limit !== undefined) {
      query = query.limit(filters.limit);
    }

    const { data, count, error } = await query;

    if (error) {
      console.error('Error fetching turtles:', error);
      return { data: [], count: 0 };
    }

    return { data: data || [], count: count || 0 };
  } catch (error) {
    console.error('Error fetching turtles:', error);
    return { data: [], count: 0 };
  }
}

/**
 * Get all turtles with optional filters
 */
export async function getTurtles(filters?: TurtleFilters): Promise<Turtle[]> {
  const result = await getTurtlesWithCount(filters);
  return result.data;
}

/**
 * Get count of turtles matching filters
 */
export async function getTurtlesCount(filters?: TurtleFilters): Promise<number> {
  try {
    let query = supabase
      .from('turtles')
      .select('id', { count: 'exact', head: true });

    query = applyTurtleFilters(query, filters);

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
 * Search turtles by tag number (current or historical)
 */
export async function searchTurtlesByTag(tagNumber: string): Promise<Turtle[]> {
  try {
    if (!tagNumber || tagNumber.trim().length === 0) {
      return [];
    }

    const searchTerm = tagNumber.trim().replace(/[^a-zA-Z0-9\-\s\/]/g, '');
    if (!searchTerm) return [];

    // Search current tags (lrf, rrf, rff, lff)
    const { data, error } = await supabase
      .from('turtles')
      .select('*')
      .or(
        `lrf.ilike.%${searchTerm}%,rrf.ilike.%${searchTerm}%,rff.ilike.%${searchTerm}%,lff.ilike.%${searchTerm}%`
      )
      .order('name', { ascending: true });

    if (error) {
      console.error('Error searching turtles by tag:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error searching turtles by tag:', error);
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
      .order('created_at', { ascending: false });

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
      .order('created_at', { ascending: false });

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
 * Convert camelCase key to snake_case
 */
function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

/**
 * Update a turtle by ID
 */
export async function updateTurtle(
  id: string,
  updates: Record<string, any>
): Promise<Turtle | null> {
  try {
    // Convert camelCase keys to snake_case for database
    const dbUpdates: Record<string, any> = {};
    for (const [key, value] of Object.entries(updates)) {
      const snakeKey = toSnakeCase(key);
      dbUpdates[snakeKey] = value instanceof Date ? value.toISOString() : value;
    }
    dbUpdates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('turtles')
      .update(dbUpdates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating turtle:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error updating turtle:', error);
    return null;
  }
}

/**
 * Find a turtle by exact name match
 */
export async function findTurtleByName(name: string): Promise<Turtle | null> {
  try {
    const { data, error } = await supabase
      .from('turtles')
      .select('*')
      .eq('name', name.trim().toUpperCase())
      .maybeSingle();

    if (error) {
      console.error('Error finding turtle by name:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error finding turtle by name:', error);
    return null;
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
