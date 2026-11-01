import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function inspectDb() {
  console.log('=== INSPECTION SUPABASE DATABASE ===\n');

  // 1. Companies
  const { data: companies, error: compErr } = await supabase.from('companies').select('*');
  console.log('--- Companies ---');
  if (compErr) console.error('Error companies:', compErr);
  else console.table(companies);

  // 2. Profiles
  const { data: profiles, error: profErr } = await supabase.from('profiles').select('*');
  console.log('\n--- Profiles ---');
  if (profErr) console.error('Error profiles:', profErr);
  else console.table(profiles);

  // 3. Ouvriers count
  const { count: ouvriersCount } = await supabase.from('ouvriers').select('*', { count: 'exact', head: true });
  console.log('\n--- Ouvriers ---');
  console.log(`Nombre total d'ouvriers dans Supabase: ${ouvriersCount}`);

  // 4. Pointages count
  const { count: pointagesCount } = await supabase.from('pointages').select('*', { count: 'exact', head: true });
  console.log('\n--- Pointages ---');
  console.log(`Nombre total de pointages dans Supabase: ${pointagesCount}`);

  // 5. Stock Produits
  const { data: stockProds } = await supabase.from('stock_produits').select('*');
  console.log('\n--- Stock Produits ---');
  console.table(stockProds);
}

inspectDb().catch(console.error);
