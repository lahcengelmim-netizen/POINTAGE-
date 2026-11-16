/**
 * Gestion administrative du Caporal Dédié aux Contractuelles
 * - Création de compte d'accès indépendant pour le Caporal Contractuelles
 * - Affectation stricte des domaines (D1 à D5) et serres autorisées
 * - Ce compte ne peut accéder qu'au module Contractuelles
 */

import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  UserPlus,
  Lock,
  User,
  CheckCircle,
  AlertCircle,
  Eye,
  EyeOff,
  RefreshCw,
} from 'lucide-react';
import { Domaine, Serre, UserAccount, UserRole } from '../../types';
import { supabase } from '../../services/supabaseClient';
import { getCurrentUser } from '../../services/storage';

interface ContractuelCaporalManagementProps {
  domaines: Domaine[];
  serres: Serre[];
  currentUser: UserAccount;
  isReadOnly?: boolean;
}

async function getAdminAuthHeaders(): Promise<HeadersInit> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
      return headers;
    }
  } catch {
    // ignore
  }
  if (!import.meta.env.VITE_SUPABASE_URL) {
    const user = getCurrentUser();
    if (user?.role === 'lecteur') {
      headers['Authorization'] = 'Bearer dev_lecteur_token';
    } else if (user?.role === 'caporal_contractuelles' || user?.module_attribue === 'contractuelles') {
      headers['Authorization'] = 'Bearer dev_caporal_contractuel_token';
    } else if (user?.role === 'caporal') {
      headers['Authorization'] = 'Bearer dev_caporal_token';
    } else {
      headers['Authorization'] = 'Bearer dev_admin_token';
    }
  }
  return headers;
}

