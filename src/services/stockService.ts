/**
 * Service client pour le module STOCK PRO (Lahcen Pointeur)
 * - Gestion des appels API sécurisés avec Bearer Token
 * - Génération de clés d'idempotence pour prévenir les doubles enregistrements
 * - Analyse et validation du fichier Excel à 3 colonnes (NOM PRODUIT | UNITE | QTE)
 * - Exports Excel professionnels multi-formats avec SheetJS
 */

import * as XLSX from 'xlsx';
import { supabase } from './supabaseClient';
import {
  StockProduitSynthese,
  StockKPIs,
  StockMouvement,
  StockFilter,
  StockProduit,
} from '../types';

// Génération d'une clé d'idempotence unique avant envoi de la requête
export function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `idem_${crypto.randomUUID()}`;
  }
  return `idem_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// Récupération de l'en-tête d'autorisation
async function getAuthHeaders(): Promise<HeadersInit> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
      return headers;
    }
  } catch {
    // ignore
  }

  // Fallback dev local
  headers['Authorization'] = 'Bearer dev_admin_token';
  return headers;
}

// 1. Récupération du stock consolidé et des KPIs
export async function getStockSynthese(): Promise<{
  success: boolean;
  produits: StockProduitSynthese[];
  kpis: StockKPIs;
  error?: string;
}> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/stock', { headers });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return {
        success: false,
        produits: [],
        kpis: { totalProduits: 0, totalEntrees: 0, totalSorties: 0, produitsStockFaible: 0, produitsRupture: 0 },
        error: data.error || 'Erreur lors de la récupération du stock.',
      };
    }
    return data;
  } catch (err: any) {
    return {
      success: false,
      produits: [],
      kpis: { totalProduits: 0, totalEntrees: 0, totalSorties: 0, produitsStockFaible: 0, produitsRupture: 0 },
      error: err.message || 'Erreur réseau.',
    };
  }
}

// 2. Importation du stock initial (3 colonnes) avec clé d'idempotence
export async function importInitialStock(
  items: Array<{ nom: string; unite: string; qte: number }>,
  idempotencyKey: string = generateIdempotencyKey()
): Promise<{
  success: boolean;
  importedCount?: number;
  alreadyInitialized?: string[];
  message?: string;
  error?: string;
  is_duplicate_replay?: boolean;
}> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/stock/import-initial', {
      method: 'POST',
      headers,
      body: JSON.stringify({ idempotencyKey, items }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'Erreur lors de l\'import initial.' };
    }
    return data;
  } catch (err: any) {
    return { success: false, error: err.message || 'Erreur réseau.' };
  }
}

// 3. Création manuelle d'un produit
export async function createProduit(
  nom: string,
  unite: string,
  seuil_minimum: number = 5
): Promise<{ success: boolean; produit?: StockProduit; error?: string }> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/stock/produit', {
      method: 'POST',
      headers,
      body: JSON.stringify({ nom, unite, seuil_minimum }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'Erreur création produit.' };
    }
    return data;
  } catch (err: any) {
    return { success: false, error: err.message || 'Erreur réseau.' };
  }
}

// 4. Enregistrement d'une entrée de marchandise (idempotent)
export async function addEntree(params: {
  produit_id: string;
  quantite: number;
  date?: string;
  tiers?: string;
  reference_document?: string;
  motif?: string;
  observation?: string;
  idempotencyKey?: string;
}): Promise<{ success: boolean; mouvement?: StockMouvement; nouveau_stock?: number; error?: string }> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/stock/entree', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...params,
        idempotencyKey: params.idempotencyKey || generateIdempotencyKey(),
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'Erreur enregistrement entrée.' };
    }
    return data;
  } catch (err: any) {
    return { success: false, error: err.message || 'Erreur réseau.' };
  }
}

// 5. Enregistrement d'une sortie de marchandise (idempotent + contrôle strict)
export async function addSortie(params: {
  produit_id: string;
  quantite: number;
  date?: string;
  domaine_id?: string;
  serre_id?: string;
  tiers?: string;
  motif?: string;
  observation?: string;
  idempotencyKey?: string;
}): Promise<{ success: boolean; mouvement?: StockMouvement; nouveau_stock?: number; error?: string }> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/stock/sortie', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...params,
        idempotencyKey: params.idempotencyKey || generateIdempotencyKey(),
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'Erreur enregistrement sortie.' };
    }
    return data;
  } catch (err: any) {
    return { success: false, error: err.message || 'Erreur réseau.' };
  }
}

// 6. Enregistrement d'une correction / ajustement de stock (idempotent)
export async function addCorrection(params: {
  produit_id: string;
  quantite: number;
  date?: string;
  motif: string;
  observation?: string;
  idempotencyKey?: string;
}): Promise<{ success: boolean; mouvement?: StockMouvement; nouveau_stock?: number; error?: string }> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/stock/correction', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...params,
        idempotencyKey: params.idempotencyKey || generateIdempotencyKey(),
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'Erreur enregistrement correction.' };
    }
    return data;
  } catch (err: any) {
    return { success: false, error: err.message || 'Erreur réseau.' };
  }
}

// 7. Récupération de l'historique des mouvements
export async function getMouvements(filter?: StockFilter): Promise<{
  success: boolean;
  mouvements: StockMouvement[];
  error?: string;
}> {
  try {
    const headers = await getAuthHeaders();
    const params = new URLSearchParams();
    if (filter?.produit_id) params.set('produit_id', filter.produit_id);
    if (filter?.type && filter.type !== 'ALL') params.set('type', filter.type);
    if (filter?.domaine_id && filter.domaine_id !== 'ALL') params.set('domaine_id', filter.domaine_id);
    if (filter?.startDate) params.set('startDate', filter.startDate);
    if (filter?.endDate) params.set('endDate', filter.endDate);

    const url = `/api/stock/mouvements?${params.toString()}`;
    const res = await fetch(url, { headers });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, mouvements: [], error: data.error };
    }
    return data;
  } catch (err: any) {
    return { success: false, mouvements: [], error: err.message };
  }
}

// 8. Analyse du fichier Excel à 3 colonnes exactes (NOM PRODUIT | UNITE | QTE)
export async function parseStockInitialExcel(file: File): Promise<{
  validItems: Array<{ nom: string; unite: string; qte: number }>;
  errors: string[];
}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const buffer = e.target?.result;
        const workbook = XLSX.read(buffer, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
          return resolve({ validItems: [], errors: ['Le classeur Excel est vide.'] });
        }

        const worksheet = workbook.Sheets[sheetName];
        // Lecture sous forme de tableau de tableaux
        const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        if (rows.length < 2) {
          return resolve({
            validItems: [],
            errors: ['Le fichier ne contient aucune ligne de données exploitable.'],
          });
        }

        // Détection des en-têtes dans la première ligne
        const headerRow = rows[0].map((c) => String(c || '').trim().toUpperCase());
        let nomIdx = -1;
        let uniteIdx = -1;
        let qteIdx = -1;

        headerRow.forEach((col, idx) => {
          if (col.includes('PRODUIT') || col.includes('NOM') || col === 'ARTICLE') nomIdx = idx;
          else if (col.includes('UNITE') || col === 'UNIT' || col === 'U') uniteIdx = idx;
          else if (col.includes('QTE') || col.includes('QUANT') || col === 'STOCK') qteIdx = idx;
        });

        // Si non trouvé par nom, considérer l'ordre strict des 3 colonnes : Col 0 = Nom, Col 1 = Unité, Col 2 = Quantité
        if (nomIdx === -1) nomIdx = 0;
        if (uniteIdx === -1) uniteIdx = 1;
        if (qteIdx === -1) qteIdx = 2;

        const validItems: Array<{ nom: string; unite: string; qte: number }> = [];
        const errors: string[] = [];
        const seenNames = new Set<string>();

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length === 0) continue;

          const rawNom = row[nomIdx];
          const rawUnite = row[uniteIdx];
          const rawQte = row[qteIdx];

          if (!rawNom && !rawUnite && (rawQte === undefined || rawQte === null || String(rawQte).trim() === '')) continue;

          const nom = String(rawNom || '').trim().toUpperCase();
          const unite = String(rawUnite || '').trim().toUpperCase();

          if (!nom) {
            errors.push(`Ligne ${i + 1} : Le nom du produit est manquant.`);
            continue;
          }
          if (!unite) {
            errors.push(`Ligne ${i + 1} ("${nom}") : L'unité de mesure est manquante.`);
            continue;
          }

          if (rawQte === undefined || rawQte === null || String(rawQte).trim() === '') {
            errors.push(`Ligne ${i + 1} ("${nom}") : La quantité est manquante.`);
            continue;
          }

          const parsedQteStr = String(rawQte).trim().replace(',', '.');
          const qte = Number(parsedQteStr);

          if (isNaN(qte) || qte < 0) {
            errors.push(`Ligne ${i + 1} ("${nom}") : La quantité doit être un nombre positif ou nul (valeur trouvée: "${rawQte}").`);
            continue;
          }

          const uniqueKey = `${nom}_${unite}`;
          if (seenNames.has(uniqueKey)) {
            errors.push(`Ligne ${i + 1} ("${nom} - ${unite}") : Doublon détecté dans le même fichier Excel.`);
            continue;
          }

          seenNames.add(uniqueKey);
          validItems.push({ nom, unite, qte: Math.round(qte * 100) / 100 });
        }

        resolve({ validItems, errors });
      } catch (err: any) {
        reject(new Error('Erreur de lecture du fichier Excel: ' + err.message));
      }
    };

    reader.onerror = () => reject(new Error('Échec de la lecture du fichier.'));
    reader.readAsBinaryString(file);
  });
}

