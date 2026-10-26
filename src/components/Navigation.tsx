/**
 * Barre de navigation inférieure fixe
 * Conçue pour une manipulation fluide à une seule main avec le pouce sur mobile
 * Gère les restrictions de rôle (Caporal voit UNIQUEMENT Récolte et Compte)
 */

import React from 'react';
import {
  CheckCircle2,
  Tag,
  UserX,
  Fuel,
  MessageSquare,
  Settings,
  Grape,
  User,
  LogOut,
} from 'lucide-react';
import { UserRole } from '../types';

export type ActiveScreen = 'pointage' | 'taches' | 'absences' | 'recolte' | 'gazoil' | 'recap' | 'gestion';

interface NavigationProps {
  activeScreen: ActiveScreen;
  onSelectScreen: (screen: ActiveScreen) => void;
  absentsCount: number;
  gazoilAlert?: boolean;
  currentUserRole?: UserRole;
  onOpenAccountModal?: () => void;
}

export const Navigation: React.FC<NavigationProps> = ({
  activeScreen,
  onSelectScreen,
  absentsCount,
  gazoilAlert = false,
  currentUserRole = 'admin',
  onOpenAccountModal,
}) => {
  // Navigation restreinte pour le rôle Caporal : UNIQUEMENT Récolte et Mon Compte
  if (currentUserRole === 'caporal') {
    return (
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-slate-200 shadow-xl px-3 py-2 pb-safe">
        <div className="max-w-md mx-auto grid grid-cols-2 gap-2">
          {/* Module unique Récolte */}
          <button
            type="button"
            onClick={() => onSelectScreen('recolte')}
            className={`flex items-center justify-center gap-2 py-3 px-3 rounded-2xl transition active:scale-95 ${
              activeScreen === 'recolte'
                ? 'text-emerald-950 bg-emerald-100 font-black shadow-xs border border-emerald-300'
                : 'text-slate-600 bg-slate-50 font-bold'
            }`}
          >
            <Grape className="w-5 h-5 text-emerald-700" />
            <span className="text-xs">Module Récolte</span>
          </button>

          {/* Déconnexion / Mon Compte */}
          <button
            type="button"
            onClick={onOpenAccountModal}
            className="flex items-center justify-center gap-2 py-3 px-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold transition active:scale-95"
          >
            <User className="w-4 h-4 text-slate-600" />
            <span className="text-xs">Mon Compte</span>
          </button>
        </div>
      </nav>
    );
  }

  // Navigation complète pour l'Administrateur
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-slate-200 shadow-lg px-1 py-1.5 pb-safe">
      <div className="max-w-md mx-auto grid grid-cols-7 gap-0.5">
        {/* ÉCRAN 1 : POINTAGE */}
        <button
          type="button"
          onClick={() => onSelectScreen('pointage')}
          className={`flex flex-col items-center justify-center py-1 px-0.5 rounded-xl transition active:scale-95 ${
            activeScreen === 'pointage'
              ? 'text-emerald-700 bg-emerald-50 font-black'
              : 'text-slate-500 hover:text-slate-800 font-semibold'
          }`}
        >
          <CheckCircle2
            className={`w-4 h-4 ${
              activeScreen === 'pointage' ? 'text-emerald-600 stroke-[2.5]' : 'text-slate-500'
            }`}
          />
          <span className="text-[8px] mt-0.5 tracking-tight truncate">Pointage</span>
        </button>

        {/* ÉCRAN 2 : TÂCHES */}
        <button
          type="button"
          onClick={() => onSelectScreen('taches')}
          className={`flex flex-col items-center justify-center py-1 px-0.5 rounded-xl transition active:scale-95 ${
            activeScreen === 'taches'
              ? 'text-purple-700 bg-purple-50 font-black'
              : 'text-slate-500 hover:text-slate-800 font-semibold'
          }`}
        >
          <Tag
            className={`w-4 h-4 ${
              activeScreen === 'taches' ? 'text-purple-600 stroke-[2.5]' : 'text-slate-500'
            }`}
          />
          <span className="text-[8px] mt-0.5 tracking-tight truncate">Tâches</span>
        </button>

        {/* ÉCRAN 3 : ABSENCES */}
        <button
          type="button"
          onClick={() => onSelectScreen('absences')}
          className={`flex flex-col items-center justify-center py-1 px-0.5 rounded-xl transition active:scale-95 ${
            activeScreen === 'absences'
              ? 'text-amber-800 bg-amber-50 font-black'
              : 'text-slate-500 hover:text-slate-800 font-semibold'
          }`}
        >
          <div className="relative">
            <UserX
              className={`w-4 h-4 ${
                activeScreen === 'absences' ? 'text-amber-600 stroke-[2.5]' : 'text-slate-500'
              }`}
            />
            {absentsCount > 0 && (
              <span className="absolute -top-1.5 -right-2 min-w-[13px] h-3 bg-amber-500 text-white font-black text-[8px] rounded-full flex items-center justify-center px-0.5">
                {absentsCount}
              </span>
            )}
          </div>
          <span className="text-[8px] mt-0.5 tracking-tight truncate">Absents</span>
        </button>

        {/* ÉCRAN 4 : RÉCOLTE (NOUVEAU) */}
        <button
          type="button"
          onClick={() => onSelectScreen('recolte')}
          className={`flex flex-col items-center justify-center py-1 px-0.5 rounded-xl transition active:scale-95 ${
            activeScreen === 'recolte'
              ? 'text-purple-800 bg-purple-100/70 font-black'
              : 'text-slate-500 hover:text-slate-800 font-semibold'
          }`}
        >
          <Grape
            className={`w-4 h-4 ${
              activeScreen === 'recolte' ? 'text-purple-700 stroke-[2.5]' : 'text-slate-500'
            }`}
          />
          <span className="text-[8px] mt-0.5 tracking-tight truncate">Récolte</span>
        </button>

        {/* ÉCRAN 5 : GAZOIL */}
        <button
          type="button"
          onClick={() => onSelectScreen('gazoil')}
          className={`flex flex-col items-center justify-center py-1 px-0.5 rounded-xl transition active:scale-95 ${
            activeScreen === 'gazoil'
              ? 'text-slate-900 bg-slate-100 font-black'
              : 'text-slate-500 hover:text-slate-800 font-semibold'
          }`}
        >
          <div className="relative">
            <Fuel
              className={`w-4 h-4 ${
                activeScreen === 'gazoil'
                  ? gazoilAlert
                    ? 'text-red-600 stroke-[2.5]'
                    : 'text-slate-900 stroke-[2.5]'
                  : gazoilAlert
                  ? 'text-red-500'
                  : 'text-slate-500'
              }`}
            />
            {gazoilAlert && (
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-600 rounded-full animate-ping" />
            )}
          </div>
          <span className="text-[8px] mt-0.5 tracking-tight truncate">Gazoil</span>
        </button>

        {/* ÉCRAN 6 : WHATSAPP */}
        <button
          type="button"
          onClick={() => onSelectScreen('recap')}
          className={`flex flex-col items-center justify-center py-1 px-0.5 rounded-xl transition active:scale-95 ${
            activeScreen === 'recap'
              ? 'text-[#075E54] bg-emerald-50 font-black'
              : 'text-slate-500 hover:text-slate-800 font-semibold'
          }`}
        >
          <MessageSquare
            className={`w-4 h-4 ${
              activeScreen === 'recap' ? 'text-[#25D366] stroke-[2.5]' : 'text-slate-500'
            }`}
          />
          <span className="text-[8px] mt-0.5 tracking-tight truncate">WhatsApp</span>
        </button>

        {/* ÉCRAN 7 : GESTION */}
        <button
          type="button"
          onClick={() => onSelectScreen('gestion')}
          className={`flex flex-col items-center justify-center py-1 px-0.5 rounded-xl transition active:scale-95 ${
            activeScreen === 'gestion'
              ? 'text-slate-900 bg-slate-100 font-black'
              : 'text-slate-500 hover:text-slate-800 font-semibold'
          }`}
        >
          <Settings
            className={`w-4 h-4 ${
              activeScreen === 'gestion' ? 'text-slate-800 stroke-[2.5]' : 'text-slate-500'
            }`}
          />
          <span className="text-[8px] mt-0.5 tracking-tight truncate">Gestion</span>
        </button>
      </div>
    </nav>
  );
};
