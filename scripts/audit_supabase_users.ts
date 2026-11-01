import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('SUPABASE_URL et VITE_SUPABASE_ANON_KEY absents.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function audit() {
  console.log('=== AUDIT SUPABASE CLIENT & PROFILES ===');
  console.log(`URL: ${supabaseUrl}`);

  // 1. Tenter d'utiliser auth.admin s'il y a la clé service_role
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log('\n--- Test Auth Admin (Service Role) ---');
    const { data: authUsersData, error: authErr } = await supabase.auth.admin.listUsers();
    if (authErr) {
      console.error('Erreur listUsers:', authErr.message);
    } else {
      console.log(`Auth users count: ${authUsersData.users.length}`);
      authUsersData.users.forEach((u, i) => {
        console.log(`[User ${i + 1}] ID: ${u.id} | Email: ${u.email} | Metadata:`, u.user_metadata);
      });
    }
  } else {
    console.log('\n--- Note: SUPABASE_SERVICE_ROLE_KEY non présent, utilisation de la clé anon public ---');
  }

  // 2. Vérifier public.profiles
  console.log('\n--- Table public.profiles ---');
  const { data: profilesData, error: profErr } = await supabase.from('profiles').select('*');
  if (profErr) {
    console.error('Erreur lecture profiles:', profErr.message);
  } else {
    console.log(`Nombre de profils dans 'profiles': ${profilesData?.length || 0}`);
    profilesData?.forEach((p, i) => {
      console.log(`[Profile ${i + 1}] ID: ${p.id} | Username: ${p.username} | Nom: ${p.nom} | Role: ${p.role} | Company: ${p.company_id} | Actif: ${p.actif}`);
    });
  }

  // 3. Vérifier public.companies
  console.log('\n--- Table public.companies ---');
  const { data: companiesData, error: compErr } = await supabase.from('companies').select('*');
  if (compErr) {
    console.error('Erreur lecture companies:', compErr.message);
  } else {
    console.log(`Nombre de sociétés: ${companiesData?.length || 0}`);
    companiesData?.forEach((c) => console.log(`- Company ID: ${c.id} | Nom: ${c.nom}`));
  }
}

audit().catch(console.error);
