import React, { createContext, useContext, useState, useEffect } from 'react';
import { UserAccount } from '../types';
import { supabase } from '../services/supabaseClient';
import * as storage from '../services/storage';

interface UserContextType {
  user: UserAccount | null;
  loading: boolean;
  login: (usernameOrEmail: string, code: string) => Promise<UserAccount>;
  loginWithBiometrics: (userId?: string) => Promise<UserAccount>;
  logout: () => Promise<void>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserAccount | null>(null);
  const [loading, setLoading] = useState(true);

  // Récupère le profil strictement depuis public.profiles sans auto-création ni mutation DB
  const fetchProfile = async (userId: string, authUser?: any): Promise<UserAccount | null> => {
    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.warn('Erreur lecture profil Supabase:', error.message);
      }

      if (!profile || profile.actif === false) {
        await supabase.auth.signOut().catch(() => {});
        storage.logoutUser();
        return null;
      }

      const userCompId = (profile.company_id || '').trim();
      if (!userCompId) {
        await supabase.auth.signOut().catch(() => {});
        storage.logoutUser();
        return null;
      }

      const userEmail = (authUser?.email || '').toLowerCase();
      const isTariq = userEmail === 'tariq@caporal.com' || String(profile.username || '').toLowerCase() === 'tariq';
      const isContractuel =
        profile.role === 'caporal_contractuelles' ||
        profile.module_attribue === 'contractuelles' ||
        isTariq;

      const assignedModule = isContractuel ? 'contractuelles' : (profile.module_attribue || 'recolte');
      const assignedRole = isTariq
        ? 'caporal_contractuelles'
        : isContractuel
        ? (profile.role === 'admin' ? 'admin' : 'caporal_contractuelles')
        : (profile.role || 'caporal');

      const userAcc: UserAccount = {
        id: profile.id,
        username: profile.username || userEmail.split('@')[0] || 'user',
        nom: isTariq ? 'Tariq (Caporal Contractuelles)' : (profile.nom || 'Utilisateur'),
        role: assignedRole as any,
        module_attribue: assignedModule as any,
        domaines_autorises: Array.isArray(profile.domaines_autorises) ? profile.domaines_autorises : undefined,
        serres_autorisees: Array.isArray(profile.serres_autorisees) ? profile.serres_autorisees : undefined,
        company_id: userCompId,
        actif: true,
        createdAt: profile.created_at || new Date().toISOString(),
      };

      storage.setActiveCompanyId(userCompId);
      storage.setCurrentUser(userAcc);
      return userAcc;
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
          } else {
            setUser(null);
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
        setUser(profile);
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
      throw new Error('Authentification réussie, mais profil introuvable ou compte désactivé.');
    }

    setUser(profile);
    return profile;
  };

  const loginWithBiometrics = async (userId?: string): Promise<UserAccount> => {
    const { authenticateWithBiometrics } = await import('../services/webAuthnService');
    const storedCred = await authenticateWithBiometrics(userId);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session || session.user.id !== storedCred.userId) {
      throw new Error('Lecture biométrique validée, mais aucune session active correspondante. Veuillez vous reconnecter par e-mail.');
    }

    const profile = await fetchProfile(session.user.id, session.user);
    if (!profile) {
      throw new Error('Profil introuvable ou compte désactivé. Veuillez vous reconnecter par e-mail.');
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
    <UserContext.Provider value={{ user, loading, login, loginWithBiometrics, logout }}>
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
