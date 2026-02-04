/**
 * Check for specific observation by ID
 * Run with: npx tsx scripts/check-specific-observation.ts
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

// Create Supabase client with service role key to bypass RLS
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase environment variables');
  console.error('NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? 'set' : 'missing');
  console.error('SUPABASE_SERVICE_ROLE_KEY:', supabaseServiceKey ? 'set' : 'missing');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkObservation() {
  const observationId = '57c6a410-2eb7-42a6-8b75-cf823de9c809';

  console.log(`Checking for observation: ${observationId}\n`);

  // Check observation
  console.log('=== OBSERVATION ===');
  const { data: obs, error: obsError } = await supabase
    .from('observations')
    .select('*')
    .eq('id', observationId)
    .single();

  if (obsError) {
    console.error('Error fetching observation:', obsError);
  } else if (obs) {
    console.log('✓ Observation found!');
    console.log(`  Turtle: ${obs.turtle_name} (${obs.turtle_id})`);
    console.log(`  Date: ${obs.encounter_date}`);
    console.log(`  Observer: ${obs.observer_name}`);
    console.log(`  Location: ${obs.latitude}, ${obs.longitude}`);
    console.log(`  Did nest: ${obs.did_she_nest}`);
    console.log(`  Tags: LRF=${obs.tag_lrf}, RRF=${obs.tag_rrf}, RFF=${obs.tag_rff}, LFF=${obs.tag_lff}`);
    console.log(`  Comments: ${obs.comments || '(none)'}`);
    console.log(`  Created: ${obs.created_at}`);

    // Check turtle
    if (obs.turtle_id) {
      console.log('\n=== TURTLE ===');
      const { data: turtle, error: turtleError } = await supabase
        .from('turtles')
        .select('*')
        .eq('id', obs.turtle_id)
        .single();

      if (turtleError) {
        console.error('Error fetching turtle:', turtleError);
      } else if (turtle) {
        console.log('✓ Turtle found!');
        console.log(`  Name: ${turtle.name}`);
        console.log(`  Tags: LRF=${turtle.lrf}, RRF=${turtle.rrf}, RFF=${turtle.rff}, LFF=${turtle.lff}`);
        console.log(`  Encounter count: ${turtle.encounter_count}`);
        console.log(`  First seen: ${turtle.first_encountered_at}`);
        console.log(`  Last seen: ${turtle.last_encountered_at}`);
      }
    }

    // Check photos
    console.log('\n=== PHOTOS ===');
    const { data: photos, error: photoError } = await supabase
      .from('photos')
      .select('*')
      .eq('observation_id', observationId);

    if (photoError) {
      console.error('Error fetching photos:', photoError);
    } else {
      console.log(`✓ Found ${photos?.length || 0} photos`);
      photos?.forEach((photo) => {
        console.log(`  - ${photo.photo_type}: ${photo.remote_url?.substring(0, 60)}...`);
        console.log(`    Sync status: ${photo.sync_status}`);
      });
    }

    // Check tag history
    console.log('\n=== TAG HISTORY ===');
    const { data: tagHistory, error: tagError } = await supabase
      .from('tag_history')
      .select('*')
      .eq('observation_id', observationId);

    if (tagError) {
      console.error('Error fetching tag history:', tagError);
    } else {
      console.log(`✓ Found ${tagHistory?.length || 0} tag history records`);
      tagHistory?.forEach((tag) => {
        console.log(`  - Tags: LRF=${tag.lrf}, RRF=${tag.rrf}, RFF=${tag.rff}, LFF=${tag.lff}`);
        console.log(`    Notes: ${tag.notes || '(none)'}`);
      });
    }

    // Check injuries
    console.log('\n=== INJURIES ===');
    const { data: injuries, error: injuryError } = await supabase
      .from('injuries')
      .select('*')
      .eq('observation_id', observationId);

    if (injuryError) {
      console.error('Error fetching injuries:', injuryError);
    } else {
      console.log(`✓ Found ${injuries?.length || 0} injury records`);
      injuries?.forEach((injury) => {
        console.log(`  - ${injury.injury_type} at ${injury.body_location}`);
        console.log(`    Severity: ${injury.severity}, Status: ${injury.healing_status}`);
      });
    }
  } else {
    console.log('✗ Observation not found');
  }
}

checkObservation().catch(console.error);
