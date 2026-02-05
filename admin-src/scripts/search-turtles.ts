/**
 * Search for turtles by name pattern
 * Run with: npx tsx scripts/search-turtles.ts PATTERN
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

const searchPattern = process.argv[2] || '';

async function searchTurtles() {
  let query = supabase
    .from('turtles')
    .select('name, id, species, encounter_count, lrf, rrf, rff, lff')
    .order('name')
    .limit(100);

  if (searchPattern) {
    query = query.ilike('name', `%${searchPattern}%`);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error:', error);
    return;
  }

  if (!data || data.length === 0) {
    console.log(`No turtles found matching "${searchPattern}"`);
    return;
  }

  console.log(`\nFound ${data.length} turtles matching "${searchPattern}":\n`);

  data.forEach((t, i) => {
    console.log(`${i + 1}. ${t.name}`);
    console.log(`   Species: ${t.species || 'Unknown'}, Encounters: ${t.encounter_count || 0}`);
    const tags = [];
    if (t.lrf) tags.push(`LRF=${t.lrf}`);
    if (t.rrf) tags.push(`RRF=${t.rrf}`);
    if (t.rff) tags.push(`RFF=${t.rff}`);
    if (t.lff) tags.push(`LFF=${t.lff}`);
    if (tags.length > 0) {
      console.log(`   Tags: ${tags.join(', ')}`);
    }
    console.log('');
  });
}

searchTurtles().catch(console.error);
