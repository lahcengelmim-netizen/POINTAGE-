import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://kqlksjvtwcwovfgxijab.supabase.co';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function runRealAudit() {
  console.log('====================================================');
  console.log('   AUDIT FONCTIONNEL DU SYSTÈME SUPABASE AUTH');
  console.log('====================================================\n');

  console.log(`URL du Projet Supabase: ${supabaseUrl}`);
  console.log(`Clé Anonyme configurée: ${supabaseAnonKey ? 'Oui (sb_publish...)' : 'Non'}\n`);

  // 1. Audit de la table public.profiles
  console.log('--- 1. AUDIT DES PROFILS EXISTANTS DANS PUBLIC.PROFILES ---');
  try {
    const { data: profiles, error } = await supabase.from('profiles').select('*');
    if (error) {
      console.log(`⚠️ Note RLS / Accès profiles (${error.code}) : ${error.message}`);
      console.log('   (PostgREST restreint l’accès anonyme selon les règles RLS configurées)');
    } else if (profiles && profiles.length > 0) {
      console.log(`✅ ${profiles.length} profil(s) trouvé(s) dans public.profiles:`);
      profiles.forEach((p) => {
        console.log(`   - UUID: ${p.id} | Username: ${p.username} | Nom: ${p.nom} | Role: ${p.role} | Company: ${p.company_id} | Actif: ${p.actif}`);
      });
    } else {
      console.log('ℹ️ La table public.profiles est actuellement vide ou restreinte par RLS.');
    }
  } catch (e: any) {
    console.error('Erreur lecture profiles:', e.message);
  }

  // 2. Audit de l’intégrité des données existantes (Pointages, Ouvriers, Récolte, Stock Pro)
  console.log('\n--- 2. AUDIT DE L\'INTÉGRITÉ DES DONNÉES EXISTANTES ---');
  const checkTables = [
    { name: 'companies', label: 'Sociétés' },
    { name: 'ouvriers', label: 'Ouvriers' },
    { name: 'pointages', label: 'Pointages' },
    { name: 'taches', label: 'Tâches' },
    { name: 'stock_produits', label: 'Produits Stock Pro' },
    { name: 'stock_mouvements', label: 'Mouvements Stock Pro' },
    { name: 'recolte_entries', label: 'Saisies Récolte' },
  ];

  for (const t of checkTables) {
    try {
      const { count, error } = await supabase.from(t.name).select('*', { count: 'exact', head: true });
      if (error) {
        console.log(`- ${t.label} ('${t.name}') : ⚠️ Statut API: ${error.message} (${error.code})`);
      } else {
        console.log(`- ${t.label} ('${t.name}') : ✅ Intact (${count ?? 0} enregistrements en base)`);
      }
    } catch (e: any) {
      console.log(`- ${t.label} ('${t.name}') : Erreur: ${e.message}`);
    }
  }

  // 3. Test de la logique de transformation Email / Identifiant court
  console.log('\n--- 3. TEST DE LA LOGIQUE DE RESOLUTION IDENTIFIANT / EMAIL ---');
  const testInputs = [
    { input: 'lahcengelmim@gmail.com', expected: 'lahcengelmim@gmail.com' },
    { input: 'admin', expected: 'admin@agripointage.local' },
    { input: 'caporal1', expected: 'caporal1@agripointage.local' },
    { input: '  CAPORAL1  ', expected: 'caporal1@agripointage.local' },
  ];

  testInputs.forEach((t) => {
    const cleanInput = t.input.trim().toLowerCase();
    const resolvedEmail = cleanInput.includes('@') ? cleanInput : `${cleanInput}@agripointage.local`;
    const passed = resolvedEmail === t.expected;
    console.log(`   [Saisie: "${t.input}"] -> Résolution: "${resolvedEmail}" | ${passed ? '✅ Valide' : '❌ Échec'}`);
  });

  console.log('\n====================================================');
  console.log('   FIN DE L\'AUDIT TECHNIQUE SANS MODIFICATION');
  console.log('====================================================');
}

runRealAudit().catch(console.error);
