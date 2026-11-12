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

  // Récupère ou crée le profil lié à l'UUID Supabase Auth
  const fetchProfile = async (userId: string, authUser?: any): Promise<UserAccount | null> => {
    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (profile) {
        let userCompId = profile.company_id;
        if (!userCompId) {
          const { data: comp } = await supabase.from('companies').select('id').limit(1);
          if (comp && comp.length > 0 && comp[0].id) {
            userCompId = comp[0].id;
          } else {
            userCompId = 'cie_lahcen_pointeur';
          }
        }

        const userEmail = (authUser?.email || '').toLowerCase();
        const isTariq = userEmail === 'tariq@caporal.com' || profile.username === 'tariq';
        const isContractuel =
          profile.role === 'caporal_contractuelles' ||
          profile.module_attribue === 'contractuelles' ||
          isTariq;

        const assignedModule = isContractuel ? 'contractuelles' : (profile.module_attribue || 'recolte');
        const assignedRole = isContractuel
          ? (profile.role === 'admin' ? 'admin' : 'caporal_contractuelles')
          : (profile.role || 'caporal');

        const userAcc: UserAccount = {
          id: profile.id,
          username: profile.username || userEmail.split('@')[0] || 'user',
          nom: profile.nom || (isTariq ? 'Tariq (Caporal Contractuelles)' : 'Utilisateur'),
          role: assignedRole as any,
          module_attribue: assignedModule as any,
          company_id: userCompId,
          actif: profile.actif !== false,
          createdAt: profile.created_at || new Date().toISOString(),
        };

        // Si tariq n'a pas encore module_attribue = 'contractuelles' enregistré dans public.profiles, mettre à jour la table
        if (isTariq && (profile.module_attribue !== 'contractuelles' || profile.role !== 'caporal_contractuelles')) {
          supabase
            .from('profiles')
            .update({ module_attribue: 'contractuelles', role: 'caporal_contractuelles' })
            .eq('id', profile.id)
            .then(() => {}, () => {});
        }

        storage.setCurrentUser(userAcc);
        return userAcc;
      }

      // Si le profil n'existe pas encore dans public.profiles (premier login), le créer avec son UUID Supabase Auth
      if (authUser) {
        const userEmail = (authUser.email || '').toLowerCase();
        const isTariq = userEmail === 'tariq@caporal.com';
        const isAdminEmail = userEmail === 'lahcengelmim@gmail.com' || userEmail.startsWith('admin');
        const role = isTariq
          ? 'caporal_contractuelles'
          : (authUser.user_metadata?.role || (isAdminEmail ? 'admin' : 'caporal'));
        const nom =
          authUser.user_metadata?.nom ||
          (role === 'admin' ? 'Lahcen (Administrateur)' : isTariq ? 'Tariq (Caporal Contractuelles)' : 'Caporal (Récolte)');
        const username =
          authUser.user_metadata?.username || userEmail.split('@')[0] || 'user';
        const module_attribue = isTariq ? 'contractuelles' : (authUser.user_metadata?.module_attribue || 'recolte');

        const newProfile = {
          id: userId,
          username,
          nom,
          role,
          module_attribue,
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
          role: finalProfile.role as any,
          module_attribue: (finalProfile as any).module_attribue || 'contractuelles',
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

  const loginWithBiometrics = async (userId?: string): Promise<UserAccount> => {
    const { authenticateWithBiometrics } = await import('../services/webAuthnService');
    const storedCred = await authenticateWithBiometrics(userId);

    // Vérifier la session Supabase ou récupérer le profil directement
    const { data: { session } } = await supabase.auth.getSession();
    let profile: UserAccount | null = null;

    if (session && session.user.id === storedCred.userId) {
      profile = await fetchProfile(session.user.id, session.user);
    } else {
      profile = await fetchProfile(storedCred.userId);
    }

    if (!profile) {
      throw new Error('Lecture biométrique validée, mais session introuvable. Veuillez vous reconnecter par e-mail.');
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