export const ContractuelCaporalManagement: React.FC<ContractuelCaporalManagementProps> = ({
  domaines,
  serres,
  currentUser,
  isReadOnly: propReadOnly = false,
}) => {
  const isReadOnly = propReadOnly || currentUser.role === 'lecteur';
  const [caporaux, setCaporaux] = useState<UserAccount[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Formulaire de création
  const [username, setUsername] = useState<string>('');
  const [nom, setNom] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [selectedRole, setSelectedRole] = useState<UserRole>('caporal_contractuelles');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [selectedDomaines, setSelectedDomaines] = useState<string[]>(() => domaines.map((d) => d.id));
  const [selectedSerres] = useState<string[]>(() => serres.map((s) => s.id));
  const [creating, setCreating] = useState<boolean>(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    loadAccounts();
    const onFocus = () => loadAccounts();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  async function loadAccounts() {
    setLoading(true);
    try {
      const headers = await getAdminAuthHeaders();
      const res = await fetch('/api/users', { headers });
      const data = await res.json();
      if (res.ok && data.success && Array.isArray(data.users)) {
        const capList = data.users.filter(
          (u: UserAccount) =>
            u.role === 'caporal_contractuelles' ||
            u.module_attribue === 'contractuelles' ||
            u.role === 'caporal' ||
            u.role === 'lecteur'
        );
        setCaporaux(capList);
      } else if (!res.ok) {
        setErrorMsg(data.error || 'Impossible de charger la liste des comptes.');
      }
    } catch (err: any) {
      console.warn('Erreur chargement utilisateurs:', err);
    } finally {
      setLoading(false);
    }
  }

  const handleToggleDomaine = (domId: string) => {
    setSelectedDomaines((prev) =>
      prev.includes(domId) ? prev.filter((id) => id !== domId) : [...prev, domId]
    );
  };

  const handleSelectAllDomaines = () => {
    if (selectedDomaines.length === domaines.length) {
      setSelectedDomaines([]);
    } else {
      setSelectedDomaines(domaines.map((d) => d.id));
    }
  };

  const handleCreateCaporal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) return;
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!username.trim() || !nom.trim() || !password.trim()) {
      setErrorMsg('Veuillez renseigner tous les champs obligatoires.');
      return;
    }

    if (password.length < 4) {
      setErrorMsg('Le mot de passe doit contenir au moins 4 caractères.');
      return;
    }

    if (selectedRole !== 'lecteur' && selectedDomaines.length === 0) {
      setErrorMsg('Veuillez affecter au moins un domaine au Caporal.');
      return;
    }

    setCreating(true);
    try {
      const headers = await getAdminAuthHeaders();
      const res = await fetch('/api/create-caporal', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          username: username.trim().toLowerCase(),
          nom: nom.trim(),
          password: password.trim(),
          role: selectedRole,
          module_attribue: selectedRole === 'lecteur' ? 'all' : 'contractuelles',
          domaines_autorises: selectedRole === 'lecteur' ? domaines.map((d) => d.id) : selectedDomaines,
          serres_autorisees: selectedSerres,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setSuccessMsg(
          selectedRole === 'lecteur'
            ? `Compte Lecteur "${username}" créé avec succès (consultation seule).`
            : `Compte Caporal Contractuelles "${username}" créé avec succès !`
        );
        setUsername('');
        setNom('');
        setPassword('');
        loadAccounts();
      } else {
        setErrorMsg(data.error || 'Erreur lors de la création du compte.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Erreur réseau.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 1. EN-TÊTE EXPLICATIF */}
      <div className="bg-emerald-900 text-white rounded-3xl p-5 shadow-sm space-y-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-emerald-400" />
          <h3 className="text-base font-black tracking-tight">
            Accès Caporal & Lecteur — Contractuelles
          </h3>
        </div>
        <p className="text-xs text-emerald-100/90 leading-relaxed">
          Créez un compte dédié pour votre responsable des ouvriers contractuels sur le terrain ou un compte Lecteur en consultation seule.
        </p>
      </div>

      {/* 2. FORMULAIRE DE CRÉATION DE COMPTE (Masqué en lecture seule) */}
      {!isReadOnly && (
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 space-y-4">
          <h4 className="text-xs font-black uppercase text-slate-800 flex items-center gap-2 pb-2 border-b border-slate-100">
            <UserPlus className="w-4 h-4 text-emerald-600" />
            Créer un nouveau compte Caporal / Lecteur
          </h4>

          {successMsg && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs p-3 rounded-xl flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {errorMsg && (
            <div className="bg-rose-50 border border-rose-200 text-rose-800 text-xs p-3 rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleCreateCaporal} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">
                  Identifiant / Email <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <User className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    required
                    placeholder="ex: tariq ou mahdi@lecture.com"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-9 pr-3 py-2 text-xs font-bold text-slate-900 outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">
                  Nom complet affiché <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="ex: Tariq / Mahdi"
                  value={nom}
                  onChange={(e) => setNom(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">
                  Type de compte
                </label>
                <select
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value as UserRole)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 outline-none focus:border-emerald-500"
                >
                  <option value="caporal_contractuelles">📋 Caporal Contractuelles</option>
                  <option value="lecteur">👁️ Lecteur (Consultation seule)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">
                Mot de passe <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="Au moins 4 caractères"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-9 pr-10 py-2 text-xs font-bold text-slate-900 outline-none focus:border-emerald-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {selectedRole !== 'lecteur' && (
              <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase text-slate-700">
                    Domaines autorisés pour ce caporal :
                  </span>
                  <button
                    type="button"
                    onClick={handleSelectAllDomaines}
                    className="text-[11px] text-emerald-700 hover:text-emerald-800 font-bold"
                  >
                    {selectedDomaines.length === domaines.length ? 'Désélectionner tout' : 'Tout cocher'}
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {domaines.map((dom) => {
                    const checked = selectedDomaines.includes(dom.id);
                    return (
                      <label
                        key={dom.id}
                        className={`flex items-center gap-2 p-2 rounded-xl border text-xs font-bold cursor-pointer transition ${
                          checked
                            ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                            : 'bg-white border-slate-200 text-slate-600'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => handleToggleDomaine(dom.id)}
                          className="rounded text-emerald-600 focus:ring-emerald-500"
                        />
                        <span>Domaine {dom.nom}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                disabled={creating}
                className="bg-emerald-700 hover:bg-emerald-800 text-white font-black text-xs px-4 py-2.5 rounded-xl shadow-xs transition active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {creating ? 'Création en cours...' : 'Créer le compte'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 3. LISTE DES CAPORAUX ENREGISTRÉS */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <h4 className="text-xs font-black uppercase text-slate-800">
            Comptes Caporaux Actifs
          </h4>
          <button
            type="button"
            onClick={loadAccounts}
            className="text-[11px] font-bold text-slate-500 hover:text-slate-800 flex items-center gap-1"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Actualiser</span>
          </button>
        </div>

        {loading ? (
          <div className="p-6 text-center text-slate-500">
            <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-1 text-emerald-600" />
            <span className="text-xs">Chargement...</span>
          </div>
        ) : caporaux.length === 0 ? (
          <p className="text-xs text-slate-500 italic text-center py-4">
            Aucun compte Caporal trouvé.
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {caporaux.map((c) => {
              const isLecteur = c.role === 'lecteur';
              const isContractuel =
                !isLecteur &&
                (c.role === 'caporal_contractuelles' || c.module_attribue === 'contractuelles');

              return (
                <div key={c.id} className="py-2.5 flex items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs font-black text-slate-900">{c.username}</span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-black ${
                          isLecteur
                            ? 'bg-sky-100 text-sky-900'
                            : isContractuel
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-purple-100 text-purple-800'
                        }`}
                      >
                        {isLecteur ? 'Lecteur (Lecture seule)' : isContractuel ? 'Caporal Contractuelles' : 'Caporal Récolte'}
                      </span>
                    </div>
                    <span className="text-xs text-slate-600">{c.nom}</span>
                    {!isLecteur && c.domaines_autorises && c.domaines_autorises.length > 0 && (
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        Domaines : {c.domaines_autorises.map((id) => id.replace('dom_', '')).join(', ')}
                      </div>
                    )}
                  </div>

                  <span className={`text-[11px] font-bold px-2 py-1 rounded-lg ${c.actif === false ? 'text-rose-700 bg-rose-50' : 'text-emerald-600 bg-emerald-50'}`}>
                    {c.actif === false ? 'Désactivé' : 'Actif'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
