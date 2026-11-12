/**
 * MODULE HEURES SUPPLÉMENTAIRES (ADMIN ONLY) — RECONSTRUCTION
 * Routeur vers le module complet et unifié SupplementairesAdminModule
 * avec blocage strict d'accès pour le rôle Caporal.
 */

import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { Ouvrier, Domaine, Serre, UserAccount } from '../types';
import { SupplementairesAdminModule } from './Supplementaires/SupplementairesAdminModule';

interface HeuresSupplementairesViewProps {
  currentUser: UserAccount;
  allOuvriers: Ouvrier[];
  domaines: Domaine[];
  serres: Serre[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onClose?: () => void;
}

export const HeuresSupplementairesView: React.FC<HeuresSupplementairesViewProps> = ({
  currentUser,
  allOuvriers,
  domaines,
  serres,
  selectedDate,
  onSelectDate,
}) => {
  // Contrôle strict de rôle côté client (complémentaire au blocage HTTP 403 serveur)
  if (currentUser?.role === 'caporal' || currentUser?.role === 'caporal_contractuelles') {
    return (
      <div className="min-h-screen bg-slate-100 p-6 flex items-center justify-center">
        <div className="bg-white rounded-2xl border border-red-300 p-6 max-w-md w-full shadow-lg text-center">
          <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-3">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h2 className="text-base font-black text-slate-900 mb-1">Accès Strictement Interdit</h2>
          <p className="text-xs text-slate-600 leading-relaxed">
            Le module Heures Supplémentaires est réservé exclusivement à l'Administrateur. Le rôle
            Caporal n'a aucune autorisation d'accès à cette interface.
          </p>
        </div>
      </div>
    );
  }

  return (
    <SupplementairesAdminModule
      currentUser={currentUser}
      allOuvriers={allOuvriers}
      taches={[]}
      domaines={domaines}
      serres={serres}
      selectedDate={selectedDate}
      onSelectDate={onSelectDate}
      initialTab="heures"
    />
  );
};
