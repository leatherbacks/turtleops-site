/**
 * Analyze how dates/times are stored in the database
 * Check for timezone consistency issues
 * Run with: npx tsx scripts/analyze-datetime-storage.ts
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

async function analyzeDatetimeStorage() {
  console.log('\n=== DATABASE DATETIME STORAGE ANALYSIS ===\n');

  // 1. Check database timezone setting
  console.log('1. DATABASE TIMEZONE SETTING');
  console.log('─'.repeat(80));
  console.log('PostgreSQL databases use UTC by default for TIMESTAMPTZ columns.\n');

  // 2. Check project config timezone
  console.log('2. PROJECT CONFIG TIMEZONE');
  console.log('─'.repeat(80));

  const { data: projectConfig } = await supabase
    .from('project_config')
    .select('timezone')
    .single();

  if (projectConfig?.timezone) {
    console.log(`Project timezone: ${projectConfig.timezone}`);
  } else {
    console.log('No project timezone configured.');
  }
  console.log('');

  // 3. Sample observations with encounter dates
  console.log('3. SAMPLE OBSERVATIONS - DATETIME ANALYSIS');
  console.log('─'.repeat(80));

  const { data: observations } = await supabase
    .from('observations')
    .select('id, turtle_name, encounter_date, observer_name, is_relayed_sighting, created_at')
    .order('encounter_date', { ascending: false })
    .limit(10);

  if (!observations || observations.length === 0) {
    console.log('No observations found in database.\n');
  } else {
    console.log(`Found ${observations.length} recent observations:\n`);

    observations.forEach((obs, i) => {
      const encounterDate = new Date(obs.encounter_date);
      const createdDate = new Date(obs.created_at);

      console.log(`${i + 1}. ${obs.turtle_name || 'Unknown'} - ${obs.observer_name || 'Unknown'}`);
      console.log(`   Relayed: ${obs.is_relayed_sighting ? 'Yes' : 'No'}`);
      console.log(`   encounter_date (DB): ${obs.encounter_date}`);
      console.log(`   Parsed as Date:       ${encounterDate.toString()}`);
      console.log(`   UTC:                  ${encounterDate.toUTCString()}`);
      console.log(`   Local:                ${encounterDate.toLocaleString()}`);
      console.log(`   ISO:                  ${encounterDate.toISOString()}`);
      console.log(`   Hour (local):         ${encounterDate.getHours()}`);
      console.log(`   Hour (UTC):           ${encounterDate.getUTCHours()}`);
      console.log(`   Created at:           ${createdDate.toLocaleString()}`);
      console.log('');
    });
  }

  // 4. Check for suspicious patterns
  console.log('4. POTENTIAL TIMEZONE ISSUES');
  console.log('─'.repeat(80));

  if (observations && observations.length > 0) {
    const midnightObs = observations.filter(o => {
      const d = new Date(o.encounter_date);
      // Check if time is exactly midnight UTC (suspicious for historical entry)
      return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
    });

    const oddHourObs = observations.filter(o => {
      const d = new Date(o.encounter_date);
      const hour = d.getHours();
      // Turtle observations are typically during nesting season night hours (7 PM - 6 AM)
      return hour >= 6 && hour < 19;
    });

    console.log(`Observations at exactly midnight UTC: ${midnightObs.length}`);
    if (midnightObs.length > 0) {
      console.log('  ⚠️  Warning: Midnight UTC times may indicate timezone conversion issues.');
      console.log('  Historical entries should preserve the actual observation time.\n');
    }

    console.log(`Observations during daytime (6 AM - 7 PM local): ${oddHourObs.length}`);
    if (oddHourObs.length > 0) {
      console.log('  ℹ️  Note: Daytime observations are unusual for nesting sea turtles.');
      console.log('  Check if timezone conversion shifted night observations to day.\n');
    }

    if (midnightObs.length === 0 && oddHourObs.length === 0) {
      console.log('✓ No obvious timezone issues detected.');
      console.log('  All observations have reasonable times for sea turtle nesting surveys.\n');
    }
  }

  // 5. How dates SHOULD be handled
  console.log('5. CORRECT DATETIME HANDLING');
  console.log('─'.repeat(80));
  console.log('PostgreSQL TIMESTAMPTZ columns store in UTC but preserve timezone semantics.\n');

  console.log('For datetime-local input (e.g., "2025-01-15T21:30"):');
  console.log('  ❌ WRONG: new Date("2025-01-15T21:30:00Z")');
  console.log('     Treats as UTC, shifts to different time when converted to local\n');

  console.log('  ✓ CORRECT: new Date("2025-01-15T21:30:00")');
  console.log('     Treats as local time, stores with proper UTC offset\n');

  console.log('  ✓ BETTER: Use timezone-aware library (date-fns-tz, luxon)');
  console.log('     Can explicitly specify timezone from project config\n');

  console.log('Example (assuming EST/EDT timezone):');
  console.log('  User enters: 2025-01-15T21:30 (9:30 PM local)');
  console.log('  Wrong way:   2025-01-16T02:30Z (stored as 2:30 AM UTC = 9:30 PM EST)');
  console.log('               ❌ But gets displayed as 2:30 AM when read');
  console.log('  Right way:   2025-01-16T02:30:00Z (stored as 2:30 AM UTC = 9:30 PM EST)');
  console.log('               ✓ Displays as 9:30 PM EST when using toLocaleString()');
  console.log('\n');

  // 6. Recommendations
  console.log('6. RECOMMENDATIONS');
  console.log('─'.repeat(80));
  console.log('1. Remove the "Z" suffix in new-historical/page.tsx line 266');
  console.log('   Change: new Date(dateTimeWithSeconds + "Z")');
  console.log('   To:     new Date(dateTimeWithSeconds)\n');

  console.log('2. Consider using a timezone library for explicit timezone handling');
  console.log('   - date-fns-tz: Lightweight, works with project config timezone');
  console.log('   - luxon: More features, better timezone support\n');

  console.log('3. Always display times with timezone info in the UI');
  console.log('   - Use toLocaleString() with timeZone option');
  console.log('   - Show timezone abbreviation (EST, EDT, etc.)\n');

  console.log('4. Test with observations across different timezones');
  console.log('   - Historical data from different seasons (EST vs EDT)');
  console.log('   - Data from different geographic locations\n');

  console.log('='.repeat(80));
}

analyzeDatetimeStorage().catch(console.error);
