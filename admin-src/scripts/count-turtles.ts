/**
 * Count turtles in database
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

async function countTurtles() {
  const { count, error } = await supabase
    .from('turtles')
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`Total turtles in database: ${count || 0}`);

  // Get a few examples
  const { data } = await supabase
    .from('turtles')
    .select('name, encounter_count')
    .order('encounter_count', { ascending: false })
    .limit(10);

  if (data && data.length > 0) {
    console.log('\nTop 10 turtles by encounter count:');
    data.forEach((t, i) => {
      console.log(`${i + 1}. ${t.name} (${t.encounter_count || 0} encounters)`);
    });
  }
}

countTurtles().catch(console.error);
