const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://kqlksjvtwcwovfgxijab.supabase.co';
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;

async function testTables() {
  const tables = ['profiles', 'companies', 'ouvriers', 'taches', 'stock_produits', 'recolte_entries'];

  for (const t of tables) {
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/${t}?select=*`, {
        headers: {
          'apikey': anonKey!,
          'Authorization': `Bearer ${anonKey}`
        }
      });
      const status = res.status;
      const text = await res.text();
      console.log(`Table '${t}' -> Status ${status}: ${text.substring(0, 150)}`);
    } catch (err: any) {
      console.error(`Error table '${t}':`, err.message);
    }
  }
}

testTables();
