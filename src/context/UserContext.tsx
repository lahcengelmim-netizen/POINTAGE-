import React, { createContext, useContext, useState, useEffect } from 'react';
import { UserAccount } from '../types';
import { supabase } from '../services/supabaseClient';

interface UserContextType {
  user: UserAccount | null;
  loading: boolean;
  login: (username: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserAccount | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string) => {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Error fetching profile:', error);
      return null;
    }
    return {
      id: profile.id,
      username: profile.username,
      nom: profile.nom,
      role: profile.role,
      company_id: profile.company_id,
      actif: profile.actif,
    };
  };

  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const profile = await fetchProfile(session.user.id);
        if (profile) {
          setUser(profile as UserAccount);
        }
      }
      setLoading(false);
    };
    checkSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session) {
        const profile = await fetchProfile(session.user.id);
        if (profile) {
          setUser(profile as UserAccount);
        }
      } else {
        setUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const login = async (username: string, code: string) => {
    // Assuming usernames are mapped to email: username@agripointage.local
    const email = `${username.toLowerCase()}@agripointage.local`;
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: code,
    });

    if (error) {
      console.error('Login auth error:', error);
      throw new Error(`Identifiant ou mot de passe incorrect (${error.message})`);
    }

    // Explicitly verify profile after successful auth
    if (data.session) {
      const profile = await fetchProfile(data.session.user.id);
      if (!profile) {
        throw new Error("Authentification réussie, mais profil utilisateur introuvable.");
      }
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
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
