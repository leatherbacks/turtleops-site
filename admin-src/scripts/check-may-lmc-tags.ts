/**
 * Check tag history for MAY_LMC
 * Run with: npx tsx scripts/check-may-lmc-tags.ts
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
try {
  const envPath = resolve(__dirname, '../.env.local');
  const envFile = readFileSync(envPath, 'utf-8');
  const envVars = envFile.split('\n');
  envVars.forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        process.env[key.trim()] = valueParts.join('=').trim();
      }
    }
  });
} catch (err) {
  console.error('Error loading .env.local:', err);
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkMayLmc() {
  console.log('Searching for MAY_LMC...\n');

  // Find turtle
  const { data: turtle, error: turtleError } = await supabase
    .from('turtles')
    .select('*')
    .ilike('name', '%MAY_LMC%')
    .single();

  if (turtleError || !turtle) {
    console.error('Could not find MAY_LMC:', turtleError);
    return;
  }

  console.log('=== TURTLE INFO ===');
  console.log(`Name: ${turtle.name}`);
  console.log(`Current Tags:`);
  console.log(`  LRF: ${turtle.lrf || '(none)'}`);
  console.log(`  RRF: ${turtle.rrf || '(none)'}`);
  console.log(`  RFF: ${turtle.rff || '(none)'}`);
  console.log(`  LFF: ${turtle.lff || '(none)'}`);
  console.log(`Encounter Count: ${turtle.encounter_count}`);

  // Get tag history
  console.log('\n=== TAG HISTORY ===');
  const { data: history, error: historyError } = await supabase
    .from('tag_history')
    .select('*')
    .eq('turtle_id', turtle.id)
    .order('encounter_date', { ascending: true });

  if (historyError) {
    console.error('Error fetching tag history:', historyError);
    return;
  }

  if (!history || history.length === 0) {
    console.log('No tag history found');
  } else {
    console.log(`Found ${history.length} tag history records:\n`);
    history.forEach((record, index) => {
      console.log(`${index + 1}. ${new Date(record.encounter_date).toLocaleDateString()}`);
      console.log(`   Tags: LRF=${record.lrf || 'none'}, RRF=${record.rrf || 'none'}, RFF=${record.rff || 'none'}, LFF=${record.lff || 'none'}`);
      console.log(`   Observer: ${record.observer_name}`);
      if (record.notes) {
        console.log(`   Notes: ${record.notes}`);
      }
      console.log('');
    });
  }

  // Get observations
  console.log('=== OBSERVATIONS ===');
  const { data: observations, error: obsError } = await supabase
    .from('observations')
    .select('encounter_date, observer_name, tag_lrf, tag_rrf, tag_rff, tag_lff, comments')
    .eq('turtle_id', turtle.id)
    .order('encounter_date', { ascending: true });

  if (obsError) {
    console.error('Error fetching observations:', obsError);
  } else {
    console.log(`Found ${observations?.length || 0} observations:\n`);
    observations?.forEach((obs, index) => {
      console.log(`${index + 1}. ${new Date(obs.encounter_date).toLocaleDateString()} by ${obs.observer_name}`);
      console.log(`   Tags: LRF=${obs.tag_lrf || 'none'}, RRF=${obs.tag_rrf || 'none'}, RFF=${obs.tag_rff || 'none'}, LFF=${obs.tag_lff || 'none'}`);
      if (obs.comments) {
        console.log(`   Comments: ${obs.comments}`);
      }
      console.log('');
    });
  }
}

checkMayLmc().catch(console.error);
