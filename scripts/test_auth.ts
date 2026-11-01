const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://kqlksjvtwcwovfgxijab.supabase.co';
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;

async function testAuth() {
  console.log('Testing Supabase Auth API at:', supabaseUrl);

  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/health`, {
      headers: {
        'apikey': anonKey!
      }
    });
    console.log('Auth Health Status:', res.status, await res.text());
  } catch (err: any) {
    console.error('Auth Health Error:', err.message);
  }
}

testAuth();
