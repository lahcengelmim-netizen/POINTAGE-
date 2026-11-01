import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkTables() {
  const tables = [
    'profiles',
    'companies',
    'users',
    'ouvriers',
    'taches',
    'pointages',
    'serres',
    'recoltes',
    'stock_produits',
    'stock_mouvements',
    'heures_supplementaires',
    'gazoil_mouvements'
  ];

  console.log('Testing table existence in Supabase project:', supabaseUrl);

  for (const table of tables) {
    const { data, error } = await supabase.from(table).select('count', { count: 'exact', head: true });
    if (error) {
      console.log(`❌ Table '${table}': ${error.message} (code: ${error.code})`);
    } else {
      console.log(`✅ Table '${table}': EXISTE`);
    }
  }
}

checkTables().catch(console.error);
