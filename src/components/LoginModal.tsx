/**
 * Modale de connexion et de bascule de compte (Administrateur / Caporal)
 * Permet de s'authentifier avec identifiant et mot de passe sécurisé
 */

import React, { useState } from 'react';
import { X, Lock, User, LogOut, CheckCircle2, AlertCircle } from 'lucide-react';
import { UserAccount } from '../types';
import { supabase } from '../services/supabaseClient';
import { useUser } from '../context/UserContext';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserAccount;
  onLoginSuccess: (user: UserAccount) => void;
  onLogout: () => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onLoginSuccess,
  onLogout,
}) => {
  const { login } = useUser();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

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
      
      setSuccessMsg(`Connecté avec succès !`);
      
      setTimeout(() => {
        onClose();
        // Trigger a refresh or navigation if needed
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white rounded-3xl max-w-sm w-full overflow-hidden shadow-2xl border border-slate-200">
        <div className="bg-slate-900 text-white p-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-600 flex items-center justify-center text-white font-black text-sm">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-black text-sm">Compte & Accès</h3>
              <p className="text-[11px] text-slate-400">Connexion</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-full transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4 text-xs">
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center text-white font-black ${
                  currentUser.role === 'admin' ? 'bg-amber-600' : 'bg-emerald-600'
                }`}
              >
                {currentUser.role === 'admin' ? '👑' : '🌾'}
              </div>
              <div>
                <p className="font-black text-slate-900 text-xs">{currentUser.nom}</p>
                <p className="text-[10px] text-slate-500 font-medium">
                  Rôle : {currentUser.role === 'admin' ? 'Administrateur' : 'Caporal (Récolte)'}
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
              className="flex items-center gap-1 bg-red-50 hover:bg-red-100 text-red-700 font-bold px-2.5 py-1.5 rounded-xl text-[11px] border border-red-200 transition"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Quitter</span>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <h4 className="font-bold text-slate-800 text-xs">Se connecter :</h4>

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
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 pl-8 text-xs font-bold text-slate-800 outline-none focus:border-emerald-600 focus:bg-white transition"
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
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 pl-8 text-xs font-bold text-slate-800 outline-none focus:border-emerald-600 focus:bg-white transition"
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
              className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-black py-2.5 rounded-xl text-xs shadow-md transition active:scale-95"
            >
              {loading ? 'Connexion en cours...' : 'Se connecter'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
