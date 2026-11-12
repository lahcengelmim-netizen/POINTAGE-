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
  Building2,
  CheckCircle,
  AlertCircle,
  Eye,
  EyeOff,
  RefreshCw,
  KeyRound,
} from 'lucide-react';
import { Domaine, Serre, UserAccount } from '../../types';

interface ContractuelCaporalManagementProps {
  domaines: Domaine[];
  serres: Serre[];
  currentUser: UserAccount;
}

export const ContractuelCaporalManagement: React.FC<ContractuelCaporalManagementProps> = ({
  domaines,
  serres,
  currentUser,
}) => {
  const [caporaux, setCaporaux] = useState<UserAccount[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Formulaire de création
  const [username, setUsername] = useState<string>('');
  const [nom, setNom] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [selectedDomaines, setSelectedDomaines] = useState<string[]>(() => domaines.map((d) => d.id));
  const [selectedSerres, setSelectedSerres] = useState<string[]>(() => serres.map((s) => s.id));
  const [creating, setCreating] = useState<boolean>(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    loadAccounts();
  }, []);

  async function loadAccounts() {
    setLoading(true);
    try {
      const res = await fetch('/api/users');
      const data = await res.json();
      if (res.ok && data.success && Array.isArray(data.users)) {
        // Filtrer les comptes caporaux (notamment ceux liés aux contractuelles)
        const capList = data.users.filter(
          (u: UserAccount) =>
            u.role === 'caporal_contractuelles' ||
            u.module_attribue === 'contractuelles' ||
            u.role === 'caporal'
        );
        setCaporaux(capList);
      }
    } catch (err) {
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

    if (selectedDomaines.length === 0) {
      setErrorMsg('Veuillez affecter au moins un domaine au Caporal.');
      return;
    }

    setCreating(true);
    try {
      const res = await fetch('/api/create-caporal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim().toLowerCase(),
          nom: nom.trim(),
          password: password.trim(),
          role: 'caporal_contractuelles',
          module_attribue: 'contractuelles',
          domaines_autorises: selectedDomaines,
          serres_autorisees: selectedSerres,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setSuccessMsg(
          `Compte Caporal Contractuelles "${username}" créé avec succès ! Il aura un accès strictement restreint à ce module.`
        );
        setUsername('');
        setNom('');
        setPassword('');
        loadAccounts();
      } else {
        setErrorMsg(data.error || 'Erreur lors de la création du compte Caporal.');
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
            Accès Caporal Dédié — Contractuelles
          </h3>
        </div>
        <p className="text-xs text-emerald-100/90 leading-relaxed">
          Créez un compte dédié pour votre responsable des ouvriers contractuels sur le terrain.
          Ce compte aura une interface mobile épurée pour saisir les présences, tâches et serres,
          <strong> sans pouvoir accéder</strong> aux autres modules (Stock, Récolte, Pointage Matin, Réglages).
        </p>
      </div>

      {/* 2. FORMULAIRE DE CRÉATION DE COMPTE CAPORAL */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 space-y-4">
        <h4 className="text-xs font-black uppercase text-slate-800 flex items-center gap-2 pb-2 border-b border-slate-100">
          <UserPlus className="w-4 h-4 text-emerald-600" />
          Créer un nouveau compte Caporal Contractuelles
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">
                Identifiant de connexion <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <User className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  required
                  placeholder="ex: caporal_contractuel_1"
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
                placeholder="ex: Mohamed (Caporal Contractuelles)"
                value={nom}
                onChange={(e) => setNom(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 outline-none focus:border-emerald-500"
              />
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

          {/* Domaines affectés */}
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

          <div className="pt-2 flex justify-end">
            <button
              type="submit"
              disabled={creating}
              className="bg-emerald-700 hover:bg-emerald-800 text-white font-black text-xs px-4 py-2.5 rounded-xl shadow-xs transition active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              {creating ? 'Création en cours...' : 'Créer le compte Caporal'}
            </button>
          </div>
        </form>
      </div>

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
              const isContractuel =
                c.role === 'caporal_contractuelles' || c.module_attribue === 'contractuelles';

              return (
                <div key={c.id} className="py-2.5 flex items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs font-black text-slate-900">{c.username}</span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-black ${
                          isContractuel
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-purple-100 text-purple-800'
                        }`}
                      >
                        {isContractuel ? 'Caporal Contractuelles' : 'Caporal Récolte'}
                      </span>
                    </div>
                    <span className="text-xs text-slate-600">{c.nom}</span>
                    {c.domaines_autorises && c.domaines_autorises.length > 0 && (
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        Domaines : {c.domaines_autorises.map((id) => id.replace('dom_', '')).join(', ')}
                      </div>
                    )}
                  </div>

                  <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg">
                    Actif
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
