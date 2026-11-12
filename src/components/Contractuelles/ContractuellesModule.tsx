/**
 * Module racine pour la Gestion des OUVRIERS CONTRACTUELS
 * - Indépendant des autres modules (Récolte, Stock Pro, Pointage Matin)
 * - Vue dédiée pour le Caporal Contractuelles
 * - Vue multi-onglets complète pour l'Administrateur
 */

import React, { useState } from 'react';
import {
  FileSpreadsheet,
  Users,
  CheckCircle2,
  TrendingUp,
  ShieldCheck,
  Calendar,
} from 'lucide-react';
import { Domaine, Serre, Tache, UserAccount } from '../../types';
import { ContractuelCaporalView } from './ContractuelCaporalView';
import { ContractuelAdminDashboard } from './ContractuelAdminDashboard';
import { ContractuelOuvrierManagement } from './ContractuelOuvrierManagement';
import { ContractuelCaporalManagement } from './ContractuelCaporalManagement';
import { ContractuelContratManagement } from './ContractuelContratManagement';

interface ContractuellesModuleProps {
  selectedDate: string;
  onSelectDate: (date: string) => void;
  domaines: Domaine[];
  serres: Serre[];
  taches: Tache[];
  currentUser: UserAccount;
}

export const ContractuellesModule: React.FC<ContractuellesModuleProps> = ({
  selectedDate,
  onSelectDate,
  domaines,
  serres,
  taches,
  currentUser,
}) => {
  const isCaporalContractuel =
    currentUser.role === 'caporal_contractuelles' ||
    currentUser.module_attribue === 'contractuelles';

  // Sous-onglets pour l'administrateur
  const [adminTab, setAdminTab] = useState<
    'pointage' | 'contrats' | 'dashboard' | 'ouvriers' | 'caporal'
  >('pointage');

  // Si l'utilisateur est un Caporal dédié aux Contractuelles, affichage direct de son écran de saisie
  if (isCaporalContractuel) {
    return (
      <div className="space-y-3">
        {/* Titre épuré pour le Caporal */}
        <div className="bg-emerald-800 text-white p-3 rounded-2xl shadow-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">📋</span>
            <div>
              <h2 className="text-sm font-black tracking-tight leading-tight">
                Pointage Ouvriers Contractuels
              </h2>
              <p className="text-[10px] text-emerald-200">
                {currentUser.nom} (Caporal)
              </p>
            </div>
          </div>
        </div>

        <ContractuelCaporalView
          selectedDate={selectedDate}
          onSelectDate={onSelectDate}
          domaines={domaines}
          serres={serres}
          taches={taches}
          currentUser={currentUser}
          isAdmin={false}
        />
      </div>
    );
  }

  // Si Administrateur : Vue complète avec onglets de gestion
  return (
    <div className="space-y-4">
      {/* 1. BANNIÈRE MODULE ADMIN */}
      <div className="bg-white rounded-2xl p-3.5 border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-emerald-600 text-white flex items-center justify-center font-black shadow-xs">
            <FileSpreadsheet className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-black text-slate-900 tracking-tight">
              Gestion des Ouvriers Contractuels
            </h2>
            <p className="text-[11px] text-slate-500">
              Pointage journalier, rémunérations à la tâche/jour, suivi par serre & export Excel
            </p>
          </div>
        </div>
      </div>

      {/* 2. ONGLETS DE NAVIGATION ADMIN */}
      <div className="flex items-center gap-1 bg-white p-1 rounded-2xl border border-slate-200 shadow-2xs overflow-x-auto no-scrollbar">
        <button
          type="button"
          onClick={() => setAdminTab('pointage')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition shrink-0 cursor-pointer ${
            adminTab === 'pointage'
              ? 'bg-emerald-800 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>Pointage Journalier</span>
        </button>

        <button
          type="button"
          onClick={() => setAdminTab('ouvriers')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition shrink-0 cursor-pointer ${
            adminTab === 'ouvriers'
              ? 'bg-emerald-800 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Travailleurs & Import Excel</span>
        </button>

        <button
          type="button"
          onClick={() => setAdminTab('caporal')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition shrink-0 cursor-pointer ${
            adminTab === 'caporal'
              ? 'bg-emerald-800 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Comptes Caporal</span>
        </button>

        <button
          type="button"
          onClick={() => setAdminTab('dashboard')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition shrink-0 cursor-pointer ${
            adminTab === 'dashboard'
              ? 'bg-emerald-800 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <TrendingUp className="w-3.5 h-3.5" />
          <span>Historique & Tableau de Bord</span>
        </button>

        <button
          type="button"
          onClick={() => setAdminTab('contrats')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition shrink-0 cursor-pointer ${
            adminTab === 'contrats'
              ? 'bg-emerald-800 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <FileSpreadsheet className="w-3.5 h-3.5" />
          <span>Catalogue des Contrats</span>
        </button>
      </div>

      {/* 3. VUE DE L'ONGLET ACTIF */}
      {adminTab === 'pointage' && (
        <ContractuelCaporalView
          selectedDate={selectedDate}
          onSelectDate={onSelectDate}
          domaines={domaines}
          serres={serres}
          taches={taches}
          currentUser={currentUser}
          isAdmin={true}
        />
      )}

      {adminTab === 'contrats' && (
        <ContractuelContratManagement
          domaines={domaines}
          currentUser={currentUser}
        />
      )}

      {adminTab === 'dashboard' && (
        <ContractuelAdminDashboard
          domaines={domaines}
          serres={serres}
          currentUser={currentUser}
        />
      )}

      {adminTab === 'ouvriers' && (
        <ContractuelOuvrierManagement
          domaines={domaines}
          serres={serres}
          currentUser={currentUser}
        />
      )}

      {adminTab === 'caporal' && (
        <ContractuelCaporalManagement
          domaines={domaines}
          serres={serres}
          currentUser={currentUser}
        />
      )}
    </div>
  );
};
