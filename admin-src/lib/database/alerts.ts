import { supabase } from '../supabase';
import type { TurtleAlert } from '../types';

/**
 * Map Supabase snake_case columns to TurtleAlert interface
 */
function mapSupabaseAlert(data: any): any {
  return {
    id: data.id,
    org_id: data.org_id,
    turtleId: data.turtle_id,
    turtleName: data.turtles?.name || 'Unknown',
    type: data.alert_type,
    priority: data.priority,
    message: data.message,
    isActive: data.is_active,
    createdBy: data.created_by,
    createdByName: data.created_by_name,
    createdAt: new Date(data.created_at),
    updatedAt: new Date(data.updated_at),
  };
}

/**
 * Get all turtle alerts
 */
export async function getAllAlerts(): Promise<TurtleAlert[]> {
  try {
    const { data, error } = await supabase
      .from('turtle_alerts')
      .select('*, turtles(name)')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching alerts:', error);
      return [];
    }

    return data ? data.map(mapSupabaseAlert) : [];
  } catch (error) {
    console.error('Error fetching alerts:', error);
    return [];
  }
}

/**
 * Get alerts for a specific turtle
 */
export async function getAlertsForTurtle(turtleId: string): Promise<TurtleAlert[]> {
  try {
    const { data, error } = await supabase
      .from('turtle_alerts')
      .select('*, turtles(name)')
      .eq('turtle_id', turtleId)
      .eq('is_active', true)
      .order('priority', { ascending: false });

    if (error) {
      console.error('Error fetching turtle alerts:', error);
      return [];
    }

    return data ? data.map(mapSupabaseAlert) : [];
  } catch (error) {
    console.error('Error fetching turtle alerts:', error);
    return [];
  }
}

/**
 * Create a new turtle alert
 */
export async function createTurtleAlert(alert: {
  orgId: string;
  turtleId: string;
  type: 'named_by' | 'health_note' | 'custom';
  priority: 'low' | 'normal' | 'high';
  message: string;
  isActive: boolean;
  createdBy: string;
  createdByName: string;
}): Promise<TurtleAlert | null> {
  try {
    const { data, error } = await supabase
      .from('turtle_alerts')
      .insert({
        org_id: alert.orgId,
        turtle_id: alert.turtleId,
        alert_type: alert.type,
        priority: alert.priority,
        message: alert.message,
        is_active: alert.isActive,
        created_by: alert.createdBy,
        created_by_name: alert.createdByName,
      })
      .select('*, turtles(name)')
      .single();

    if (error) {
      console.error('[createTurtleAlert] Error:', error);
      return null;
    }

    return data ? mapSupabaseAlert(data) : null;
  } catch (error) {
    console.error('[createTurtleAlert] Caught exception:', error);
    return null;
  }
}

/**
 * Update a turtle alert
 */
export async function updateTurtleAlert(
  id: string,
  updates: {
    type?: 'named_by' | 'health_note' | 'custom';
    priority?: 'low' | 'normal' | 'high';
    message?: string;
    isActive?: boolean;
  }
): Promise<TurtleAlert | null> {
  try {
    const sbUpdates: any = {
      updated_at: new Date().toISOString(),
    };

    if (updates.type !== undefined) sbUpdates.alert_type = updates.type;
    if (updates.priority !== undefined) sbUpdates.priority = updates.priority;
    if (updates.message !== undefined) sbUpdates.message = updates.message;
    if (updates.isActive !== undefined) sbUpdates.is_active = updates.isActive;

    const { data, error } = await supabase
      .from('turtle_alerts')
      .update(sbUpdates)
      .eq('id', id)
      .select('*, turtles(name)')
      .single();

    if (error) {
      console.error('Error updating alert:', error);
      return null;
    }

    return data ? mapSupabaseAlert(data) : null;
  } catch (error) {
    console.error('Error updating alert:', error);
    return null;
  }
}

/**
 * Delete a turtle alert
 */
export async function deleteTurtleAlert(id: string): Promise<boolean> {
  try {
    const { error } = await supabase.from('turtle_alerts').delete().eq('id', id);

    if (error) {
      console.error('Error deleting alert:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error deleting alert:', error);
    return false;
  }
}
