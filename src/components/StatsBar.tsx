/**
 * Barre de statistiques permanente : Total, Pointés, Restants
 * Conçue pour une lisibilité maximale en plein soleil dans les champs
 */

import React from 'react';
import { Users, UserCheck, UserX } from 'lucide-react';
import { PointageStats } from '../types';

interface StatsBarProps {
  stats: PointageStats;
}

export const StatsBar: React.FC<StatsBarProps> = ({ stats }) => {
  return (
    <div className="bg-white border-b border-slate-200 shadow-xs px-3 py-2.5">
      <div className="grid grid-cols-3 gap-2 text-center">
        {/* Total Ouvriers */}
        <div className="flex flex-col items-center justify-center bg-slate-50 border border-slate-200 rounded-xl py-1.5 px-1">
          <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
            <Users className="w-3.5 h-3.5 text-slate-500" />
            <span>Total</span>
          </div>
          <span className="text-xl font-black text-slate-800 tracking-tight">
            {stats.totalActifs}
          </span>
          <span className="text-[10px] text-slate-500 font-medium">actifs</span>
        </div>

        {/* Pointés (Présents) */}
        <div className="flex flex-col items-center justify-center bg-emerald-50 border border-emerald-200 rounded-xl py-1.5 px-1">
          <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700 uppercase tracking-wider">
            <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>Pointés</span>
          </div>
          <span className="text-xl font-black text-emerald-700 tracking-tight">
            {stats.pointes}
          </span>
          <span className="text-[10px] text-emerald-600 font-medium font-mono">
            {stats.tauxPresence}%
          </span>
        </div>

        {/* Restants (Absents à cette heure) */}
        <div className="flex flex-col items-center justify-center bg-amber-50 border border-amber-200 rounded-xl py-1.5 px-1">
          <div className="flex items-center gap-1 text-[11px] font-semibold text-amber-800 uppercase tracking-wider">
            <UserX className="w-3.5 h-3.5 text-amber-700" />
            <span>Restants</span>
          </div>
          <span className="text-xl font-black text-amber-700 tracking-tight">
            {stats.restants}
          </span>
          <span className="text-[10px] text-amber-600 font-medium">à pointer</span>
        </div>
      </div>

      {/* Mini barre de progression de la journée */}
      <div className="w-full bg-slate-200 h-1.5 rounded-full mt-2 overflow-hidden">
        <div
          className="bg-emerald-600 h-full transition-all duration-300 ease-out"
          style={{ width: `${stats.tauxPresence}%` }}
        />
      </div>
    </div>
  );
};
