
-- 1. Create Profiles Table (linked to auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID REFERENCES auth.users(id) PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    nom TEXT NOT NULL,
    role TEXT CHECK (role IN ('admin', 'caporal')) NOT NULL,
    company_id TEXT NOT NULL,
    permissions JSONB DEFAULT '{}'::jsonb,
    actif BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. RLS Policies
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Admin: Can view and manage profiles within their company
CREATE POLICY "Admins manage profiles in their company" ON public.profiles
    FOR ALL
    USING (
        auth.uid() IN (SELECT id FROM public.profiles WHERE company_id = (SELECT company_id FROM public.profiles WHERE id = auth.uid()) AND role = 'admin')
    );

-- Users: Can view their own profile
CREATE POLICY "Users view own profile" ON public.profiles
    FOR SELECT
    USING (auth.uid() = id);

-- 3. RBAC/RLS Protection (example for pointages table - needs to be applied to all)
ALTER TABLE public.pointages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users access pointages by company" ON public.pointages
    FOR ALL
    USING (
        company_id = (SELECT company_id FROM public.profiles WHERE id = auth.uid())
    );

-- 4. Ensure foreign key on existing tables
ALTER TABLE public.ouvriers ADD COLUMN IF NOT EXISTS company_id TEXT;
ALTER TABLE public.pointages ADD COLUMN IF NOT EXISTS company_id TEXT;
ALTER TABLE public.taches ADD COLUMN IF NOT EXISTS company_id TEXT;
-- ... repeat for other tables ...