// ------------------------- EXPORTS EXCEL SHEETJS -------------------------

// Export 1 : État actuel du stock
export function exportEtatStockExcel(produits: StockProduitSynthese[]) {
  const rows = produits.map((p) => ({
    'Nom Produit': p.produit.nom,
    'Unité': p.produit.unite,
    'Stock Initial': p.stock_initial,
    'Total Entrées': p.total_entrees,
    'Total Sorties': p.total_sorties,
    'Stock Actuel': p.stock_actuel,
    'Seuil Minimum': p.produit.seuil_minimum,
    'État du Stock': p.etat === 'DISPONIBLE' ? 'Disponible' : p.etat === 'STOCK_FAIBLE' ? 'Stock Faible' : 'Rupture',
    'Dernière Activité': p.derniere_activite ? new Date(p.derniere_activite).toLocaleDateString('fr-FR') : '—',
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Stock Actuel');
  XLSX.writeFile(wb, `etat-stock-lahcen-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// Export 2 : Historique des entrées et sorties
export function exportHistoriqueExcel(mouvements: StockMouvement[]) {
  const rows = mouvements.map((m) => ({
    'Date': m.date,
    'Heure': new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
    'Produit': m.produit_nom,
    'Unité': m.unite,
    'Type': m.type,
    'Quantité': m.quantite,
    'Domaine': m.domaine_id ? m.domaine_id.replace('dom_', '').toUpperCase() : '—',
    'Serre': m.serre_id || '—',
    'Fournisseur / Bénéficiaire': m.tiers || '—',
    'Document / BL': m.reference_document || '—',
    'Motif': m.motif || '—',
    'Admin Responsable': m.created_by_nom,
    'Remarque': m.observation || '',
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Historique Mouvements');
  XLSX.writeFile(wb, `historique-stock-lahcen-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// Export 3 : Récapitulatif des sorties par domaine (D2 / D3 / D5 / ...)
export function exportSortiesParDomaineExcel(mouvements: StockMouvement[]) {
  const sorties = mouvements.filter((m) => m.type === 'SORTIE');
  const domaineMap = new Map<string, Map<string, { unite: string; quantite: number }>>();

  for (const s of sorties) {
    const dom = s.domaine_id ? s.domaine_id.replace('dom_', '').toUpperCase() : 'NON DÉFINI';
    if (!domaineMap.has(dom)) {
      domaineMap.set(dom, new Map());
    }
    const prodMap = domaineMap.get(dom)!;
    const current = prodMap.get(s.produit_nom) || { unite: s.unite, quantite: 0 };
    current.quantite = Math.round((current.quantite + s.quantite) * 100) / 100;
    prodMap.set(s.produit_nom, current);
  }

  const rows: any[] = [];
  for (const [domaine, prodMap] of domaineMap.entries()) {
    for (const [produit, data] of prodMap.entries()) {
      rows.push({
        'Domaine': domaine,
        'Produit': produit,
        'Unité': data.unite,
        'Quantité Totale Sortie': data.quantite,
      });
    }
  }

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sorties par Domaine');
  XLSX.writeFile(wb, `sorties-domaines-lahcen-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// Export 4 : Récapitulatif des quantités par produit
export function exportSyntheseQuantitesExcel(produits: StockProduitSynthese[]) {
  const rows = produits.map((p) => ({
    'Produit': p.produit.nom,
    'Unité': p.produit.unite,
    'Initial': p.stock_initial,
    'Entrées Cumulées': p.total_entrees,
    'Sorties Cumulées': p.total_sorties,
    'Disponible Actuel': p.stock_actuel,
    'Alerte Seuil': p.produit.seuil_minimum,
    'Statut': p.etat,
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Synthèse Produits');
  XLSX.writeFile(wb, `synthese-produits-lahcen-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
