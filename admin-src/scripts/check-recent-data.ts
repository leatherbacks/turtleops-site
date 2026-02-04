/**
 * Check database for recently created observation data
 * Run with: npx tsx scripts/check-recent-data.ts
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

// Manually load environment variables from .env.local
try {
  const envPath = resolve(__dirname, '../.env.local');
  const envFile = readFileSync(envPath, 'utf-8');
  const envVars = envFile.split('\n');

  envVars.forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').trim();
        process.env[key.trim()] = value;
      }
    }
  });
} catch (err) {
  console.error('Error loading .env.local:', err);
  process.exit(1);
}

// Create Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables');
  console.error('NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? 'set' : 'missing');
  console.error('NEXT_PUBLIC_SUPABASE_ANON_KEY:', supabaseKey ? 'set' : 'missing');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkRecentData() {
  console.log('Checking database for recent observation data...\n');

  // Check recent observations (last 10)
  console.log('=== RECENT OBSERVATIONS (last 10) ===');
  const { data: observations, error: obsError } = await supabase
    .from('observations')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  if (obsError) {
    console.error('Error fetching observations:', obsError);
  } else {
    console.log(`Found ${observations?.length || 0} observations`);
    observations?.forEach((obs) => {
      console.log(`  - ${obs.id.slice(0, 8)}: ${obs.turtle_name} on ${obs.encounter_date} by ${obs.observer_name}`);
      console.log(`    Created: ${obs.created_at}`);
      console.log(`    Lat/Long: ${obs.latitude}, ${obs.longitude}`);
      console.log(`    Did nest: ${obs.did_she_nest}`);
      console.log(`    Tags: LRF=${obs.tag_lrf}, RRF=${obs.tag_rrf}, RFF=${obs.tag_rff}, LFF=${obs.tag_lff}`);
    });
  }

  // Check recent turtles (last 10)
  console.log('\n=== RECENT TURTLES (last 10) ===');
  const { data: turtles, error: turtleError } = await supabase
    .from('turtles')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  if (turtleError) {
    console.error('Error fetching turtles:', turtleError);
  } else {
    console.log(`Found ${turtles?.length || 0} turtles`);
    turtles?.forEach((turtle) => {
      console.log(`  - ${turtle.id.slice(0, 8)}: ${turtle.name}`);
      console.log(`    Created: ${turtle.created_at}`);
      console.log(`    Tags: LRF=${turtle.lrf}, RRF=${turtle.rrf}, RFF=${turtle.rff}, LFF=${turtle.lff}`);
      console.log(`    Encounters: ${turtle.encounter_count}`);
    });
  }

  // Check recent photos (last 10)
  console.log('\n=== RECENT PHOTOS (last 10) ===');
  const { data: photos, error: photoError } = await supabase
    .from('photos')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  if (photoError) {
    console.error('Error fetching photos:', photoError);
  } else {
    console.log(`Found ${photos?.length || 0} photos`);
    photos?.forEach((photo) => {
      console.log(`  - ${photo.id.slice(0, 8)}: ${photo.photo_type} for obs ${photo.observation_id?.slice(0, 8)}`);
      console.log(`    Created: ${photo.created_at}`);
      console.log(`    Remote URL: ${photo.remote_url || '(none)'}`);
      console.log(`    Local URI: ${photo.local_uri || '(none)'}`);
    });
  }

  // Check recent tag history (last 10)
  console.log('\n=== RECENT TAG HISTORY (last 10) ===');
  const { data: tagHistory, error: tagError } = await supabase
    .from('tag_history')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  if (tagError) {
    console.error('Error fetching tag history:', tagError);
  } else {
    console.log(`Found ${tagHistory?.length || 0} tag history records`);
    tagHistory?.forEach((tag) => {
      console.log(`  - ${tag.id.slice(0, 8)}: Turtle ${tag.turtle_id?.slice(0, 8)} on ${tag.encounter_date}`);
      console.log(`    Created: ${tag.created_at}`);
      console.log(`    Tags: LRF=${tag.lrf}, RRF=${tag.rrf}, RFF=${tag.rff}, LFF=${tag.lff}`);
      console.log(`    Notes: ${tag.notes || '(none)'}`);
    });
  }

  // Check storage bucket files in org folders
  console.log('\n=== CHECKING STORAGE BUCKET (turtle-photos) ===');
  try {
    const { data: files, error: storageError } = await supabase.storage
      .from('turtle-photos')
      .list('', { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });

    if (storageError) {
      console.error('Error fetching storage files:', storageError);
    } else {
      console.log(`Found ${files?.length || 0} items in root`);

      // Look for org folders
      const orgFolders = files?.filter(f => f.id === null) || []; // Folders have id === null
      console.log(`Org folders: ${orgFolders.map(f => f.name).join(', ') || '(none)'}`);

      // List recent files
      const recentFiles = files?.filter(f => f.id !== null).slice(0, 10) || [];
      console.log(`Recent files (${recentFiles.length}):`);
      recentFiles.forEach((file) => {
        console.log(`  - ${file.name}`);
        console.log(`    Created: ${file.created_at}`);
      });
    }
  } catch (err) {
    console.error('Storage check error:', err);
  }
}

checkRecentData().catch(console.error);
