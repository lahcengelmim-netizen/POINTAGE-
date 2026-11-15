/**
 * Page d'Authentification dédiée pour LAHCEN POINTEUR
 * - Affichage du logo officiel LAHCEN POINTEUR – POINTAGE AGRICOLE sans déformation
 * - Arrière-plan moderne vert agricole et blanc avec touches orange
 * - Authentification sécurisée via Supabase Auth & Biométrie WebAuthn
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

const OFFICIAL_LOGO_SRC =
  '/assets/aistudio/Logo_d_application_agricole_avec_pointage_4d078075.png';

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
    <div className="min-h-screen bg-gradient-to-b from-emerald-50 via-white to-emerald-100/70 text-slate-900 flex flex-col justify-center items-center px-4 py-6 sm:py-10 selection:bg-emerald-600 selection:text-white relative overflow-x-hidden">
      {/* Bandeau supérieur vert agricole épuré (aucune surcharge visuelle) */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-56 sm:h-64 bg-gradient-to-br from-emerald-950 via-emerald-900 to-green-800 border-b-4 border-orange-500/90 pointer-events-none"
      />
      <div
        aria-hidden="true"
        className="absolute -bottom-24 right-0 w-80 h-80 bg-emerald-200/40 rounded-full blur-3xl pointer-events-none"
      />

      {/* Conteneur principal centré — adapté mobile, tablette et ordinateur */}
      <div className="w-full max-w-md sm:max-w-[460px] bg-white rounded-3xl border border-emerald-200/90 shadow-2xl shadow-emerald-950/15 overflow-hidden relative z-10 my-auto">
        {/* En-tête officiel avec Logo LAHCEN POINTEUR centré */}
        <div className="px-5 pt-6 pb-5 sm:px-8 sm:pt-7 sm:pb-6 text-center bg-white border-b border-emerald-100">
          <div className="mx-auto w-full max-w-[240px] sm:max-w-[300px] flex items-center justify-center mb-3">
            <img
              src={OFFICIAL_LOGO_SRC}
              alt="LAHCEN POINTEUR – POINTAGE AGRICOLE"
              width={1536}
              height={1024}
              loading="eager"
              decoding="async"
              fetchPriority="high"
              className="w-full h-auto max-h-40 sm:max-h-48 object-contain select-none"
            />
          </div>

          <h1 className="text-lg sm:text-xl font-black text-emerald-950 tracking-wider uppercase leading-tight">
            LAHCEN <span className="text-orange-600">POINTEUR</span>
          </h1>
          <div className="mt-1 flex items-center justify-center gap-2">
            <span className="h-0.5 w-6 bg-emerald-600 rounded-full" />
            <p className="text-[11px] sm:text-xs font-extrabold text-emerald-700 tracking-[0.18em] uppercase">
              POINTAGE AGRICOLE
            </p>
            <span className="h-0.5 w-6 bg-orange-500 rounded-full" />
          </div>

          <div className="mt-3.5 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-bold">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
            <span>Authentification Sécurisée Supabase Auth</span>
          </div>
        </div>

        {/* Corps du Formulaire */}
        <div className="p-5 sm:p-8 space-y-5 bg-white">
          {/* Message d'erreur */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-3.5 text-xs text-red-800 font-semibold flex items-start gap-2.5 animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div className="leading-relaxed">{error}</div>
            </div>
          )}

          {/* Option de Connexion Rapide par Empreinte si déjà enregistrée sur cet appareil */}
          {bioSupported && storedBioCred && (
            <div className="p-4 bg-emerald-50/90 border border-emerald-200 rounded-2xl text-center space-y-2.5 animate-in fade-in">
              <div className="flex items-center justify-center gap-2 text-xs font-bold text-emerald-900">
                <Fingerprint className="w-5 h-5 text-emerald-700 animate-pulse" />
                <span>
                  الدخول بالبصمة للمستخدم : <strong>{storedBioCred.nom}</strong>
                </span>
              </div>
              <button
                type="button"
                onClick={handleBiometricLogin}
                disabled={bioLoading}
                className="w-full py-3 px-4 bg-emerald-700 hover:bg-emerald-800 active:scale-98 disabled:opacity-50 text-white font-black text-xs sm:text-sm rounded-xl shadow-md shadow-emerald-900/20 flex items-center justify-center gap-2 transition cursor-pointer"
              >
                {bioLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>جاري قراءة البصمة...</span>
                  </>
                ) : (
                  <>
                    <Fingerprint className="w-5 h-5 text-orange-300" />
                    <span>فتح التطبيق بالبصمة (Connexion par empreinte)</span>
                  </>
                )}
              </button>
              <p className="text-[10px] text-emerald-800/80 font-medium">
                أو استخدم البريد الإلكتروني وكلمة المرور أدناه لاسترجاع الدخول.
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Champ E-mail / Identifiant */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-emerald-950 mb-1.5 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-emerald-700" />
                <span>Adresse E-mail ou Identifiant</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={emailOrUsername}
                  onChange={(e) => setEmailOrUsername(e.target.value)}
                  placeholder="ex: lahcengelmim@gmail.com ou identifiant"
                  autoCapitalize="none"
                  autoCorrect="off"
                  required
                  className="w-full bg-emerald-50/40 border border-emerald-200 rounded-xl px-4 py-3 pl-10 text-sm font-semibold text-slate-900 placeholder-slate-400 focus:outline-hidden focus:bg-white focus:border-emerald-700 focus:ring-2 focus:ring-emerald-600/20 transition"
                />
                <Mail className="w-4 h-4 text-emerald-700/70 absolute left-3.5 top-3.5 pointer-events-none" />
              </div>
            </div>

            {/* Champ Mot de passe */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-emerald-950 mb-1.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-emerald-700" />
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
                  className="w-full bg-emerald-50/40 border border-emerald-200 rounded-xl px-4 py-3 pl-10 pr-10 text-sm font-semibold text-slate-900 placeholder-slate-400 focus:outline-hidden focus:bg-white focus:border-emerald-700 focus:ring-2 focus:ring-emerald-600/20 transition"
                />
                <Lock className="w-4 h-4 text-emerald-700/70 absolute left-3.5 top-3.5 pointer-events-none" />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-3.5 text-slate-500 hover:text-emerald-800 transition cursor-pointer"
                  aria-label="Afficher ou masquer le mot de passe"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Case à cocher optionnelle pour la biométrie */}
            {bioSupported ? (
              <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer pt-1 selection:bg-none">
                <input
                  type="checkbox"
                  checked={enableBioCheckbox}
                  onChange={(e) => setEnableBioCheckbox(e.target.checked)}
                  className="w-4 h-4 rounded-md border-emerald-300 bg-white text-emerald-700 focus:ring-emerald-600/30 cursor-pointer accent-emerald-700"
                />
                <span className="font-semibold text-emerald-950">
                  تفعيل الدخول بالبصمة على هذا الجهاز
                </span>
              </label>
            ) : (
              bioSupported === false && (
                <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[11px] text-slate-600 flex items-center gap-2">
                  <Fingerprint className="w-4 h-4 text-slate-400 shrink-0" />
                  <span>هذا الجهاز أو المتصفح لا يدعم المصادقة بالبصمة (WebAuthn).</span>
                </div>
              )
            )}

            {/* Bouton de Soumission */}
            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-3.5 px-4 bg-gradient-to-r from-emerald-900 via-emerald-800 to-green-700 hover:from-emerald-800 hover:to-green-600 active:scale-98 disabled:opacity-50 text-white font-black text-sm rounded-xl shadow-lg shadow-emerald-950/20 border-b-2 border-orange-500 transition flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Vérification en cours...</span>
                </>
              ) : (
                <>
                  <Key className="w-4 h-4 text-orange-300" />
                  <span>Se connecter à LAHCEN POINTEUR</span>
                </>
              )}
            </button>
          </form>

          {/* Bouton d'aide / Explications de liaison de compte */}
          <div className="pt-3 text-center border-t border-emerald-100">
            <button
              type="button"
              onClick={() => setShowGuideModal(true)}
              className="inline-flex items-center gap-1.5 text-xs text-emerald-800 hover:text-orange-600 font-semibold transition cursor-pointer"
            >
              <HelpCircle className="w-3.5 h-3.5 text-orange-500" />
              <span>Comment connecter un compte existant ?</span>
            </button>
          </div>
        </div>

        {/* Pied de page */}
        <div className="px-6 py-3 bg-emerald-950 text-center text-[11px] text-emerald-100/90 font-semibold">
          LAHCEN POINTEUR — Pointage Agricole Pro
        </div>
      </div>

      {/* MODALE D'EXPLICATION POUR LA LIAISON SÉCURISÉE DES COMPTES */}
      {showGuideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-emerald-950/75 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white border border-emerald-200 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl text-slate-700 text-xs leading-relaxed">
            <div className="flex items-center justify-between pb-3 border-b border-emerald-100">
              <div className="flex items-center gap-2 font-black text-emerald-950 text-sm">
                <UserCheck className="w-5 h-5 text-emerald-700" />
                <span>Guide de Liaison des Comptes Supabase</span>
              </div>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="text-slate-400 hover:text-emerald-900 transition cursor-pointer p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2.5">
              <p className="text-slate-700 font-medium">
                Pour garantir la sécurité et la confidentialité des données de l'exploitation agricole, chaque compte (Administrateur ou Caporal) est authentifié directement via <strong>Supabase Auth</strong>.
              </p>

              <div className="p-3 bg-emerald-50/70 rounded-2xl border border-emerald-200 space-y-1.5">
                <p className="font-bold text-emerald-800 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                  1. Comptes Administrateurs :
                </p>
                <p className="text-[11px] text-slate-600">
                  Connectez-vous avec votre adresse e-mail d'administration Supabase Auth (ex: <code className="text-orange-700 font-mono font-bold">lahcengelmim@gmail.com</code>).
                </p>
              </div>

              <div className="p-3 bg-emerald-50/70 rounded-2xl border border-emerald-200 space-y-1.5">
                <p className="font-bold text-emerald-800 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                  2. Comptes Caporaux / العمال :
                </p>
                <p className="text-[11px] text-slate-600">
                  Saisissez votre e-mail dédié ou votre identifiant de caporal. Le profil correspondant est chargé automatiquement depuis la table <code className="text-emerald-800 font-mono font-bold">profiles</code> avec vos droits spécifiques.
                </p>
              </div>

              <div className="p-3 bg-orange-50 border border-orange-200 rounded-2xl text-orange-900 text-[11px]">
                <strong>Remarque importante :</strong> Aucune donnée historique (pointages, récoltes, stock) n'est modifiée ou supprimée. Les comptes créés sur Supabase Auth sont automatiquement rattachés à leur profil existant par UUID.
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowGuideModal(false)}
              className="w-full py-2.5 bg-emerald-800 hover:bg-emerald-900 text-white font-black rounded-xl transition cursor-pointer"
            >
              J'ai compris
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
