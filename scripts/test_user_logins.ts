import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://kqlksjvtwcwovfgxijab.supabase.co';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testLogin(email: string, pass: string) {
  console.log(`Testing login for: ${email}`);
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: pass
  });

  if (error) {
    console.log(`❌ Fail (${email}):`, error.message);
    return null;
  }

  console.log(`✅ Success (${email}):`);
  console.log(`- User ID (UUID): ${data.user.id}`);
  console.log(`- Email: ${data.user.email}`);
  console.log(`- Role: ${data.user.role}`);
  console.log(`- Metadata:`, data.user.user_metadata);
  return data.user;
}

async function run() {
  console.log('=== TEST SUPABASE AUTH LOGIN ===\n');

  // Candidate emails
  const emailsToTest = [
    'lahcengelmim@gmail.com',
    'admin@agripointage.local',
    'admin@lahcenpointeur.com',
    'caporal1@agripointage.local',
    'caporal@agripointage.local',
    'caporal1@lahcenpointeur.com',
    'caporal@lahcenpointeur.com'
  ];

  // Common passwords to test in dev
  const passwordsToTest = ['admin123', 'caporal123', 'Lahcen2026!', 'lahcen2026', '123456', 'password'];

  for (const email of emailsToTest) {
    for (const pass of passwordsToTest) {
      const user = await testLogin(email, pass);
      if (user) break;
    }
  }
}

run();
