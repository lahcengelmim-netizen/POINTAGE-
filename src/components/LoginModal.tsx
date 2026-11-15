/**
 * Modale de connexion et de bascule de compte (Administrateur / Caporal)
 * Permet de s'authentifier avec identifiant et mot de passe sécurisé
 */

import React, { useState } from 'react';
import { X, Lock, User, LogOut, CheckCircle2, AlertCircle, Building2 } from 'lucide-react';
import { UserAccount } from '../types';
import { supabase } from '../services/supabaseClient';
import { useUser } from '../context/UserContext';

const OFFICIAL_LOGO_SRC =
  '/assets/aistudio/Logo_d_application_agricole_avec_pointage_4d078075.png';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserAccount;
  companyName?: string;
  onLoginSuccess: (user: UserAccount) => void;
  onLogout: () => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  companyName,
  onLogout,
}) => {
  const { login } = useUser();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const roleLabel =
    currentUser.role === 'admin'
      ? 'Administrateur'
      : currentUser.role === 'caporal_contractuelles'
      ? 'Caporal (Contractuelles)'
      : 'Caporal (Récolte)';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (!username.trim()) {
      setError("Veuillez saisir votre identifiant.");
      return;
    }
    if (!password) {
      setError("Veuillez saisir votre mot de passe.");
      return;
    }

    setLoading(true);
    try {
      await login(username, password);

      setSuccessMsg('Connecté avec succès !');

      setTimeout(() => {
        onClose();
        window.location.reload();
      }, 800);
    } catch (err: any) {
      console.error('Login error:', err);
      setError(err.message || 'Identifiant ou mot de passe incorrect.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-emerald-950/70 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white rounded-3xl max-w-sm w-full overflow-hidden shadow-2xl border border-emerald-200">
        {/* En-tête du profil utilisateur avec logo LAHCEN POINTEUR */}
        <div className="bg-gradient-to-r from-emerald-950 via-emerald-900 to-green-800 text-white px-4 py-3.5 flex items-center justify-between border-b-2 border-orange-500">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-15 h-10 rounded-xl bg-white p-1 shadow-xs border border-orange-400/60 flex items-center justify-center shrink-0">
              <img
                src={OFFICIAL_LOGO_SRC}
                alt="LAHCEN POINTEUR – POINTAGE AGRICOLE"
                width={1536}
                height={1024}
                decoding="async"
                className="w-full h-full object-contain"
              />
            </div>
            <div className="min-w-0">
              <h3 className="font-black text-sm tracking-wide truncate text-white">
                LAHCEN <span className="text-orange-400">POINTEUR</span>
              </h3>
              <p className="text-[10px] text-emerald-200 font-semibold uppercase tracking-wider truncate">
                Pointage Agricole • Compte & Profil
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-emerald-200 hover:text-white p-1 rounded-full transition cursor-pointer shrink-0"
            aria-label="Fermer la fenêtre de profil"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4 text-xs">
          {/* Carte Profil utilisateur actuel */}
          <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-black shrink-0 shadow-xs ${
                  currentUser.role === 'admin' ? 'bg-orange-500' : 'bg-emerald-700'
                }`}
              >
                {currentUser.role === 'admin' ? '👑' : '🌾'}
              </div>
              <div className="min-w-0">
                <p className="font-black text-emerald-950 text-xs truncate">{currentUser.nom}</p>
                <p className="text-[10px] text-emerald-800 font-bold truncate">
                  Rôle : {roleLabel}
                </p>
                <p className="text-[10px] text-slate-600 font-medium flex items-center gap-1 truncate mt-0.5">
                  <Building2 className="w-3 h-3 text-emerald-700 shrink-0" />
                  <span className="truncate">{companyName || currentUser.company_id}</span>
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={async () => {
                await supabase.auth.signOut();
                onLogout();
                onClose();
              }}
              className="flex items-center gap-1 bg-red-50 hover:bg-red-100 text-red-700 font-bold px-2.5 py-1.5 rounded-xl text-[11px] border border-red-200 transition shrink-0 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Quitter</span>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <h4 className="font-bold text-emerald-950 text-xs">Changer de compte / Se connecter :</h4>

            <div>
              <label className="text-[11px] font-bold text-slate-700 block mb-1">
                Nom d'utilisateur :
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.trim())}
                  placeholder="ex: caporal_brahim"
                  autoCapitalize="none"
                  autoCorrect="off"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 pl-8 text-xs font-bold text-slate-800 outline-none focus:border-emerald-700 focus:bg-white transition"
                />
                <User className="w-4 h-4 text-slate-400 absolute left-2.5 top-3" />
              </div>
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-700 block mb-1">
                Mot de passe :
              </label>
              <div className="relative">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 pl-8 text-xs font-bold text-slate-800 outline-none focus:border-emerald-700 focus:bg-white transition"
                />
                <Lock className="w-4 h-4 text-slate-400 absolute left-2.5 top-3" />
              </div>
            </div>

            {error && (
              <div className="p-2.5 bg-red-50 border border-red-200 text-red-900 rounded-xl text-[11px] font-bold flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {successMsg && (
              <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-950 rounded-xl text-[11px] font-bold flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{successMsg}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-800 hover:bg-emerald-900 disabled:bg-slate-300 text-white font-black py-2.5 rounded-xl text-xs shadow-md transition active:scale-95 cursor-pointer"
            >
              {loading ? 'Connexion en cours...' : 'Se connecter'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
