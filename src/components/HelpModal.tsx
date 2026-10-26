/**
 * Modale d'aide et guide de test "Comment tester"
 */

import React from 'react';
import { X, CheckCircle2, ShieldCheck, Smartphone, Info } from 'lucide-react';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white rounded-3xl max-w-md w-full max-h-[85vh] overflow-y-auto shadow-2xl border border-slate-200">
        <div className="bg-emerald-800 text-white p-4 flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-2">
            <Info className="w-5 h-5 text-emerald-300" />
            <h3 className="font-black text-base">Guide & Comment tester</h3>
          </div>
          <button
            onClick={onClose}
            className="text-emerald-200 hover:text-white p-1 rounded-full"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-4 space-y-4 text-xs text-slate-700 leading-relaxed">
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3">
            <span className="font-black text-emerald-900 block mb-1">
              🌱 Bienvenue sur Lahcen Pointeur
            </span>
            Application de pointage agricole multi-tenant hors-ligne, conçue pour être manipulée sur le terrain d'une seule main.
          </div>

          <div>
            <h4 className="font-black text-slate-900 text-sm flex items-center gap-1.5 mb-2">
              <Smartphone className="w-4 h-4 text-emerald-600" />
              <span>Comment tester (scénario complet) :</span>
            </h4>
            <ol className="space-y-2.5 list-decimal list-inside pl-1 text-slate-600">
              <li>
                <strong className="text-slate-900">1. Pointer 3 ouvriers sans tâche :</strong> Dans l'onglet <em>Pointage</em>, tapez successivement les numéros <code className="bg-slate-100 px-1 rounded font-black text-emerald-800">1</code>, <code className="bg-slate-100 px-1 rounded font-black text-emerald-800">2</code>, et <code className="bg-slate-100 px-1 rounded font-black text-emerald-800">3</code> avec <strong>VALIDER LE POINTAGE</strong>. Les présences sont enregistrées immédiatement sans demander de tâche !
              </li>
              <li>
                <strong className="text-slate-900">2. Affecter une tâche depuis l'écran Tâches :</strong> Ouvrez l'onglet <em>Tâches</em>. Recherchez par code ou nom (ex: <code className="bg-purple-100 text-purple-900 px-1 rounded font-bold">R01</code> ou <code className="bg-purple-100 text-purple-900 px-1 rounded font-bold">RECOLTE</code>). Cochez les ouvriers disponibles puis cliquez sur <strong>Enregistrer l'affectation</strong>. Règle stricte : <strong>un ouvrier = une seule tâche par jour</strong>. S'il a déjà une tâche, sa case est désactivée avec la mention <em>« déjà : [CODE - NOM] »</em> et un clic affiche le message de blocage.
              </li>
              <li>
                <strong className="text-slate-900">3. Vérifier le récapitulatif WhatsApp :</strong> Ouvrez l'onglet <em>WhatsApp</em>. Observez la date, la ligne vide, le bloc <code className="bg-slate-100 px-1 font-mono text-slate-800">POINTAGE MATIN (3) : 1 - 2 - 3</code>, une ligne vide, puis la tâche avec séparateur point <code className="bg-slate-100 px-1 font-mono text-slate-800">R01 - RECOLTE (2) : 1.2</code>, les lignes vides entre les tâches, et <code className="bg-slate-100 px-1 font-mono text-slate-800">SANS TÂCHE (1) : 3</code>.
              </li>
              <li>
                <strong className="text-slate-900">4. Exporter le fichier Excel :</strong> Dans <em>Gestion</em>, cliquez sur le bouton <strong>« Exporter en Excel »</strong>. Choisissez une date (défaut aujourd'hui) ou une période et cliquez sur <strong>Générer et télécharger</strong>. Le fichier Excel (.xlsx) généré contient une feuille unique <em>Pointage</em> avec les 8 colonnes exactes : <code className="bg-slate-100 px-1 font-mono text-[10px]">Date | Domaine | N° ouvrier | Nom et prénom | Présence | Code tâche | Tâche | Heures supplémentaires</code>, incluant les absents, les en-têtes en gras, l'autofiltre, les volets figés et la confirmation <em>« Export terminé : X lignes »</em>.
              </li>
              <li>
                <strong className="text-slate-900">5. Sauvegarde puis restauration sécurisée :</strong> Dans <em>Gestion ➔ Données</em>, cliquez sur <strong>« Exporter sauvegarde (JSON) »</strong>. Le fichier <code className="bg-slate-100 px-1 font-mono text-[10px]">pointage-backup-JJ-MM-AAAA.json</code> est téléchargé. Testez ensuite <strong>« Restaurer sauvegarde »</strong> : visualisez l'aperçu détaillé (validation stricte du schéma, rollback automatique garanti en cas d'erreur) avant de confirmer.
              </li>
              <li>
                <strong className="text-slate-900">6. Heures supplémentaires (par heures ou par tâche) :</strong> Cliquez sur le bouton ambre <strong>« Heures sup »</strong>. Saisissez le numéro <code className="bg-slate-100 px-1 font-black text-amber-800">3</code>. Choisissez <em>« Par tâche »</em>, sélectionnez <code className="bg-purple-100 text-purple-900 px-1 font-bold">R01 - RECOLTE</code>, entrez <code className="bg-slate-100 px-1 font-bold">2</code> avec l'unité <code className="bg-slate-100 px-1 font-bold">ruban</code>. Ajoutez ensuite pour le même ouvrier #3 une entrée <em>« Par heures »</em> (1 heure). Vérifiez la ligne WhatsApp <code className="bg-slate-100 px-1 font-mono text-[10px]">SUPPLEMENTAIRE (1) : 3 (2 ruban, 1 heure)</code> et les colonnes dédiées dans l'export Excel !
              </li>
              <li>
                <strong className="text-slate-900">7. Mode hors-connexion (avion) :</strong> Passez en mode avion ou coupez la connexion. Observez l'indicateur discret <em>Hors connexion</em>. Rechargez la page : l'application démarre et fonctionne instantanément sans réseau grâce au Service Worker !
              </li>
            </ol>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 space-y-1">
            <div className="font-bold text-slate-800 flex items-center gap-1">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Persistance et Limites de Stockage :</span>
            </div>
            <p className="text-slate-500 text-[11px]">
              Toutes les données sont conservées dans la mémoire locale de ce navigateur (localStorage). Pour prévenir toute saturation ou perte en cas de changement de smartphone, exportez régulièrement une sauvegarde JSON.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm py-3 rounded-2xl shadow-md transition"
          >
            Fermer le guide
          </button>
        </div>
      </div>
    </div>
  );
};
