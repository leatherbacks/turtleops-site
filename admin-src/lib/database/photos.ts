import { supabase } from '../supabase';
import type { Photo } from '../types';

/**
 * Get all photos for an observation
 */
export async function getPhotosByObservation(observationId: string): Promise<Photo[]> {
  try {
    const { data, error } = await supabase
      .from('photos')
      .select('*')
      .eq('observation_id', observationId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching photos:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching photos:', error);
    return [];
  }
}

/**
 * Get photos by type for an observation
 */
export async function getPhotosByType(
  observationId: string,
  photoType: 'injury' | 'datasheet' | 'tags' | 'turtle' | 'other'
): Promise<Photo[]> {
  try {
    const { data, error } = await supabase
      .from('photos')
      .select('*')
      .eq('observation_id', observationId)
      .eq('photo_type', photoType)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching photos by type:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching photos by type:', error);
    return [];
  }
}

/**
 * Get photo URL (prefer remote_url, fallback to local_uri)
 */
export function getPhotoUrl(photo: Photo): string | null {
  return photo.remote_url || photo.local_uri;
}

/**
 * Get human-readable photo type label
 */
export function getPhotoTypeLabel(photoType: Photo['photo_type']): string {
  if (!photoType) return 'Other';

  const labels: Record<string, string> = {
    injury: 'Injury',
    datasheet: 'Data Sheet',
    tags: 'Tags',
    turtle: 'Turtle',
    other: 'Other',
  };

  return labels[photoType] || photoType;
}
