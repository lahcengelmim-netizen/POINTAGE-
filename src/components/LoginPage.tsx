/**
 * Page d'Authentification dédiée pour AGRIPOINTAGE
 * - Affichage du logo et du nom officiel AGRIPOINTAGE
 * - Authentification sécurisée via Supabase Auth
 * - Formulaire pour Administrateurs et Caporaux (Email & Mot de passe)
 * - Gestion des erreurs d'authentification sans exposition de secrets
 * - Guide de liaison des comptes existants sans perte de données
 */

import React, { useState, useEffect } from 'react';
import {
  Lock,
  Mail,
  Eye,
  EyeOff,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  X,
  Sparkles,
  UserCheck,
  Key,
  Fingerprint,
} from 'lucide-react';
import { useUser } from '../context/UserContext';
import {
  isBiometricSupported,
  getStoredBiometricCredential,
  registerBiometricCredential,
  StoredBiometricCredential,
} from '../services/webAuthnService';

export const LoginPage: React.FC = () => {
  const { login, loginWithBiometrics } = useUser();
  const [emailOrUsername, setEmailOrUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [bioLoading, setBioLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGuideModal, setShowGuideModal] = useState(false);

  // Biométrie
  const [bioSupported, setBioSupported] = useState<boolean | null>(null);
  const [storedBioCred, setStoredBioCred] = useState<StoredBiometricCredential | null>(null);
  const [enableBioCheckbox, setEnableBioCheckbox] = useState(false);

  useEffect(() => {
    let isMounted = true;
    async function checkBio() {
      const supported = await isBiometricSupported();
      if (!isMounted) return;
      setBioSupported(supported);
      if (supported) {
        const cred = getStoredBiometricCredential();
        setStoredBioCred(cred);
      }
    }
    checkBio();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleBiometricLogin = async () => {
    setError(null);
    setBioLoading(true);
    try {
      await loginWithBiometrics(storedBioCred?.userId);
    } catch (err: any) {
      console.error('Erreur connexion biométrique:', err);
      setError(
        err.message ||
          'Empreinte non reconnue ou annulée. Vous pouvez toujours vous connecter avec votre mot de passe.'
      );
    } finally {
      setBioLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const input = emailOrUsername.trim();
    if (!input) {
      setError('Veuillez saisir votre adresse e-mail ou identifiant.');
      return;
    }
    if (!password) {
      setError('Veuillez saisir votre mot de passe.');
      return;
    }

    setLoading(true);
    try {
      const userAcc = await login(input, password);
      if (enableBioCheckbox && bioSupported) {
        try {
          await registerBiometricCredential(userAcc.id, userAcc.username, userAcc.nom);
        } catch (bioErr: any) {
          console.warn('Création empreinte ignorée/annulée:', bioErr.message);
        }
      }
    } catch (err: any) {
      console.error('Erreur authentification:', err);
      setError(
        err.message ||
          'Adresse e-mail ou mot de passe incorrect. Veuillez vérifier vos identifiants.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col justify-center items-center p-4 selection:bg-emerald-500 selection:text-white relative overflow-hidden">
      {/* Arrière-plan décoratif agricole */}
      <div className="absolute -top-32 -left-32 w-96 h-96 bg-emerald-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Conteneur principal de la carte de connexion */}
      <div className="w-full max-w-md bg-slate-800/90 backdrop-blur-md rounded-3xl border border-slate-700/80 shadow-2xl overflow-hidden relative z-10 my-auto">
        {/* En-tête de Marque AGRIPOINTAGE */}
        <div className="p-6 sm:p-8 text-center bg-linear-to-b from-slate-800 to-slate-800/60 border-b border-slate-700/60">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-linear-to-tr from-emerald-600 to-emerald-400 text-white font-black shadow-xl shadow-emerald-900/40 mb-4 ring-4 ring-emerald-500/20 animate-in zoom-in duration-300">
            <span className="text-3xl tracking-tighter font-black">🌾</span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-black text-white tracking-wider uppercase font-mono mb-1">
            AGRI<span className="text-emerald-400">POINTAGE</span>
          </h1>
          <p className="text-xs font-semibold text-slate-400 tracking-wide">
            Système Pro de Pointage & Gestion Agricole
          </p>

          <div className="mt-4 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-bold">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Authentification Sécurisée Supabase Auth</span>
          </div>
        </div>

        {/* Corps du Formulaire */}
        <div className="p-6 sm:p-8 space-y-5">
          {/* Message d'erreur */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-3.5 text-xs text-red-300 font-medium flex items-start gap-2.5 animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div className="leading-relaxed">{error}</div>
            </div>
          )}

          {/* Option de Connexion Rapide par Empreinte si déjà enregistrée sur cet appareil */}
          {bioSupported && storedBioCred && (
            <div className="p-4 bg-emerald-950/40 border border-emerald-500/30 rounded-2xl text-center space-y-2.5 animate-in fade-in">
              <div className="flex items-center justify-center gap-2 text-xs font-bold text-emerald-300">
                <Fingerprint className="w-5 h-5 text-emerald-400 animate-pulse" />
                <span>الدخول بالبصمة للمستخدم : <strong>{storedBioCred.nom}</strong></span>
              </div>
              <button
                type="button"
                onClick={handleBiometricLogin}
                disabled={bioLoading}
                className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 active:scale-98 disabled:opacity-50 text-white font-black text-xs sm:text-sm rounded-xl shadow-lg shadow-emerald-900/40 flex items-center justify-center gap-2 transition cursor-pointer"
              >
                {bioLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>جاري قراءة البصمة...</span>
                  </>
                ) : (
                  <>
                    <Fingerprint className="w-5 h-5 text-emerald-200" />
                    <span>فتح التطبيق بالبصمة (Connexion par empreinte)</span>
                  </>
                )}
              </button>
              <p className="text-[10px] text-slate-400 font-medium">
                أو استخدم البريد الإلكتروني وكلمة المرور أدناه لاسترجاع الدخول.
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Champ E-mail / Identifiant */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-emerald-400" />
                <span>Adresse E-mail ou Identifiant</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={emailOrUsername}
                  onChange={(e) => setEmailOrUsername(e.target.value)}
                  placeholder="ex: admin@agripointage.ma ou lahcengelmim@gmail.com"
                  autoCapitalize="none"
                  autoCorrect="off"
                  required
                  className="w-full bg-slate-900/80 border border-slate-700 rounded-xl px-4 py-3 pl-10 text-sm font-semibold text-white placeholder-slate-500 focus:outline-hidden focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition"
                />
                <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5 pointer-events-none" />
              </div>
            </div>

            {/* Champ Mot de passe */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-emerald-400" />
                  Mot de passe
                </span>
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full bg-slate-900/80 border border-slate-700 rounded-xl px-4 py-3 pl-10 pr-10 text-sm font-semibold text-white placeholder-slate-500 focus:outline-hidden focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition"
                />
                <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5 pointer-events-none" />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-3.5 text-slate-400 hover:text-white transition cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Case à cocher optionnelle pour la biométrie */}
            {bioSupported ? (
              <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer pt-1 selection:bg-none">
                <input
                  type="checkbox"
                  checked={enableBioCheckbox}
                  onChange={(e) => setEnableBioCheckbox(e.target.checked)}
                  className="w-4 h-4 rounded-md border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500/30 cursor-pointer"
                />
                <span className="font-semibold text-slate-200">
                  تفعيل الدخول بالبصمة على هذا الجهاز
                </span>
              </label>
            ) : (
              bioSupported === false && (
                <div className="p-2.5 bg-slate-900/60 border border-slate-700/60 rounded-xl text-[11px] text-slate-400 flex items-center gap-2">
                  <Fingerprint className="w-4 h-4 text-slate-500 shrink-0" />
                  <span>هذا الجهاز أو المتصفح لا يدعم المصادقة بالبصمة (WebAuthn).</span>
                </div>
              )
            )}

            {/* Bouton de Soumission */}

            {/* Bouton de Soumission */}
            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-3.5 px-4 bg-linear-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 active:scale-98 disabled:opacity-50 text-white font-black text-sm rounded-xl shadow-lg shadow-emerald-900/30 transition flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Vérification en cours...</span>
                </>
              ) : (
                <>
                  <Key className="w-4 h-4" />
                  <span>Se connecter à AGRIPOINTAGE</span>
                </>
              )}
            </button>
          </form>

          {/* Bouton d'aide / Explications de liaison de compte */}
          <div className="pt-2 text-center border-t border-slate-700/60">
            <button
              type="button"
              onClick={() => setShowGuideModal(true)}
              className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-emerald-400 font-medium transition cursor-pointer"
            >
              <HelpCircle className="w-3.5 h-3.5 text-emerald-400" />
              <span>Comment connecter un compte existant ?</span>
            </button>
          </div>
        </div>

        {/* Pied de page */}
        <div className="px-6 py-3 bg-slate-900/60 border-t border-slate-700/40 text-center text-[11px] text-slate-500 font-medium">
          Exploitation Agricole Lahcen Pointeur — Version Pro
        </div>
      </div>

      {/* MODALE D'EXPLICATION POUR LA LIAISON SÉCURISÉE DES COMPTES */}
      {showGuideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-in fade-in">
          <div className="bg-slate-800 border border-slate-700 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl text-slate-200 text-xs leading-relaxed">
            <div className="flex items-center justify-between pb-3 border-b border-slate-700">
              <div className="flex items-center gap-2 font-black text-white text-sm">
                <UserCheck className="w-5 h-5 text-emerald-400" />
                <span>Guide de Liaison des Comptes Supabase</span>
              </div>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="text-slate-400 hover:text-white transition cursor-pointer p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2.5">
              <p className="text-slate-300 font-medium">
                Pour garantir la sécurité et la confidentialité des données de l'exploitation agricole, chaque compte (Administrateur ou Caporal) est authentifié directement via <strong>Supabase Auth</strong>.
              </p>

              <div className="p-3 bg-slate-900/80 rounded-2xl border border-slate-700/80 space-y-1.5">
                <p className="font-bold text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  1. Comptes Administrateurs :
                </p>
                <p className="text-[11px] text-slate-400">
                  Connectez-vous avec votre adresse e-mail d'administration Supabase Auth (ex: <code className="text-amber-300 font-mono">lahcengelmim@gmail.com</code>).
                </p>
              </div>

              <div className="p-3 bg-slate-900/80 rounded-2xl border border-slate-700/80 space-y-1.5">
                <p className="font-bold text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  2. Comptes Caporaux / العمال :
                </p>
                <p className="text-[11px] text-slate-400">
                  Saisissez votre e-mail dédié ou votre identifiant de caporal. Le profil correspondant est chargé automatiquement depuis la table <code className="text-emerald-300 font-mono">profiles</code> avec vos droits spécifiques.
                </p>
              </div>

              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-amber-200 text-[11px]">
                <strong>Remarque importante :</strong> Aucune donnée historique (pointages, récoltes, stock) n'est modifiée ou supprimée. Les comptes créés sur Supabase Auth sont automatiquement rattachés à leur profil existant par UUID.
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowGuideModal(false)}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-xl transition cursor-pointer"
            >
              J'ai compris
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
