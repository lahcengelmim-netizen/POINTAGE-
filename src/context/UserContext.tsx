import React, { createContext, useContext, useState, useEffect } from 'react';
import { UserAccount } from '../types';
import { supabase } from '../services/supabaseClient';
import * as storage from '../services/storage';

interface UserContextType {
  user: UserAccount | null;
  loading: boolean;
  login: (usernameOrEmail: string, code: string) => Promise<UserAccount>;
  logout: () => Promise<void>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserAccount | null>(null);
  const [loading, setLoading] = useState(true);

  // Récupère ou crée le profil lié à l'UUID Supabase Auth
  const fetchProfile = async (userId: string, authUser?: any): Promise<UserAccount | null> => {
    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (profile) {
        const userAcc: UserAccount = {
          id: profile.id,
          username: profile.username || authUser?.email?.split('@')[0] || 'user',
          nom: profile.nom || 'Utilisateur',
          role: profile.role || 'caporal',
          company_id: profile.company_id || 'cie_lahcen_pointeur',
          actif: profile.actif !== false,
          createdAt: profile.created_at || new Date().toISOString(),
        };
        storage.setCurrentUser(userAcc);
        return userAcc;
      }

      // Si le profil n'existe pas encore dans public.profiles (premier login), le créer avec son UUID Supabase Auth
      if (authUser) {
        const userEmail = (authUser.email || '').toLowerCase();
        const isAdminEmail = userEmail === 'lahcengelmim@gmail.com' || userEmail.startsWith('admin');
        const role = authUser.user_metadata?.role || (isAdminEmail ? 'admin' : 'caporal');
        const nom =
          authUser.user_metadata?.nom ||
          (role === 'admin' ? 'Lahcen (Administrateur)' : 'Caporal (Récolte)');
        const username =
          authUser.user_metadata?.username || userEmail.split('@')[0] || 'user';

        const newProfile = {
          id: userId,
          username,
          nom,
          role,
          company_id: authUser.user_metadata?.company_id || 'cie_lahcen_pointeur',
          actif: true,
        };

        const { data: upserted } = await supabase
          .from('profiles')
          .upsert(newProfile, { onConflict: 'id' })
          .select('*')
          .maybeSingle();

        const finalProfile = upserted || newProfile;
        const userAcc: UserAccount = {
          id: finalProfile.id,
          username: finalProfile.username,
          nom: finalProfile.nom,
          role: finalProfile.role as 'admin' | 'caporal',
          company_id: finalProfile.company_id || 'cie_lahcen_pointeur',
          actif: finalProfile.actif !== false,
          createdAt: new Date().toISOString(),
        };

        storage.setCurrentUser(userAcc);
        return userAcc;
      }

      if (error) {
        console.warn('Erreur lecture profil Supabase:', error.message);
      }
      return null;
    } catch (err) {
      console.error('Erreur fetchProfile:', err);
      return null;
    }
  };

  useEffect(() => {
    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const profile = await fetchProfile(session.user.id, session.user);
          if (profile) {
            setUser(profile);
          }
        }
      } catch (err) {
        console.error('Erreur vérification session:', err);
      } finally {
        setLoading(false);
      }
    };
    checkSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session) {
        const profile = await fetchProfile(session.user.id, session.user);
        if (profile) {
          setUser(profile);
        }
      } else {
        setUser(null);
        storage.logoutUser();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const login = async (usernameOrEmail: string, code: string): Promise<UserAccount> => {
    const cleanInput = usernameOrEmail.trim().toLowerCase();
    const email = cleanInput.includes('@') ? cleanInput : `${cleanInput}@agripointage.local`;

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: code,
    });

    if (error || !data.session) {
      console.error('Erreur authentification Supabase:', error);
      throw new Error(`Identifiant ou mot de passe incorrect (${error?.message || 'Échec session'})`);
    }

    const profile = await fetchProfile(data.session.user.id, data.session.user);
    if (!profile) {
      throw new Error('Authentification réussie, mais impossible de charger le profil.');
    }

    setUser(profile);
    return profile;
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    storage.logoutUser();
  };

  return (
    <UserContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </UserContext.Provider>
  );
};

export const useUser = () => {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
};
