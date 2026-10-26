/**
 * En-tête de l'application Lahcen Pointeur
 * Optimisé pour smartphone, affichant uniquement "Lahcen Pointeur"
 * Avec sélecteur de date, bouton Heures supplémentaires et statut hors-ligne
 */

import React, { useState } from 'react';
import { Calendar, Download, WifiOff, Clock } from 'lucide-react';
import { Company, UserAccount } from '../types';
import { usePWAInstall, useOnlineStatus } from '../hooks/usePWAInstall';
import { formatDateJJMM } from '../utils/whatsappFormatter';

interface HeaderProps {
  currentCompany?: Company;
  companies?: Company[];
  onSwitchCompany?: (id: string) => void;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onOpenHeuresSupp?: () => void;
  heuresSuppCount?: number;
  currentUser?: UserAccount;
  onOpenLoginModal?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  selectedDate,
  onSelectDate,
  onOpenHeuresSupp,
  heuresSuppCount = 0,
  currentUser,
  onOpenLoginModal,
}) => {
  const { isInstallable, install } = usePWAInstall();
  const isOnline = useOnlineStatus();
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Vérifier si la date sélectionnée est aujourd'hui
  const today = new Date().toISOString().split('T')[0];
  const isToday = selectedDate === today;

  return (
    <header className="sticky top-0 z-40 bg-emerald-800 text-white shadow-md">
      {/* Barre supérieure principale */}
      <div className="px-3 py-2.5 flex items-center justify-between gap-2">
        {/* Logo & Titre unique : Lahcen Pointeur */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center shrink-0 border border-white/20">
            <span className="text-xl">🌱</span>
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h1 className="text-lg font-black tracking-tight leading-none text-white truncate">
                Lahcen Pointeur
              </h1>
              {isOnline ? (
                <span className="inline-flex items-center gap-1 text-[9px] font-semibold bg-emerald-900/80 text-emerald-300 px-1.5 py-0.5 rounded-full border border-emerald-700/60 shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                  <span>En ligne</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[9px] font-black bg-amber-400 text-slate-950 px-1.5 py-0.5 rounded-full shrink-0 shadow-2xs">
                  <WifiOff className="w-2.5 h-2.5" />
                  <span>Hors connexion</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Boutons d'action à droite (PWA Install + Heures Sup) */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Bouton Installation PWA (si disponible) */}
          {isInstallable && (
            <button
              type="button"
              onClick={install}
              className="flex items-center gap-1 bg-amber-400 hover:bg-amber-300 text-slate-950 px-2 py-1 rounded-lg text-xs font-bold shadow-xs transition active:scale-95"
              title="Installer l'application sur le téléphone"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Installer</span>
            </button>
          )}

          {/* Bouton Heures supplémentaires (réservé admin ou si connecté) */}
          {onOpenHeuresSupp && currentUser?.role === 'admin' && (
            <button
              type="button"
              onClick={onOpenHeuresSupp}
              className="flex items-center gap-1 bg-amber-500 hover:bg-amber-400 text-slate-950 px-2.5 py-1.5 rounded-xl text-xs font-black shadow-xs transition active:scale-95 cursor-pointer"
              title="Pointage des heures supplémentaires"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Heures sup</span>
              {heuresSuppCount > 0 && (
                <span className="bg-slate-950 text-amber-300 text-[10px] px-1.5 py-0.2 rounded-full font-black">
                  {heuresSuppCount}
                </span>
              )}
            </button>
          )}

          {/* Bouton Compte / Connexion */}
          {onOpenLoginModal && (
            <button
              type="button"
              onClick={onOpenLoginModal}
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-xl text-xs font-black shadow-xs transition active:scale-95 border ${
                currentUser?.role === 'caporal'
                  ? 'bg-emerald-700/80 hover:bg-emerald-700 text-emerald-100 border-emerald-500'
                  : 'bg-white/10 hover:bg-white/20 text-white border-white/20'
              }`}
              title="Changer de compte ou se déconnecter"
            >
              <span>{currentUser?.role === 'admin' ? '👑' : '🌾'}</span>
              <span className="max-w-[70px] truncate text-[11px]">
                {currentUser ? currentUser.nom.split(' ')[0] : 'Compte'}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Bandeau de la date (modifiable pour consulter les jours précédents) */}
      <div className="bg-emerald-900/90 px-3 py-1.5 flex items-center justify-between text-xs border-t border-emerald-700/50">
        <div className="flex items-center gap-1.5">
          <Calendar className="w-3.5 h-3.5 text-emerald-300" />
          <span className="text-emerald-200 font-medium">Date du pointage :</span>
          <span className="font-bold text-white tracking-wide">
            {formatDateJJMM(selectedDate)}
          </span>
          {isToday ? (
            <span className="bg-emerald-700 text-emerald-100 text-[10px] font-semibold px-1.5 py-0.2 rounded-md">
              Aujourd'hui
            </span>
          ) : (
            <span className="bg-amber-600 text-white text-[10px] font-bold px-1.5 py-0.2 rounded-md animate-pulse">
              Historique
            </span>
          )}
        </div>

        {/* Bouton pour changer la date */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowDatePicker(!showDatePicker)}
            className="text-[11px] font-bold bg-emerald-700/80 hover:bg-emerald-700 text-white px-2 py-0.5 rounded-md border border-emerald-600 transition cursor-pointer"
          >
            Changer ▾
          </button>

          {showDatePicker && (
            <div className="absolute right-0 top-7 z-50 bg-white text-slate-800 p-3 rounded-xl shadow-xl border border-slate-200 flex flex-col gap-2 w-56">
              <label className="text-xs font-bold text-slate-600">
                Sélectionner un jour :
              </label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => {
                  if (e.target.value) {
                    onSelectDate(e.target.value);
                    setShowDatePicker(false);
                  }
                }}
                className="w-full border border-slate-300 rounded-lg p-2 text-sm font-semibold focus:ring-2 focus:ring-emerald-500 outline-none"
              />
              {!isToday && (
                <button
                  type="button"
                  onClick={() => {
                    onSelectDate(today);
                    setShowDatePicker(false);
                  }}
                  className="w-full text-center text-xs font-bold bg-emerald-100 text-emerald-800 py-1.5 rounded-lg hover:bg-emerald-200 transition cursor-pointer"
                >
                  Revenir à aujourd'hui
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
