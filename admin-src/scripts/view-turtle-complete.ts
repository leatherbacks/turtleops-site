/**
 * Complete view of a turtle by name
 * Run with: npx tsx scripts/view-turtle-complete.ts TURTLE_NAME
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

const turtleName = process.argv[2] || 'COCO';

async function viewTurtle() {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`COMPLETE VIEW: ${turtleName}`);
  console.log(`${'='.repeat(80)}\n`);

  // 1. TURTLE BASIC INFO - Find all matching turtles
  const { data: turtles, error: turtleError } = await supabase
    .from('turtles')
    .select('*')
    .ilike('name', turtleName);

  if (turtleError || !turtles || turtles.length === 0) {
    console.error('❌ Turtle not found:', turtleError?.message || 'No turtle with that name');
    return;
  }

  if (turtles.length > 1) {
    console.log(`⚠️  Found ${turtles.length} turtles matching "${turtleName}":\n`);
    turtles.forEach((t, i) => {
      console.log(`${i + 1}. ${t.name} (ID: ${t.id.substring(0, 8)}..., encounters: ${t.encounter_count || 0})`);
    });
    console.log(`\nShowing data for first match: ${turtles[0].name}\n`);
  }

  const turtle = turtles[0];

  console.log('🐢 TURTLE INFORMATION');
  console.log('─'.repeat(80));
  console.log(`Name:                 ${turtle.name}`);
  console.log(`Species:              ${turtle.species || 'Unknown'}`);
  console.log(`ID:                   ${turtle.id}`);
  console.log(`Organization:         ${turtle.org_id}`);
  console.log(`\nCurrent Tags:`);
  console.log(`  LRF (Left Rear):    ${turtle.lrf || '(none)'}`);
  console.log(`  RRF (Right Rear):   ${turtle.rrf || '(none)'}`);
  console.log(`  RFF (Right Front):  ${turtle.rff || '(none)'}`);
  console.log(`  LFF (Left Front):   ${turtle.lff || '(none)'}`);
  console.log(`\nEncounter Stats:`);
  console.log(`  Total Encounters:   ${turtle.encounter_count || 0}`);
  console.log(`  First Encountered:  ${turtle.first_encountered_at ? new Date(turtle.first_encountered_at).toLocaleString() : 'Unknown'}`);
  console.log(`  Last Encountered:   ${turtle.last_encountered_at ? new Date(turtle.last_encountered_at).toLocaleString() : 'Unknown'}`);
  console.log(`\nDates:`);
  console.log(`  Created:            ${new Date(turtle.created_at).toLocaleString()}`);
  console.log(`  Updated:            ${new Date(turtle.updated_at).toLocaleString()}`);

  // 2. ADDITIONAL PIT TAGS
  const { data: additionalTags } = await supabase
    .from('additional_tags')
    .select('*')
    .eq('turtle_id', turtle.id)
    .order('created_at', { ascending: true });

  if (additionalTags && additionalTags.length > 0) {
    console.log(`\n📌 ADDITIONAL PIT TAGS (${additionalTags.length})`);
    console.log('─'.repeat(80));
    additionalTags.forEach((tag, index) => {
      console.log(`${index + 1}. ${tag.tag_value} (added ${new Date(tag.created_at).toLocaleDateString()})`);
    });
  }

  // 3. OBSERVATIONS
  const { data: observations } = await supabase
    .from('observations')
    .select('*')
    .eq('turtle_id', turtle.id)
    .order('encounter_date', { ascending: false });

  console.log(`\n📋 OBSERVATIONS (${observations?.length || 0})`);
  console.log('─'.repeat(80));

  if (observations && observations.length > 0) {
    observations.forEach((obs, index) => {
      console.log(`\n${index + 1}. ${new Date(obs.encounter_date).toLocaleString()}`);
      console.log(`   Observer:         ${obs.observer_name || 'Unknown'}`);
      console.log(`   Location:         ${obs.latitude || '?'}, ${obs.longitude || '?'}`);
      if (obs.beach_sector) console.log(`   Beach Sector:     ${obs.beach_sector}`);
      console.log(`   Nesting:          ${obs.did_she_nest ? 'YES' : obs.did_she_nest === false ? 'NO' : 'Unknown'}`);
      if (obs.egg_count) console.log(`   Eggs:             ${obs.egg_count}`);
      console.log(`   Tags at time:     LRF=${obs.tag_lrf || 'none'}, RRF=${obs.tag_rrf || 'none'}, RFF=${obs.tag_rff || 'none'}, LFF=${obs.tag_lff || 'none'}`);
      if (obs.curved_carapace_length) console.log(`   CCL:              ${obs.curved_carapace_length} cm`);
      if (obs.curved_carapace_width) console.log(`   CCW:              ${obs.curved_carapace_width} cm`);
      if (obs.temperature) console.log(`   Temperature:      ${obs.temperature}°F`);
      if (obs.comments) console.log(`   Comments:         ${obs.comments}`);
      console.log(`   Submitted:        ${obs.is_submitted ? 'Yes' : 'Draft'}`);
      console.log(`   Relayed Sighting: ${obs.is_relayed_sighting ? 'Yes' : 'No'}`);
    });
  } else {
    console.log('No observations recorded yet.');
  }

  // 4. TAG HISTORY
  const { data: tagHistory } = await supabase
    .from('tag_history')
    .select('*')
    .eq('turtle_id', turtle.id)
    .order('encounter_date', { ascending: true });

  console.log(`\n🏷️  TAG HISTORY (${tagHistory?.length || 0} records)`);
  console.log('─'.repeat(80));

  if (tagHistory && tagHistory.length > 0) {
    tagHistory.forEach((record, index) => {
      console.log(`\n${index + 1}. ${new Date(record.encounter_date).toLocaleDateString()}`);
      console.log(`   Observer:         ${record.observer_name || 'Unknown'}`);
      console.log(`   Current Tags:     LRF=${record.lrf || 'none'}, RRF=${record.rrf || 'none'}, RFF=${record.rff || 'none'}, LFF=${record.lff || 'none'}`);

      const hadPrevious = record.previous_lrf || record.previous_rrf || record.previous_rff || record.previous_lff;
      if (hadPrevious) {
        console.log(`   Previous Tags:    LRF=${record.previous_lrf || 'none'}, RRF=${record.previous_rrf || 'none'}, RFF=${record.previous_rff || 'none'}, LFF=${record.previous_lff || 'none'}`);

        // Show what changed
        const changes = [];
        if (record.lrf !== record.previous_lrf) changes.push(`LRF: ${record.previous_lrf || 'none'} → ${record.lrf || 'none'}`);
        if (record.rrf !== record.previous_rrf) changes.push(`RRF: ${record.previous_rrf || 'none'} → ${record.rrf || 'none'}`);
        if (record.rff !== record.previous_rff) changes.push(`RFF: ${record.previous_rff || 'none'} → ${record.rff || 'none'}`);
        if (record.lff !== record.previous_lff) changes.push(`LFF: ${record.previous_lff || 'none'} → ${record.lff || 'none'}`);

        if (changes.length > 0) {
          console.log(`   Changes:          ${changes.join(', ')}`);
        }
      }

      if (record.notes) {
        console.log(`   Notes:            ${record.notes}`);
      }
    });
  } else {
    console.log('No tag history recorded.');
  }

  // 5. PHOTOS
  const { data: photos } = await supabase
    .from('photos')
    .select('observation_id, photo_type, created_at')
    .in('observation_id', observations?.map(o => o.id) || [])
    .order('created_at', { ascending: false });

  console.log(`\n📷 PHOTOS (${photos?.length || 0})`);
  console.log('─'.repeat(80));

  if (photos && photos.length > 0) {
    const photosByType = photos.reduce((acc, photo) => {
      if (!acc[photo.photo_type]) acc[photo.photo_type] = 0;
      acc[photo.photo_type]++;
      return acc;
    }, {} as Record<string, number>);

    console.log('Photos by type:');
    Object.entries(photosByType).forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });
  } else {
    console.log('No photos uploaded.');
  }

  // 6. ALERTS
  const { data: alerts } = await supabase
    .from('turtle_alerts')
    .select('*')
    .eq('turtle_id', turtle.id)
    .eq('is_active', true);

  if (alerts && alerts.length > 0) {
    console.log(`\n⚠️  ACTIVE ALERTS (${alerts.length})`);
    console.log('─'.repeat(80));
    alerts.forEach((alert, index) => {
      console.log(`${index + 1}. ${alert.message}`);
      console.log(`   Severity:         ${alert.severity}`);
      console.log(`   Created:          ${new Date(alert.created_at).toLocaleDateString()}`);
    });
  }

  // 7. SUMMARY STATISTICS
  console.log(`\n📊 SUMMARY STATISTICS`);
  console.log('─'.repeat(80));

  const nestingObs = observations?.filter(o => o.did_she_nest === true) || [];
  const totalEggs = observations?.reduce((sum, o) => sum + (o.egg_count || 0), 0) || 0;
  const avgCCL = observations?.filter(o => o.curved_carapace_length).reduce((sum, o) => sum + (o.curved_carapace_length || 0), 0) / (observations?.filter(o => o.curved_carapace_length).length || 1);
  const avgCCW = observations?.filter(o => o.curved_carapace_width).reduce((sum, o) => sum + (o.curved_carapace_width || 0), 0) / (observations?.filter(o => o.curved_carapace_width).length || 1);

  console.log(`Total Observations:   ${observations?.length || 0}`);
  console.log(`Nesting Events:       ${nestingObs.length}`);
  console.log(`Total Eggs Laid:      ${totalEggs}`);
  console.log(`Tag History Records:  ${tagHistory?.length || 0}`);
  console.log(`Photos:               ${photos?.length || 0}`);
  if (avgCCL > 0) console.log(`Average CCL:          ${avgCCL.toFixed(1)} cm`);
  if (avgCCW > 0) console.log(`Average CCW:          ${avgCCW.toFixed(1)} cm`);

  // Date range
  if (observations && observations.length > 0) {
    const dates = observations.map(o => new Date(o.encounter_date)).sort((a, b) => a.getTime() - b.getTime());
    const firstDate = dates[0];
    const lastDate = dates[dates.length - 1];
    const daysBetween = Math.floor((lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24));

    console.log(`\nObservation Span:     ${daysBetween} days (${firstDate.toLocaleDateString()} to ${lastDate.toLocaleDateString()})`);
  }

  console.log(`\n${'='.repeat(80)}\n`);
}

viewTurtle().catch(console.error);
