/**
 * Utilitaires pour le formatage et l'affichage des tâches
 * Règle : Afficher le code avant le nom de la tâche partout : "CODE - NOM" (ex: "R01 - RECOLTE")
 * Si pas de code, afficher simplement le nom de la tâche.
 */

import { Tache } from '../types';

/**
 * Formate le libellé complet d'une tâche avec son code optionnel
 * Ex : "R01 - RECOLTE" ou "RECOLTE"
 */
export function formatTacheLabel(tache?: Partial<Tache> | null): string {
  if (!tache) return '';
  const code = tache.code?.trim().toUpperCase();
  const nom = tache.nom?.trim().toUpperCase() || '';
  if (code) {
    return `${code} - ${nom}`;
  }
  return nom;
}

/**
 * Formate un couple (code, nom) directement
 */
export function formatTacheCodeNom(code?: string | null, nom?: string | null): string {
  const codeClean = code?.trim().toUpperCase();
  const nomClean = nom?.trim().toUpperCase() || '';
  if (codeClean) {
    return `${codeClean} - ${nomClean}`;
  }
  return nomClean;
}
