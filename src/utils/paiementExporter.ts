/**
 * Moteur indépendant : EXPORT PAIEMENT EXCEL (RÉSERVÉ ADMINISTRATEUR)
 * Application : LAHCEN POINTEUR / AGRIPOINTEUR
 * Source des données : POINTAGE MATIN (en lecture seule)
 *
 * Tarifs automatiques par défaut :
 * - Récolte Cerise   : 3,8 DH / caisse (coefficient 3,8)
 * - Récolte Ronde    : 1,1875 DH / caisse
 * - TTT D2           : 15 DH / heure
 * - TTT D3           : 16 DH / heure
 * - Travail normal   : 95 DH / jour (07:00-16:00, pause 1h = 8h ; prorata 95/8 = 11,875 DH/h)
 * - Stationnaire     : 100 DH / jour
 * - Gardien          : 100 DH / jour
 * - Ébourgeonnage D5 : 150 DH / jour
 *
 * Règles strictes :
 * - Conservation intégrale du modèle Excel original (.xlsx) à 21 colonnes exactes sur la feuille "Pointage".
 * - Aucun remplacement fabriqué si le fichier .xlsx original est absent : blocage explicite.
 * - Statut conservé exactement tel qu'il existe dans Pointage (BROUILLON reste BROUILLON, VALIDÉE reste VALIDÉE).
 * - Aucun cumul entre Travail normal (95 DH) et un tarif spécial.
 * - quantiteMetrique reste strictement vide pour tout travail payé au temps (heure/jour).
 * - Non-rétroactivité stricte : les snapshots exportés sont immuables et ré-exportables à l'identique.
 */

import ExcelJS from 'exceljs';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  AffectationTache,
  Domaine,
  Ouvrier,
  Pointage,
  RecolteEntry,
  Serre,
  Tache,
  TacheSerreConfig,
  UserAccount,
} from '../types';
import {
  ADMIN_EXPORT_EXCEL_COLUMNS,
  ADMIN_EXPORT_TEMPLATE_FILENAME,
  ADMIN_EXPORT_TEMPLATE_PUBLIC_URL,
  validateAdminExcelTemplate,
} from './adminExportRemuneration';
import {
  OUTBOX_KEYS,
  enqueueOutboxOp,
  getOutboxOps,
  dequeueOutboxOpsById,
  markOutboxOpsFailed,
  hasPendingOutboxEntity,
} from '../services/syncOutbox';

export const PAIEMENT_SHEET_POINTAGE = 'Pointage';
export const PAIEMENT_SHEET_TOTAUX = 'Totaux par Ouvrier';
export const PAIEMENT_RUBAN_LABEL = 'Tous les Rubans';
export const PAIEMENT_ALL_SERRES_LABEL = 'TOUTES LES SERRES';
const THRESHOLD_TARIFFS_RESERVED_KEY = '__threshold_tariffs';

export const PAIEMENT_TEMPLATE_FILENAME = ADMIN_EXPORT_TEMPLATE_FILENAME;
export const PAIEMENT_TEMPLATE_PUBLIC_URL = ADMIN_EXPORT_TEMPLATE_PUBLIC_URL;
export const PAIEMENT_TEMPLATE_STORAGE_KEY = 'agripointage_admin_export_template_b64_v1';

export const PAIEMENT_TARIFFS_STORAGE_PREFIX = 'agripointage_paiement_tariffs_v1';
export const PAIEMENT_EXPORTS_HISTORY_PREFIX = 'agripointage_paiement_exports_history_v1';
export const PAIEMENT_HOURS_OVERRIDES_PREFIX = 'agripointage_paiement_hours_overrides_v1';
export const PAIEMENT_VARIETY_OVERRIDES_PREFIX = 'agripointage_paiement_variety_overrides_v1';

export const PAIEMENT_POINTAGE_COLUMNS = ADMIN_EXPORT_EXCEL_COLUMNS;
export const validatePaiementExcelTemplate = validateAdminExcelTemplate;

export const DEFAULT_PAIEMENT_TARIFFS = {
  recolteCeriseCoeff: 3.8,
  recolteRondeTarif: 1.1875,
  tttD2Heure: 15,
  tttD3Heure: 16,
  travailNormalJour: 95,
  stationnaireJour: 100,
  gardienJour: 100,
  ebourgeonnageD5Jour: 150,
  chariotTarifRef: 95,
  chariotQuantiteRef: 400,
  transfertCaisseTarifRef: 95,
  transfertCaisseQuantiteRef: 400,
} as const;

export type PaiementTariffMode =
  | 'NORMAL_JOUR'
  | 'FORFAIT_JOUR'
  | 'HEURE'
  | 'RECOLTE_COEFF'
  | 'RECOLTE_UNITE'
  | 'CAISSE_SEUIL';

export type PaiementTaskCategory =
  | 'RECOLTE_CERISE'
  | 'RECOLTE_RONDE'
  | 'RECOLTE_AMBIGUE'
  | 'TTT_D2'
  | 'TTT_D3'
  | 'TRAVAIL_NORMAL'
  | 'STATIONNAIRE'
  | 'GARDIEN'
  | 'EBOURGEONNAGE_D5'
  | 'CHARIOT'
  | 'TRANSFERT_CAISSE'
  | 'CUSTOM';

export type RecolteVarietyChoice = 'CERISE' | 'RONDE';

export interface CustomTaskTariffRule {
  tacheKey: string;
  label: string;
  mode: PaiementTariffMode;
  value: number;
  unite?: string;
  quantiteRef?: number;
  coefficient?: number;
  actif?: boolean;
}

export interface PaiementTariffsConfig {
  recolteCeriseCoeff: number;
  recolteRondeTarif: number;
  tttD2Heure: number;
  tttD3Heure: number;
  travailNormalJour: number;
  stationnaireJour: number;
  gardienJour: number;
  ebourgeonnageD5Jour: number;
  chariotTarifRef: number;
  chariotQuantiteRef: number;
  transfertCaisseTarifRef: number;
  transfertCaisseQuantiteRef: number;
  customTaskTariffs: Record<string, CustomTaskTariffRule>;
  version: number;
  updatedAt: string;
  updatedBy?: string;
}

export interface PaiementHoursOverride {
  heureDeb?: string;
  heureFin?: string;
  dureeRep?: number;
  heures?: number;
  caisses?: number;
}

export interface PaiementExcelRow {
  rowKey: string;
  workerKey: string;
  docId: string;
  dateTrava: string;
  ouvrierId: string;
  numeroOuvrier: number;
  nomOuvrier: string;
  DT: string;
  domaineId: string;
  domaineShort: string;
  serreId: string;
  hasMissingSerre?: boolean;
  rubanId: string;
  cultureId: string;
  tacheTypeId: string;
  tacheId: string;
  tache: string;
  category: PaiementTaskCategory;
  mode: PaiementTariffMode;
  uniteMetrique: string;
  quantiteMetrique: number | '';
  quantite: ''; // Règle historique stricte : champ quantite toujours vide
  heureDeb: string;
  heureFin: string;
  dureeRep: number | '';
  dureeTravaillee: number;
  periodeJo: string;
  statut: string; // Statut conservé exactement tel qu'il existe dans Pointage (BROUILLON, VALIDÉE, etc.)
  equipeId: string;
  tarifExcep: number | '';
  tarifAppliqueLabel: string;
  coefficient: number | '';
  remuneration: number;
  needsVarietySelection?: boolean;
  varietyBlockedReason?: string;
  missingQuantityBlocked?: boolean;
  missingQuantityReason?: string;
  notes: string[];
}

export interface PaiementWorkerTotal {
  workerKey: string;
  ouvrierId: string;
  numeroOuvrier: number;
  nomOuvrier: string;
  domaineDT: string;
  taches: string[];
  tarifsAppliques: string[];
  coefficients: string[];
  totalHeures: number;
  totalRecolte: number;
  rowsCount: number;
  totalDH: number;
}

export interface PaiementDomaineTotal {
  DT: string;
  domaineShort: string;
  domaineId: string;
  ouvriersCount: number;
  rowsCount: number;
  totalDH: number;
}

export interface PaiementPreviewResult {
  dateIso: string;
  rows: PaiementExcelRow[];
  totalByWorker: PaiementWorkerTotal[];
  totalByDomaine: PaiementDomaineTotal[];
  grandTotalDH: number;
  totalOuvriersDistincts: number;
  tariffsApplied: PaiementTariffsConfig;
  isHistoricalFrozen: boolean;
  frozenSnapshot?: PaiementExportSnapshot | null;
  blockedVarietyRowsCount: number;
  blockedMissingQuantityRowsCount: number;
  blockedMissingQuantityWorkers: Array<{
    ouvrierId: string;
    nomOuvrier: string;
    tache: string;
    reason: string;
  }>;
  warnings: string[];
}

export interface PaiementExportSnapshot {
  id: string;
  companyId: string;
  dateIso: string;
  domaineFilter: string;
  exportedAt: string;
  exportedById: string;
  exportedByNom: string;
  filename: string;
  tariffsSnapshot: PaiementTariffsConfig;
  rows: PaiementExcelRow[];
  totalByWorker: PaiementWorkerTotal[];
  grandTotalDH: number;
  totalOuvriersDistincts: number;
}

export function createDefaultPaiementTariffs(): PaiementTariffsConfig {
  return {
    ...DEFAULT_PAIEMENT_TARIFFS,
    customTaskTariffs: {},
    version: 1,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Contrôle d'accès strict : uniquement Admin actif (Caporal, Caporal Contractuelles & Tariq bloqués).
 */
export function isAdminPaiementAuthorized(
  user?: Pick<UserAccount, 'role' | 'module_attribue' | 'username' | 'actif'> | null
): boolean {
  if (!user) return false;
  if (user.actif === false) return false;
  if (user.module_attribue === 'contractuelles') return false;
  if (String(user.username || '').trim().toLowerCase() === 'tariq') return false;
  return user.role === 'admin';
}

export function roundPaiementAmount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100000) / 100000;
}

export function formatDHDisplay(value: number): string {
  return roundPaiementAmount(value).toLocaleString('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

function normalizeText(str?: string | null): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function normalizePaiementDomaineShort(
  domaineNom?: string | null,
  domaineId?: string | null
): string {
  const raw = (domaineNom || '').trim().toUpperCase();
  if (raw) {
    const m = raw.match(/^(?:DOMAINE\s*|DT?\s*)0*(\d+)$/i);
    if (m) return `D${parseInt(m[1], 10)}`;
    if (/^D0*\d+$/.test(raw)) return `D${parseInt(raw.replace(/^D/, ''), 10)}`;
  }
  if (domaineId) {
    const cleanId = domaineId.trim().toLowerCase();
    const mId = cleanId.match(/^(?:dom_)?d0*(\d+)$/);
    if (mId) return `D${parseInt(mId[1], 10)}`;
  }
  return '';
}

export function formatPaiementDomaineDT(
  domaineNom?: string | null,
  domaineId?: string | null
): string {
  const shortCode = normalizePaiementDomaineShort(domaineNom, domaineId);
  if (!shortCode) return '';
  const m = shortCode.match(/^D(\d+)$/);
  if (m) return `D${String(parseInt(m[1], 10)).padStart(3, '0')}`;
  return shortCode;
}

function isUuidOrTechnicalId(val?: string | null): boolean {
  const s = String(val || '').trim();
  if (!s) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return true;
  if (/^(?:ouv|ptg|aff|usr|rec|dom|serre|tch|cie)_[a-z0-9_-]+$/i.test(s)) return true;
  return false;
}

function extractWorkerNum(raw?: unknown): number {
  if (typeof raw === 'number') {
    return Number.isInteger(raw) && raw > 0 ? raw : 0;
  }
  const s = String(raw ?? '').trim();
  if (!s || isUuidOrTechnicalId(s)) return 0;
  const direct = s.match(/^0*(\d+)$/);
  if (direct) {
    const n = parseInt(direct[1], 10);
    return n > 0 ? n : 0;
  }
  const codeMatch = s.match(/^0*(\d+)-D0*\d+$/i);
  if (codeMatch) {
    const n = parseInt(codeMatch[1], 10);
    return n > 0 ? n : 0;
  }
  return 0;
}

export function formatPaiementOuvrierId(
  numeroOuvrier: number | string,
  domaineShort: string
): string {
  const num = extractWorkerNum(numeroOuvrier);
  if (num <= 0) return '';
  const domClean = (domaineShort || '').trim().toUpperCase();
  return domClean ? `${num}-${domClean}` : String(num);
}

function parseSerreInfo(rawValue?: string | null): {
  embeddedDT: string | null;
  serreNum: number | null;
} {
  const clean = (rawValue || '').trim();
  if (!clean) return { embeddedDT: null, serreNum: null };

  const fullMatch = clean.match(/^DT?0*(\d+)\s*[-_\s]*S(?:ERRE)?\s*[-_\s]*0*(\d+)$/i);
  if (fullMatch) {
    return {
      embeddedDT: `D${String(parseInt(fullMatch[1], 10)).padStart(3, '0')}`,
      serreNum: parseInt(fullMatch[2], 10),
    };
  }

  const techDomMatch = clean.match(/^serre_d0*(\d+)_0*(\d+)$/i);
  if (techDomMatch) {
    return {
      embeddedDT: `D${String(parseInt(techDomMatch[1], 10)).padStart(3, '0')}`,
      serreNum: parseInt(techDomMatch[2], 10),
    };
  }

  const simpleMatch = clean.match(/^(?:SERRE[\s_-]*|S)0*(\d+)$/i);
  if (simpleMatch) {
    return {
      embeddedDT: null,
      serreNum: parseInt(simpleMatch[1], 10),
    };
  }

  if (/^\d+$/.test(clean)) {
    return { embeddedDT: null, serreNum: parseInt(clean, 10) };
  }

  return { embeddedDT: null, serreNum: null };
}

function getExpectedDTBySerreNum(serreNum: number): string | null {
  if (!Number.isFinite(serreNum) || serreNum <= 0) return null;
  if (serreNum >= 1 && serreNum <= 15) return 'D002';
  if (serreNum >= 16 && serreNum <= 22) return 'D003';
  if (serreNum >= 23 && serreNum <= 42) return 'D005';
  return null;
}

function getSerreDomainePrefix(dtCode: string): string {
  const upper = (dtCode || '').trim().toUpperCase();
  if (upper === 'D002' || upper === 'D2') return 'D002';
  const m = upper.match(/^D0*(\d+)$/);
  if (m) return `D${parseInt(m[1], 10)}`;
  return upper;
}

function isPlaceholderSerre(val?: string | null): boolean {
  const n = normalizeText(val);
  return (
    !n ||
    n === 'non affectee' ||
    n === 'aucune' ||
    n === 'aucune serre' ||
    n === 'toutes les serres' ||
    n === '-' ||
    n === '—'
  );
}

interface ResolvedSerreToken {
  raw: string;
  serreObj?: Serre | null;
}

function resolveSerreTokens(
  serreIdRaw: string | null | undefined,
  serreNomRaw: string | null | undefined,
  serresIdsArr: string[] | undefined,
  serresNomsArr: string[] | undefined,
  serreById: Map<string, Serre>,
  serreByCodeOrName: Map<string, Serre>
): ResolvedSerreToken[] {
  const tokens: ResolvedSerreToken[] = [];
  const seen = new Set<string>();

  const pushToken = (rawVal?: string | null, explicitObj?: Serre) => {
    if (!explicitObj && isPlaceholderSerre(rawVal)) return;
    const clean = (rawVal || '').trim();
    const matchedObj =
      explicitObj || serreById.get(clean) || serreByCodeOrName.get(clean.toUpperCase());
    const key = matchedObj?.id || clean.toUpperCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    tokens.push({ raw: clean || matchedObj?.code || matchedObj?.nom || '', serreObj: matchedObj });
  };

  if (Array.isArray(serresIdsArr) && serresIdsArr.length > 0) {
    serresIdsArr.forEach((id, idx) => {
      const sObj = serreById.get(id);
      const nomFallback = Array.isArray(serresNomsArr) ? serresNomsArr[idx] : undefined;
      pushToken(sObj ? sObj.code || sObj.nom : nomFallback || id, sObj);
    });
  } else if (Array.isArray(serresNomsArr) && serresNomsArr.length > 0) {
    serresNomsArr.forEach((nom) => pushToken(nom));
  }

  if (tokens.length === 0) {
    const idParts = (serreIdRaw || '')
      .split(/[,+]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const nomParts = (serreNomRaw || '')
      .split(/[,+]/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (idParts.length > 0) {
      idParts.forEach((idPart, idx) => {
        const sObj = serreById.get(idPart) || serreByCodeOrName.get(idPart.toUpperCase());
        pushToken(nomParts[idx] || idPart, sObj);
      });
    } else if (nomParts.length > 0) {
      nomParts.forEach((nPart) => pushToken(nPart));
    }
  }

  return tokens;
}

function formatSingleSerreCode(
  tok: ResolvedSerreToken,
  rowDT: string
): string {
  if (!tok.serreObj && isPlaceholderSerre(tok.raw)) return '';
  const fromRaw = parseSerreInfo(tok.raw);
  const fromCode = parseSerreInfo(tok.serreObj?.code);
  const fromNom = parseSerreInfo(tok.serreObj?.nom);
  const fromId = parseSerreInfo(tok.serreObj?.id);

  const serreNum =
    fromRaw.serreNum ??
    fromCode.serreNum ??
    fromNom.serreNum ??
    fromId.serreNum ??
    (tok.serreObj?.ordre && tok.serreObj.ordre > 0 ? tok.serreObj.ordre : null);

  const serreObjDT = tok.serreObj?.domaine_id
    ? formatPaiementDomaineDT(null, tok.serreObj.domaine_id)
    : null;
  const embeddedDT = fromRaw.embeddedDT ?? fromCode.embeddedDT ?? fromId.embeddedDT ?? null;
  const rangeDT = serreNum !== null ? getExpectedDTBySerreNum(serreNum) : null;
  const authoritativeDT = serreObjDT || embeddedDT || rangeDT || rowDT || '';
  const prefix = getSerreDomainePrefix(authoritativeDT);

  if (serreNum !== null && prefix) {
    return `${prefix}S${serreNum}`;
  }
  const fallback = (tok.serreObj?.code || tok.serreObj?.nom || tok.raw || '').trim().toUpperCase();
  return isUuidOrTechnicalId(fallback) ? '' : fallback;
}

export function parseTimeToHours(hhmm?: string | null): number | null {
  if (!hhmm) return null;
  const match = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return null;
  }
  return h + m / 60;
}

export function resolvePauseHours(
  heureDeb: string,
  heureFin: string,
  explicitPause?: number | ''
): number {
  if (explicitPause !== undefined && explicitPause !== '' && Number.isFinite(Number(explicitPause))) {
    return Math.max(0, Number(explicitPause));
  }
  const deb = heureDeb.trim();
  const fin = heureFin.trim();
  if (deb === '07:00' && fin === '14:00') return 0;
  if (deb === '07:00' && fin === '16:00') return 1;
  const debH = parseTimeToHours(deb);
  const finH = parseTimeToHours(fin);
  if (debH !== null && finH !== null) {
    const span = finH >= debH ? finH - debH : 24 - debH + finH;
    return span >= 8 ? 1 : 0;
  }
  return 1;
}

export function computeEffectiveWorkedHours(
  heureDeb: string,
  heureFin: string,
  pauseHours: number
): number {
  const deb = parseTimeToHours(heureDeb);
  const fin = parseTimeToHours(heureFin);
  if (deb === null || fin === null) return 0;
  const span = fin >= deb ? fin - deb : 24 - deb + fin;
  return Math.max(0, roundPaiementAmount(span - Math.max(0, pauseHours)));
}

// ------------------------- PERSISTANCE TARIFS (ADMIN UNIQUEMENT) -------------------------

function getStorageSafe(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function hasSavedLocalPaiementTariffs(companyId: string): boolean {
  const store = getStorageSafe();
  if (!store || !companyId) return false;
  try {
    return Boolean(store.getItem(`${PAIEMENT_TARIFFS_STORAGE_PREFIX}:${companyId}`));
  } catch {
    return false;
  }
}

function parseTariffsConfigObject(parsed: any): PaiementTariffsConfig {
  const defaults = createDefaultPaiementTariffs();
  const numOr = (val: unknown, fallback: number): number => {
    if (val === undefined || val === null || val === '') return fallback;
    const n = Number(val);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  const posNumOr = (val: unknown, fallback: number): number => {
    if (val === undefined || val === null || val === '') return fallback;
    const n = Number(val);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };

  const rawCustomObj = parsed?.customTaskTariffs ?? parsed?.custom_task_tariffs;
  const thresholdMeta =
    rawCustomObj && typeof rawCustomObj === 'object'
      ? (rawCustomObj as Record<string, any>)[THRESHOLD_TARIFFS_RESERVED_KEY]
      : undefined;

  const cleanCustomMap: Record<string, CustomTaskTariffRule> = {};
  if (rawCustomObj && typeof rawCustomObj === 'object') {
    for (const [k, rule] of Object.entries(rawCustomObj as Record<string, any>)) {
      if (k === THRESHOLD_TARIFFS_RESERVED_KEY || !rule || typeof rule !== 'object') continue;
      cleanCustomMap[k] = {
        tacheKey: String(rule.tacheKey || k),
        label: String(rule.label || k),
        mode: rule.mode || 'FORFAIT_JOUR',
        value: numOr(rule.value, 0),
        unite: typeof rule.unite === 'string' && rule.unite.trim() ? rule.unite.trim() : undefined,
        quantiteRef:
          rule.quantiteRef !== undefined && Number(rule.quantiteRef) > 0
            ? Number(rule.quantiteRef)
            : undefined,
        coefficient:
          rule.coefficient !== undefined && Number(rule.coefficient) >= 0
            ? Number(rule.coefficient)
            : undefined,
        actif: rule.actif !== false,
      };
    }
  }

  return {
    recolteCeriseCoeff: numOr(parsed?.recolteCeriseCoeff ?? parsed?.recolte_cerise_coeff, defaults.recolteCeriseCoeff),
    recolteRondeTarif: numOr(parsed?.recolteRondeTarif ?? parsed?.recolte_ronde_tarif, defaults.recolteRondeTarif),
    tttD2Heure: numOr(parsed?.tttD2Heure ?? parsed?.ttt_d2_heure, defaults.tttD2Heure),
    tttD3Heure: numOr(parsed?.tttD3Heure ?? parsed?.ttt_d3_heure, defaults.tttD3Heure),
    travailNormalJour: numOr(parsed?.travailNormalJour ?? parsed?.travail_normal_jour, defaults.travailNormalJour),
    stationnaireJour: numOr(parsed?.stationnaireJour ?? parsed?.stationnaire_jour, defaults.stationnaireJour),
    gardienJour: numOr(parsed?.gardienJour ?? parsed?.gardien_jour, defaults.gardienJour),
    ebourgeonnageD5Jour: numOr(parsed?.ebourgeonnageD5Jour ?? parsed?.ebourgeonnage_d5_jour, defaults.ebourgeonnageD5Jour),
    chariotTarifRef: numOr(
      parsed?.chariotTarifRef ?? parsed?.chariot_tarif_ref ?? thresholdMeta?.chariotTarifRef,
      defaults.chariotTarifRef
    ),
    chariotQuantiteRef: posNumOr(
      parsed?.chariotQuantiteRef ?? parsed?.chariot_quantite_ref ?? thresholdMeta?.chariotQuantiteRef,
      defaults.chariotQuantiteRef
    ),
    transfertCaisseTarifRef: numOr(
      parsed?.transfertCaisseTarifRef ??
        parsed?.transfert_caisse_tarif_ref ??
        thresholdMeta?.transfertCaisseTarifRef,
      defaults.transfertCaisseTarifRef
    ),
    transfertCaisseQuantiteRef: posNumOr(
      parsed?.transfertCaisseQuantiteRef ??
        parsed?.transfert_caisse_quantite_ref ??
        thresholdMeta?.transfertCaisseQuantiteRef,
      defaults.transfertCaisseQuantiteRef
    ),
    customTaskTariffs: cleanCustomMap,
    version:
      Number.isInteger(Number(parsed?.version)) && Number(parsed?.version) >= 1
        ? Number(parsed.version)
        : 1,
    updatedAt:
      typeof (parsed?.updatedAt ?? parsed?.updated_at) === 'string'
        ? (parsed.updatedAt ?? parsed.updated_at)
        : defaults.updatedAt,
    updatedBy:
      typeof (parsed?.updatedBy ?? parsed?.updated_by_nom) === 'string'
        ? (parsed.updatedBy ?? parsed.updated_by_nom)
        : undefined,
  };
}

export function loadPaiementTariffs(companyId: string): PaiementTariffsConfig {
  const store = getStorageSafe();
  const defaults = createDefaultPaiementTariffs();
  if (!store || !companyId) return defaults;
  try {
    const raw = store.getItem(`${PAIEMENT_TARIFFS_STORAGE_PREFIX}:${companyId}`);
    if (!raw) return defaults;
    return parseTariffsConfigObject(JSON.parse(raw));
  } catch {
    return defaults;
  }
}

export function savePaiementTariffs(
  user: Pick<UserAccount, 'role' | 'module_attribue' | 'username' | 'nom' | 'actif'> | null | undefined,
  companyId: string,
  nextTariffs: Partial<PaiementTariffsConfig>,
  options?: { preserveTimestampAndVersion?: boolean }
): { success: boolean; config?: PaiementTariffsConfig; error?: string } {
  if (!isAdminPaiementAuthorized(user)) {
    return {
      success: false,
      error: 'Accès refusé : seul l’administrateur peut modifier les tarifs de paiement.',
    };
  }
  const current = loadPaiementTariffs(companyId);
  const validateRate = (val: unknown, fallback: number): number => {
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return n;
  };
  const validatePositive = (val: unknown, fallback: number): number => {
    const n = Number(val);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return n;
  };
  const nextVersion = options?.preserveTimestampAndVersion
    ? Math.max(1, Number(nextTariffs.version || current.version || 1))
    : Math.max(1, Number(current.version || 1)) + 1;

  const rawCustomInput =
    nextTariffs.customTaskTariffs !== undefined
      ? nextTariffs.customTaskTariffs
      : current.customTaskTariffs;
  const cleanedCustom: Record<string, CustomTaskTariffRule> = {};
  if (rawCustomInput && typeof rawCustomInput === 'object') {
    for (const [k, rule] of Object.entries(rawCustomInput)) {
      if (k === THRESHOLD_TARIFFS_RESERVED_KEY || !rule || typeof rule !== 'object') continue;
      cleanedCustom[k] = {
        ...rule,
        tacheKey: String(rule.tacheKey || k),
        label: String(rule.label || k),
        value: validateRate(rule.value, 0),
        actif: rule.actif !== false,
      };
    }
  }

  const merged: PaiementTariffsConfig = {
    recolteCeriseCoeff: validateRate(nextTariffs.recolteCeriseCoeff, current.recolteCeriseCoeff),
    recolteRondeTarif: validateRate(nextTariffs.recolteRondeTarif, current.recolteRondeTarif),
    tttD2Heure: validateRate(nextTariffs.tttD2Heure, current.tttD2Heure),
    tttD3Heure: validateRate(nextTariffs.tttD3Heure, current.tttD3Heure),
    travailNormalJour: validateRate(nextTariffs.travailNormalJour, current.travailNormalJour),
    stationnaireJour: validateRate(nextTariffs.stationnaireJour, current.stationnaireJour),
    gardienJour: validateRate(nextTariffs.gardienJour, current.gardienJour),
    ebourgeonnageD5Jour: validateRate(nextTariffs.ebourgeonnageD5Jour, current.ebourgeonnageD5Jour),
    chariotTarifRef: validateRate(nextTariffs.chariotTarifRef, current.chariotTarifRef),
    chariotQuantiteRef: validatePositive(nextTariffs.chariotQuantiteRef, current.chariotQuantiteRef),
    transfertCaisseTarifRef: validateRate(
      nextTariffs.transfertCaisseTarifRef,
      current.transfertCaisseTarifRef
    ),
    transfertCaisseQuantiteRef: validatePositive(
      nextTariffs.transfertCaisseQuantiteRef,
      current.transfertCaisseQuantiteRef
    ),
    customTaskTariffs: cleanedCustom,
    version: nextVersion,
    updatedAt:
      options?.preserveTimestampAndVersion && typeof nextTariffs.updatedAt === 'string'
        ? nextTariffs.updatedAt
        : new Date().toISOString(),
    updatedBy:
      (options?.preserveTimestampAndVersion && nextTariffs.updatedBy) ||
      user?.nom ||
      user?.username ||
      'admin',
  };

  const store = getStorageSafe();
  if (store && companyId) {
    try {
      store.setItem(`${PAIEMENT_TARIFFS_STORAGE_PREFIX}:${companyId}`, JSON.stringify(merged));
    } catch {
      return { success: false, error: 'Impossible d’enregistrer les tarifs dans le stockage local.' };
    }
  }
  return { success: true, config: merged };
}

export function resetPaiementTariffsToDefaults(
  user: Pick<UserAccount, 'role' | 'module_attribue' | 'username' | 'nom' | 'actif'> | null | undefined,
  companyId: string
): { success: boolean; config?: PaiementTariffsConfig; error?: string } {
  const defaults = createDefaultPaiementTariffs();
  return savePaiementTariffs(user, companyId, {
    ...defaults,
    customTaskTariffs: {},
  });
}

// ------------------------- HISTORIQUE NON-RÉTROACTIF -------------------------

export function loadPaiementExportHistory(companyId: string): PaiementExportSnapshot[] {
  const store = getStorageSafe();
  if (!store || !companyId) return [];
  try {
    const raw = store.getItem(`${PAIEMENT_EXPORTS_HISTORY_PREFIX}:${companyId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getFrozenSnapshotForDate(
  companyId: string,
  dateIso: string,
  domaineFilter: string = 'ALL'
): PaiementExportSnapshot | null {
  const history = loadPaiementExportHistory(companyId);
  const exact = history.find(
    (s) => s.dateIso === dateIso && s.domaineFilter === domaineFilter
  );
  if (exact) return exact;
  if (domaineFilter !== 'ALL') {
    const fullDay = history.find(
      (s) => s.dateIso === dateIso && s.domaineFilter === 'ALL'
    );
    if (fullDay) return fullDay;
  }
  return null;
}

/**
 * Enregistre un snapshot d'export figé (sans plafond artificiel de 120 entrées).
 */
export function savePaiementExportSnapshot(
  user: Pick<UserAccount, 'id' | 'role' | 'module_attribue' | 'username' | 'nom' | 'actif'> | null | undefined,
  snapshot: Omit<PaiementExportSnapshot, 'id' | 'exportedAt' | 'exportedById' | 'exportedByNom'> & {
    id?: string;
    exportedAt?: string;
    exportedById?: string;
    exportedByNom?: string;
  }
): { success: boolean; snapshot?: PaiementExportSnapshot; error?: string } {
  if (!isAdminPaiementAuthorized(user)) {
    return {
      success: false,
      error: 'Accès refusé : seul l’administrateur peut enregistrer un export de paiement.',
    };
  }
  const store = getStorageSafe();
  const entry: PaiementExportSnapshot = {
    ...snapshot,
    id: snapshot.id || `exp_${snapshot.dateIso}_${snapshot.domaineFilter}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    exportedAt: snapshot.exportedAt || new Date().toISOString(),
    exportedById: snapshot.exportedById || user?.id || 'usr_admin',
    exportedByNom: snapshot.exportedByNom || user?.nom || user?.username || 'Admin',
  };
  if (store && snapshot.companyId) {
    try {
      const existing = loadPaiementExportHistory(snapshot.companyId);
      const filtered = existing.filter(
        (s) => !(s.id === entry.id || (s.dateIso === snapshot.dateIso && s.domaineFilter === snapshot.domaineFilter))
      );
      // Conservation illimitée des snapshots historiques (aucune troncature à 120)
      const next = [entry, ...filtered].sort((a, b) =>
        String(b.exportedAt || '').localeCompare(String(a.exportedAt || ''))
      );
      store.setItem(`${PAIEMENT_EXPORTS_HISTORY_PREFIX}:${snapshot.companyId}`, JSON.stringify(next));
    } catch {
      return { success: false, error: 'Impossible de sauvegarder l’historique d’export.' };
    }
  }
  return { success: true, snapshot: entry };
}

export function mergePaiementSnapshots(
  localList: PaiementExportSnapshot[],
  remoteList: PaiementExportSnapshot[]
): PaiementExportSnapshot[] {
  const byKey = new Map<string, PaiementExportSnapshot>();
  [...localList, ...remoteList].forEach((snap) => {
    if (!snap || !snap.dateIso) return;
    const key = `${snap.dateIso}__${snap.domaineFilter || 'ALL'}`;
    const prev = byKey.get(key);
    if (!prev || String(snap.exportedAt || '') > String(prev.exportedAt || '')) {
      byKey.set(key, snap);
    }
  });
  return Array.from(byKey.values()).sort((a, b) =>
    String(b.exportedAt || '').localeCompare(String(a.exportedAt || ''))
  );
}

// ------------------------- SYNCHRONISATION SUPABASE MULTI-APPAREILS -------------------------

export async function syncLoadPaiementTariffsFromSupabase(
  companyId: string,
  client: Pick<SupabaseClient, 'from'>
): Promise<{
  ok: boolean;
  config: PaiementTariffsConfig;
  source: 'remote' | 'local' | 'default';
  error?: string;
}> {
  const localHasSaved = hasSavedLocalPaiementTariffs(companyId);
  const localConfig = loadPaiementTariffs(companyId);

  if (!companyId) {
    return { ok: false, config: localConfig, source: localHasSaved ? 'local' : 'default', error: 'companyId manquant.' };
  }

  try {
    const { data, error } = await client
      .from('paiement_tariffs')
      .select('*')
      .eq('company_id', companyId)
      .maybeSingle();

    if (error) {
      // Ne jamais écraser les tarifs existants avec les valeurs par défaut en cas d'erreur de sync
      return {
        ok: false,
        config: localConfig,
        source: localHasSaved ? 'local' : 'default',
        error: error.message || 'Erreur de lecture des tarifs Supabase.',
      };
    }

    if (!data) {
      return {
        ok: true,
        config: localConfig,
        source: localHasSaved ? 'local' : 'default',
      };
    }

    const remoteConfig = parseTariffsConfigObject(data);

    // Conflit de version/horodatage : la version la plus récente gagne ;
    // si le stockage local ne contenait aucun tarif sauvegardé (nouvel appareil), le serveur gagne toujours.
    const remoteMs = Date.parse(remoteConfig.updatedAt) || 0;
    const localMs = Date.parse(localConfig.updatedAt) || 0;

    if (
      !localHasSaved ||
      remoteConfig.version > localConfig.version ||
      (remoteConfig.version === localConfig.version && remoteMs >= localMs)
    ) {
      const store = getStorageSafe();
      if (store) {
        try {
          store.setItem(
            `${PAIEMENT_TARIFFS_STORAGE_PREFIX}:${companyId}`,
            JSON.stringify(remoteConfig)
          );
        } catch {
          // Stockage local plein ignoré
        }
      }
      return { ok: true, config: remoteConfig, source: 'remote' };
    }

    return { ok: true, config: localConfig, source: 'local' };
  } catch (err: unknown) {
    return {
      ok: false,
      config: localConfig,
      source: localHasSaved ? 'local' : 'default',
      error: err instanceof Error ? err.message : 'Erreur réseau lors du chargement des tarifs.',
    };
  }
}

export async function syncSavePaiementTariffsToSupabase(
  user: Pick<UserAccount, 'id' | 'role' | 'module_attribue' | 'username' | 'nom' | 'actif'> | null | undefined,
  companyId: string,
  nextTariffs: Partial<PaiementTariffsConfig>,
  client?: Pick<SupabaseClient, 'from'> | null
): Promise<{
  success: boolean;
  config?: PaiementTariffsConfig;
  syncedToSupabase: boolean;
  syncError?: string;
  error?: string;
  offlineQueued?: boolean;
}> {
  const localRes = savePaiementTariffs(user, companyId, nextTariffs);
  if (!localRes.success || !localRes.config) {
    return {
      success: false,
      syncedToSupabase: false,
      error: localRes.error || 'Échec de sauvegarde locale.',
    };
  }

  const payload = {
    company_id: companyId,
    recolte_cerise_coeff: localRes.config.recolteCeriseCoeff,
    recolte_ronde_tarif: localRes.config.recolteRondeTarif,
    ttt_d2_heure: localRes.config.tttD2Heure,
    ttt_d3_heure: localRes.config.tttD3Heure,
    travail_normal_jour: localRes.config.travailNormalJour,
    stationnaire_jour: localRes.config.stationnaireJour,
    gardien_jour: localRes.config.gardienJour,
    ebourgeonnage_d5_jour: localRes.config.ebourgeonnageD5Jour,
    custom_task_tariffs: {
      ...(localRes.config.customTaskTariffs || {}),
      [THRESHOLD_TARIFFS_RESERVED_KEY]: {
        chariotTarifRef: localRes.config.chariotTarifRef,
        chariotQuantiteRef: localRes.config.chariotQuantiteRef,
        transfertCaisseTarifRef: localRes.config.transfertCaisseTarifRef,
        transfertCaisseQuantiteRef: localRes.config.transfertCaisseQuantiteRef,
      },
    },
    version: localRes.config.version,
    updated_at: localRes.config.updatedAt,
    updated_by_id: user?.id || null,
    updated_by_nom: localRes.config.updatedBy || null,
  };
  const entityId = `ptf_${companyId}`;

  if (!client || !companyId || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    if (companyId) {
      enqueueOutboxOp(OUTBOX_KEYS.PAIEMENT, {
        table: 'paiement_tariffs',
        entityId,
        action: 'upsert',
        data: payload,
        companyId,
      });
    }
    return { success: true, config: localRes.config, syncedToSupabase: false, offlineQueued: true };
  }

  try {
    const { error } = await client
      .from('paiement_tariffs')
      .upsert(payload, { onConflict: 'company_id' });

    if (error) {
      enqueueOutboxOp(OUTBOX_KEYS.PAIEMENT, {
        table: 'paiement_tariffs',
        entityId,
        action: 'upsert',
        data: payload,
        companyId,
      });
      return {
        success: true,
        config: localRes.config,
        syncedToSupabase: false,
        offlineQueued: true,
        syncError: error.message || 'Échec de synchronisation distante des tarifs.',
      };
    }

    const matchingOps = getOutboxOps(OUTBOX_KEYS.PAIEMENT)
      .filter((o) => o.table === 'paiement_tariffs' && o.entityId === entityId)
      .map((o) => o.opId);
    if (matchingOps.length > 0) dequeueOutboxOpsById(OUTBOX_KEYS.PAIEMENT, matchingOps);

    return { success: true, config: localRes.config, syncedToSupabase: true };
  } catch (err: unknown) {
    enqueueOutboxOp(OUTBOX_KEYS.PAIEMENT, {
      table: 'paiement_tariffs',
      entityId,
      action: 'upsert',
      data: payload,
      companyId,
    });
    return {
      success: true,
      config: localRes.config,
      syncedToSupabase: false,
      offlineQueued: true,
      syncError: err instanceof Error ? err.message : 'Erreur réseau lors de la synchronisation.',
    };
  }
}

export async function syncLoadPaiementSnapshotsFromSupabase(
  companyId: string,
  client: Pick<SupabaseClient, 'from'>
): Promise<{ ok: boolean; snapshots: PaiementExportSnapshot[]; error?: string }> {
  const localSnaps = loadPaiementExportHistory(companyId);
  if (!companyId) return { ok: false, snapshots: localSnaps, error: 'companyId manquant.' };

  try {
    const { data, error } = await client
      .from('paiement_export_snapshots')
      .select('*')
      .eq('company_id', companyId)
      .order('exported_at', { ascending: false });

    if (error) {
      return {
        ok: false,
        snapshots: localSnaps,
        error: error.message || 'Erreur lors de la lecture de l’historique Supabase.',
      };
    }

    const remoteSnaps: PaiementExportSnapshot[] = Array.isArray(data)
      ? data.map((row: any) => ({
          id: String(row.id),
          companyId: String(row.company_id || companyId),
          dateIso: String(row.date_iso || ''),
          domaineFilter: String(row.domaine_filter || 'ALL'),
          exportedAt: String(row.exported_at || ''),
          exportedById: String(row.exported_by_id || ''),
          exportedByNom: String(row.exported_by_nom || 'Admin'),
          filename: String(row.filename || ''),
          tariffsSnapshot: parseTariffsConfigObject(row.tariffs_snapshot),
          rows: Array.isArray(row.rows) ? row.rows : [],
          totalByWorker: Array.isArray(row.total_by_worker) ? row.total_by_worker : [],
          grandTotalDH: Number(row.grand_total_dh) || 0,
          totalOuvriersDistincts: Number(row.total_ouvriers_distincts) || 0,
        }))
      : [];

    const merged = mergePaiementSnapshots(localSnaps, remoteSnaps);
    const store = getStorageSafe();
    if (store && merged.length > 0) {
      try {
        store.setItem(`${PAIEMENT_EXPORTS_HISTORY_PREFIX}:${companyId}`, JSON.stringify(merged));
      } catch {
        // Quota ignoré
      }
    }
    return { ok: true, snapshots: merged };
  } catch (err: unknown) {
    return {
      ok: false,
      snapshots: localSnaps,
      error: err instanceof Error ? err.message : 'Erreur réseau historique Supabase.',
    };
  }
}

export async function syncSavePaiementSnapshotToSupabase(
  user: Pick<UserAccount, 'id' | 'role' | 'module_attribue' | 'username' | 'nom' | 'actif'> | null | undefined,
  snapshot: PaiementExportSnapshot,
  client?: Pick<SupabaseClient, 'from'> | null
): Promise<{ ok: boolean; error?: string; offlineQueued?: boolean }> {
  if (!isAdminPaiementAuthorized(user)) {
    return { ok: false, error: 'Accès refusé : Administrateur uniquement.' };
  }
  if (!snapshot.companyId) {
    return { ok: false, error: 'companyId manquant.' };
  }

  const payload = {
    id: snapshot.id,
    company_id: snapshot.companyId,
    date_iso: snapshot.dateIso,
    domaine_filter: snapshot.domaineFilter || 'ALL',
    filename: snapshot.filename,
    tariffs_snapshot: snapshot.tariffsSnapshot,
    tariff_version: snapshot.tariffsSnapshot?.version || 1,
    rows: snapshot.rows,
    total_by_worker: snapshot.totalByWorker,
    grand_total_dh: snapshot.grandTotalDH,
    total_ouvriers_distincts: snapshot.totalOuvriersDistincts,
    exported_by_id: snapshot.exportedById,
    exported_by_nom: snapshot.exportedByNom,
    exported_at: snapshot.exportedAt,
  };

  if (!client || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    enqueueOutboxOp(OUTBOX_KEYS.PAIEMENT, {
      table: 'paiement_export_snapshots',
      entityId: snapshot.id,
      action: 'upsert',
      data: payload,
      companyId: snapshot.companyId,
    });
    return { ok: false, offlineQueued: true, error: 'Snapshot mis en file hors ligne.' };
  }

  try {
    const { error } = await client.from('paiement_export_snapshots').insert(payload);
    if (error) {
      const isDuplicate =
        error.code === '23505' || String(error.message || '').toLowerCase().includes('duplicate');
      if (isDuplicate) {
        return { ok: true };
      }
      enqueueOutboxOp(OUTBOX_KEYS.PAIEMENT, {
        table: 'paiement_export_snapshots',
        entityId: snapshot.id,
        action: 'upsert',
        data: payload,
        companyId: snapshot.companyId,
      });
      return { ok: false, offlineQueued: true, error: error.message || 'Erreur insertion snapshot Supabase.' };
    }
    return { ok: true };
  } catch (err: unknown) {
    enqueueOutboxOp(OUTBOX_KEYS.PAIEMENT, {
      table: 'paiement_export_snapshots',
      entityId: snapshot.id,
      action: 'upsert',
      data: payload,
      companyId: snapshot.companyId,
    });
    return {
      ok: false,
      offlineQueued: true,
      error: err instanceof Error ? err.message : 'Erreur réseau insertion snapshot.',
    };
  }
}

export async function syncLoadPaiementDayOverridesFromSupabase(
  companyId: string,
  dateIso: string,
  client: Pick<SupabaseClient, 'from'>
): Promise<{
  ok: boolean;
  hoursOverrides: Record<string, PaiementHoursOverride>;
  varietyOverrides: Record<string, RecolteVarietyChoice>;
  error?: string;
}> {
  const localHours = loadHoursOverridesForDate(companyId, dateIso);
  const localVarieties = loadVarietyOverridesForDate(companyId, dateIso);
  if (!companyId || !dateIso || !client) {
    return { ok: false, hoursOverrides: localHours, varietyOverrides: localVarieties };
  }

  try {
    const { data, error } = await client
      .from('paiement_day_overrides')
      .select('*')
      .eq('company_id', companyId)
      .eq('date_iso', dateIso);

    if (error) {
      return {
        ok: false,
        hoursOverrides: localHours,
        varietyOverrides: localVarieties,
        error: error.message || 'Erreur lecture surcharges paiement Supabase.',
      };
    }

    const nextHours = { ...localHours };
    const nextVarieties = { ...localVarieties };

    if (Array.isArray(data)) {
      for (const row of data as any[]) {
        if (!row || !row.row_key) continue;
        const entityId = `${companyId}__${dateIso}__${row.override_type}__${row.row_key}`;
        if (hasPendingOutboxEntity(OUTBOX_KEYS.PAIEMENT, 'paiement_day_overrides', entityId)) {
          continue;
        }
        if (row.override_type === 'hours' && row.payload && typeof row.payload === 'object') {
          nextHours[row.row_key] = row.payload as PaiementHoursOverride;
        } else if (row.override_type === 'variety') {
          const choice =
            typeof row.payload === 'string'
              ? row.payload
              : row.payload?.choice;
          if (choice === 'CERISE' || choice === 'RONDE') {
            nextVarieties[row.row_key] = choice;
          }
        }
      }
      saveHoursOverridesForDate(companyId, dateIso, nextHours);
      saveVarietyOverridesForDate(companyId, dateIso, nextVarieties);
    }

    return { ok: true, hoursOverrides: nextHours, varietyOverrides: nextVarieties };
  } catch (err: unknown) {
    return {
      ok: false,
      hoursOverrides: localHours,
      varietyOverrides: localVarieties,
      error: err instanceof Error ? err.message : 'Erreur réseau surcharges paiement.',
    };
  }
}

export async function syncSavePaiementDayOverrideToSupabase(
  user: Pick<UserAccount, 'id' | 'role' | 'module_attribue' | 'username' | 'nom' | 'actif'> | null | undefined,
  companyId: string,
  dateIso: string,
  overrideType: 'hours' | 'variety',
  rowKey: string,
  payloadData: PaiementHoursOverride | { choice: RecolteVarietyChoice } | null,
  client?: Pick<SupabaseClient, 'from'> | null
): Promise<{ ok: boolean; syncedToSupabase: boolean; offlineQueued?: boolean; error?: string }> {
  if (!isAdminPaiementAuthorized(user)) {
    return { ok: false, syncedToSupabase: false, error: 'Accès refusé : Administrateur uniquement.' };
  }
  if (!companyId || !dateIso || !rowKey) {
    return { ok: false, syncedToSupabase: false, error: 'Paramètres invalides.' };
  }

  const entityId = `${companyId}__${dateIso}__${overrideType}__${rowKey}`;
  const isDelete = payloadData === null;
  const dbRow = {
    id: entityId,
    company_id: companyId,
    date_iso: dateIso,
    override_type: overrideType,
    row_key: rowKey,
    payload: payloadData || {},
    updated_at: new Date().toISOString(),
    updated_by_id: user?.id || null,
    updated_by_nom: user?.nom || user?.username || 'Admin',
  };

  if (!client || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    enqueueOutboxOp(OUTBOX_KEYS.PAIEMENT, {
      table: 'paiement_day_overrides',
      entityId,
      action: isDelete ? 'delete' : 'upsert',
      data: isDelete ? { id: entityId, company_id: companyId, date_iso: dateIso, override_type: overrideType, row_key: rowKey } : dbRow,
      companyId,
    });
    return { ok: true, syncedToSupabase: false, offlineQueued: true };
  }

  try {
    if (isDelete) {
      const { error } = await client
        .from('paiement_day_overrides')
        .delete()
        .eq('company_id', companyId)
        .eq('date_iso', dateIso)
        .eq('override_type', overrideType)
        .eq('row_key', rowKey);
      if (error) throw error;
    } else {
      const { error } = await client
        .from('paiement_day_overrides')
        .upsert(dbRow, { onConflict: 'company_id,date_iso,override_type,row_key' });
      if (error) throw error;
    }
    return { ok: true, syncedToSupabase: true };
  } catch (err: unknown) {
    enqueueOutboxOp(OUTBOX_KEYS.PAIEMENT, {
      table: 'paiement_day_overrides',
      entityId,
      action: isDelete ? 'delete' : 'upsert',
      data: isDelete ? { id: entityId, company_id: companyId, date_iso: dateIso, override_type: overrideType, row_key: rowKey } : dbRow,
      companyId,
    });
    return {
      ok: true,
      syncedToSupabase: false,
      offlineQueued: true,
      error: err instanceof Error ? err.message : 'Erreur réseau surcharge paiement.',
    };
  }
}

export async function flushPaiementSyncQueue(
  user: Pick<UserAccount, 'id' | 'role' | 'module_attribue' | 'username' | 'nom' | 'actif'> | null | undefined,
  companyId: string,
  client?: Pick<SupabaseClient, 'from'> | null,
  options?: { ignoreNavigatorOnline?: boolean }
): Promise<{ syncedCount: number; failedCount: number; errors: string[] }> {
  const summary = { syncedCount: 0, failedCount: 0, errors: [] as string[] };
  if (!isAdminPaiementAuthorized(user)) return summary;
  if (!client || !companyId) return summary;
  if (!options?.ignoreNavigatorOnline && typeof navigator !== 'undefined' && navigator.onLine === false) {
    return summary;
  }

  const ops = getOutboxOps(OUTBOX_KEYS.PAIEMENT).filter(
    (op) => !op.companyId || op.companyId === companyId
  );
  if (ops.length === 0) return summary;

  const confirmedIds: string[] = [];

  for (const op of ops) {
    try {
      if (op.table === 'paiement_tariffs') {
        const { error } = await client
          .from('paiement_tariffs')
          .upsert(op.data, { onConflict: 'company_id' });
        if (error) throw error;
      } else if (op.table === 'paiement_export_snapshots') {
        const { error } = await client.from('paiement_export_snapshots').insert(op.data);
        if (error) {
          const isDuplicate =
            error.code === '23505' || String(error.message || '').toLowerCase().includes('duplicate');
          if (!isDuplicate) throw error;
        }
      } else if (op.table === 'paiement_day_overrides') {
        if (op.action === 'delete') {
          const { error } = await client
            .from('paiement_day_overrides')
            .delete()
            .eq('company_id', op.data?.company_id || companyId)
            .eq('date_iso', op.data?.date_iso)
            .eq('override_type', op.data?.override_type)
            .eq('row_key', op.data?.row_key);
          if (error) throw error;
        } else {
          const { error } = await client
            .from('paiement_day_overrides')
            .upsert(op.data, { onConflict: 'company_id,date_iso,override_type,row_key' });
          if (error) throw error;
        }
      }
      confirmedIds.push(op.opId);
      summary.syncedCount += 1;
    } catch (err: any) {
      const msg = err?.message || 'Erreur synchronisation Paiement';
      summary.failedCount += 1;
      summary.errors.push(msg);
      markOutboxOpsFailed(OUTBOX_KEYS.PAIEMENT, [op.opId], msg);
    }
  }

  if (confirmedIds.length > 0) {
    dequeueOutboxOpsById(OUTBOX_KEYS.PAIEMENT, confirmedIds);
  }
  return summary;
}

// ------------------------- CLASSIFICATEUR D'ERREURS SUPABASE -------------------------

export interface SupabaseQueryOutcome {
  label: string;
  critical: boolean;
  error?: { message?: string; code?: string; status?: number } | null;
}

export function classifySupabaseLoadErrors(params: {
  hasSession: boolean;
  sessionError?: { message?: string } | null;
  outcomes?: SupabaseQueryOutcome[];
  thrownError?: unknown;
}): {
  hasError: boolean;
  isSessionExpired: boolean;
  isRlsBlocked: boolean;
  isNetworkError: boolean;
  userMessage: string | null;
  technicalDetails: string[];
} {
  const details: string[] = [];
  let isSessionExpired = false;
  let isRlsBlocked = false;
  let isNetworkError = false;

  if (params.sessionError) {
    isSessionExpired = true;
    details.push(`Session Supabase : ${params.sessionError.message || 'erreur de session'}`);
  } else if (!params.hasSession) {
    isSessionExpired = true;
    details.push('Session Supabase expirée ou absente (reconnexion requise).');
  }

  if (params.thrownError) {
    isNetworkError = true;
    details.push(
      params.thrownError instanceof Error
        ? `Réseau : ${params.thrownError.message}`
        : 'Erreur réseau lors de la lecture Supabase.'
    );
  }

  const criticalFailures: string[] = [];
  (params.outcomes || []).forEach((o) => {
    if (!o.error) return;
    const msg = String(o.error.message || 'Erreur inconnue');
    const code = String(o.error.code || '');
    const msgLower = msg.toLowerCase();

    if (
      code === '42501' ||
      msgLower.includes('permission denied') ||
      msgLower.includes('row-level security') ||
      o.error.status === 403
    ) {
      isRlsBlocked = true;
    } else if (
      msgLower.includes('jwt') ||
      msgLower.includes('token') ||
      msgLower.includes('expired') ||
      o.error.status === 401
    ) {
      isSessionExpired = true;
    } else if (
      msgLower.includes('fetch') ||
      msgLower.includes('network') ||
      msgLower.includes('timeout')
    ) {
      isNetworkError = true;
    }

    const line = `${o.label} : ${msg}`;
    details.push(line);
    if (o.critical) criticalFailures.push(line);
  });

  const hasError =
    Boolean(params.sessionError) ||
    !params.hasSession ||
    Boolean(params.thrownError) ||
    criticalFailures.length > 0;

  return {
    hasError,
    isSessionExpired,
    isRlsBlocked,
    isNetworkError,
    userMessage: hasError
      ? "ERREUR DE CHARGEMENT DES DONNÉES — Les données n'ont pas pu être vérifiées. Vérifiez votre connexion avant de générer le paiement."
      : null,
    technicalDetails: details,
  };
}

// ------------------------- SURCHARGES HEURES & VARIÉTÉS -------------------------

export function loadHoursOverridesForDate(
  companyId: string,
  dateIso: string
): Record<string, PaiementHoursOverride> {
  const store = getStorageSafe();
  if (!store || !companyId || !dateIso) return {};
  try {
    const raw = store.getItem(`${PAIEMENT_HOURS_OVERRIDES_PREFIX}:${companyId}:${dateIso}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveHoursOverridesForDate(
  companyId: string,
  dateIso: string,
  overrides: Record<string, PaiementHoursOverride>
): void {
  const store = getStorageSafe();
  if (!store || !companyId || !dateIso) return;
  try {
    store.setItem(`${PAIEMENT_HOURS_OVERRIDES_PREFIX}:${companyId}:${dateIso}`, JSON.stringify(overrides));
  } catch {
    // Quota ignoré
  }
}

export function loadVarietyOverridesForDate(
  companyId: string,
  dateIso: string
): Record<string, RecolteVarietyChoice> {
  const store = getStorageSafe();
  if (!store || !companyId || !dateIso) return {};
  try {
    const raw = store.getItem(`${PAIEMENT_VARIETY_OVERRIDES_PREFIX}:${companyId}:${dateIso}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveVarietyOverridesForDate(
  companyId: string,
  dateIso: string,
  overrides: Record<string, RecolteVarietyChoice>
): void {
  const store = getStorageSafe();
  if (!store || !companyId || !dateIso) return;
  try {
    store.setItem(`${PAIEMENT_VARIETY_OVERRIDES_PREFIX}:${companyId}:${dateIso}`, JSON.stringify(overrides));
  } catch {
    // Quota ignoré
  }
}

// ------------------------- RÉSOLUTION DES TARIFS PAR TÂCHE -------------------------

export interface ResolvedTaskTariff {
  category: PaiementTaskCategory;
  mode: PaiementTariffMode;
  tarifValue: number; // Coefficient (si RECOLTE_COEFF) ou DH/jour ou DH/h ou DH/unité ou tarifRef (CAISSE_SEUIL)
  quantiteRef?: number;
  coefficient: number | '';
  tarifAppliqueLabel: string;
  uniteMetrique: string;
  needsVarietySelection?: boolean;
  varietyBlockedReason?: string;
}

function findMatchingCustomRule(
  tache: Tache | null | undefined,
  customMap: Record<string, CustomTaskTariffRule>
): CustomTaskTariffRule | null {
  if (!tache || !customMap || typeof customMap !== 'object') return null;

  const directKeys = [tache.id, tache.code, tache.nom].filter(Boolean) as string[];
  for (const k of directKeys) {
    const r = customMap[k];
    if (r && r.actif !== false) return r;
  }

  const nomNorm = normalizeText(tache.nom);
  const codeNorm = normalizeText(tache.code);
  const idNorm = normalizeText(tache.id);

  for (const rule of Object.values(customMap)) {
    if (!rule || rule.actif === false) continue;
    const ruleKeyNorm = normalizeText(rule.tacheKey);
    const ruleLabelNorm = normalizeText(rule.label);
    if (
      (ruleKeyNorm && (ruleKeyNorm === idNorm || ruleKeyNorm === codeNorm || ruleKeyNorm === nomNorm)) ||
      (ruleLabelNorm && (ruleLabelNorm === nomNorm || ruleLabelNorm === codeNorm))
    ) {
      return rule;
    }
  }
  return null;
}

export function resolvePaiementTaskTariff(params: {
  tache?: Tache | null;
  domaineShort: string;
  recolteNotes?: string;
  recolteVarietes?: string[];
  varietyOverride?: RecolteVarietyChoice;
  tariffs: PaiementTariffsConfig;
}): ResolvedTaskTariff {
  const {
    tache,
    domaineShort,
    recolteNotes = '',
    recolteVarietes = [],
    varietyOverride,
    tariffs,
  } = params;
  const nomNorm = normalizeText(tache?.nom);
  const codeNorm = normalizeText(tache?.code);
  const notesNorm = normalizeText(recolteNotes);
  const varietesNorm = normalizeText(recolteVarietes.join(' '));
  const fullTask = `${nomNorm} ${codeNorm}`.trim();
  const domNorm = (domaineShort || '').trim().toUpperCase();

  // 0. Tarif personnalisé actif configuré pour une tâche spécifique par l'Admin
  const customMap = tariffs.customTaskTariffs || {};
  const customRule = findMatchingCustomRule(tache, customMap);
  if (customRule && Number(customRule.value) >= 0) {
    const v = Number(customRule.value);
    const refQty =
      customRule.quantiteRef && Number(customRule.quantiteRef) > 0
        ? Number(customRule.quantiteRef)
        : 400;
    const coeff =
      customRule.mode === 'RECOLTE_COEFF'
        ? Number(customRule.coefficient ?? v)
        : '';
    const effectiveValue =
      customRule.mode === 'RECOLTE_COEFF' && typeof coeff === 'number' ? coeff : v;
    const unite =
      customRule.unite?.trim() ||
      (customRule.mode === 'CAISSE_SEUIL'
        ? 'CAISSES'
        : customRule.mode === 'RECOLTE_COEFF' || customRule.mode === 'RECOLTE_UNITE'
        ? 'PLATEAUX'
        : customRule.mode === 'HEURE'
        ? 'HEURE'
        : 'JOUR');

    return {
      category: 'CUSTOM',
      mode: customRule.mode,
      tarifValue: effectiveValue,
      quantiteRef: customRule.mode === 'CAISSE_SEUIL' ? refQty : undefined,
      coefficient: coeff,
      tarifAppliqueLabel:
        customRule.mode === 'CAISSE_SEUIL'
          ? `${effectiveValue} DH / ${refQty} c. (prorata > ${refQty})`
          : customRule.mode === 'RECOLTE_COEFF'
          ? `Coeff ${effectiveValue}`
          : customRule.mode === 'HEURE'
          ? `${effectiveValue} DH / heure`
          : customRule.mode === 'RECOLTE_UNITE'
          ? `${effectiveValue} DH / ${unite.toLowerCase()}`
          : `${effectiveValue} DH / jour`,
      uniteMetrique: unite,
    };
  }

  // 0b. TRANSFERT CAISSE & CHARIOT (règles à seuil indépendantes : 400 c. = 95 DH, > 400 = prorata, jamais 95 DH forfait normal)
  const isTransfertCaisse =
    (fullTask.includes('transfert') && fullTask.includes('caisse')) ||
    fullTask.includes('transfert_caisse') ||
    /^tc0*\d*$/i.test(codeNorm);
  if (isTransfertCaisse) {
    const refTarif = tariffs.transfertCaisseTarifRef ?? DEFAULT_PAIEMENT_TARIFFS.transfertCaisseTarifRef;
    const refQty =
      tariffs.transfertCaisseQuantiteRef && tariffs.transfertCaisseQuantiteRef > 0
        ? tariffs.transfertCaisseQuantiteRef
        : DEFAULT_PAIEMENT_TARIFFS.transfertCaisseQuantiteRef;
    return {
      category: 'TRANSFERT_CAISSE',
      mode: 'CAISSE_SEUIL',
      tarifValue: refTarif,
      quantiteRef: refQty,
      coefficient: '',
      tarifAppliqueLabel: `${refTarif} DH / ${refQty} c. (prorata > ${refQty})`,
      uniteMetrique: 'CAISSES',
    };
  }

  const isChariot =
    fullTask.includes('chariot') ||
    /^ch0*\d*$/i.test(codeNorm);
  if (isChariot) {
    const refTarif = tariffs.chariotTarifRef ?? DEFAULT_PAIEMENT_TARIFFS.chariotTarifRef;
    const refQty =
      tariffs.chariotQuantiteRef && tariffs.chariotQuantiteRef > 0
        ? tariffs.chariotQuantiteRef
        : DEFAULT_PAIEMENT_TARIFFS.chariotQuantiteRef;
    return {
      category: 'CHARIOT',
      mode: 'CAISSE_SEUIL',
      tarifValue: refTarif,
      quantiteRef: refQty,
      coefficient: '',
      tarifAppliqueLabel: `${refTarif} DH / ${refQty} c. (prorata > ${refQty})`,
      uniteMetrique: 'CAISSES',
    };
  }

  // 1. RÉCOLTE (Cerise = 3,8 DH/caisse ; Ronde = 1,1875 DH/caisse ; Générique ambiguë => sélection requise)
  const isRecolte =
    fullTask.includes('recolte') ||
    fullTask.includes('cueillette') ||
    /^r0*\d+$/i.test(codeNorm);
  if (isRecolte) {
    if (varietyOverride === 'CERISE') {
      const coeff = tariffs.recolteCeriseCoeff;
      return {
        category: 'RECOLTE_CERISE',
        mode: 'RECOLTE_COEFF',
        tarifValue: coeff,
        coefficient: coeff,
        tarifAppliqueLabel: `${coeff} DH / caisse (Coeff ${coeff})`,
        uniteMetrique: 'PLATEAUX',
      };
    }
    if (varietyOverride === 'RONDE') {
      const tarifRonde = tariffs.recolteRondeTarif;
      return {
        category: 'RECOLTE_RONDE',
        mode: 'RECOLTE_UNITE',
        tarifValue: tarifRonde,
        coefficient: '',
        tarifAppliqueLabel: `${tarifRonde} DH / caisse`,
        uniteMetrique: 'PLATEAUX',
      };
    }

    const taskHasCerise = fullTask.includes('cerise');
    const taskHasRonde = fullTask.includes('ronde');

    if (taskHasCerise && !taskHasRonde) {
      const coeff = tariffs.recolteCeriseCoeff;
      return {
        category: 'RECOLTE_CERISE',
        mode: 'RECOLTE_COEFF',
        tarifValue: coeff,
        coefficient: coeff,
        tarifAppliqueLabel: `${coeff} DH / caisse (Coeff ${coeff})`,
        uniteMetrique: 'PLATEAUX',
      };
    }
    if (taskHasRonde && !taskHasCerise) {
      const tarifRonde = tariffs.recolteRondeTarif;
      return {
        category: 'RECOLTE_RONDE',
        mode: 'RECOLTE_UNITE',
        tarifValue: tarifRonde,
        coefficient: '',
        tarifAppliqueLabel: `${tarifRonde} DH / caisse`,
        uniteMetrique: 'PLATEAUX',
      };
    }

    // Tâche de récolte générique (ex: "RECOLTE" / R01) : vérifier si les données liées précisent de façon certaine
    // une variété unique (sans ambiguïté), sinon exiger une identification claire sans jamais deviner.
    const linkedSignal = `${varietesNorm} ${notesNorm}`.trim();
    const linkedCerise = /\bcerise\b/.test(linkedSignal);
    const linkedRonde = /\bronde\b/.test(linkedSignal);

    if (linkedCerise && !linkedRonde) {
      const coeff = tariffs.recolteCeriseCoeff;
      return {
        category: 'RECOLTE_CERISE',
        mode: 'RECOLTE_COEFF',
        tarifValue: coeff,
        coefficient: coeff,
        tarifAppliqueLabel: `${coeff} DH / caisse (Coeff ${coeff})`,
        uniteMetrique: 'PLATEAUX',
      };
    }
    if (linkedRonde && !linkedCerise) {
      const tarifRonde = tariffs.recolteRondeTarif;
      return {
        category: 'RECOLTE_RONDE',
        mode: 'RECOLTE_UNITE',
        tarifValue: tarifRonde,
        coefficient: '',
        tarifAppliqueLabel: `${tarifRonde} DH / caisse`,
        uniteMetrique: 'PLATEAUX',
      };
    }

    return {
      category: 'RECOLTE_AMBIGUE',
      mode: 'RECOLTE_UNITE',
      tarifValue: 0,
      coefficient: '',
      tarifAppliqueLabel: 'Variété requise (Cerise 3,8 ou Ronde 1,1875)',
      uniteMetrique: 'PLATEAUX',
      needsVarietySelection: true,
      varietyBlockedReason:
        linkedCerise && linkedRonde
          ? `Tâche générique "${tache?.nom || 'RECOLTE'}" avec notes mixtes (Cerise et Ronde) : choisissez la variété exacte avant d'exporter.`
          : `Tâche générique "${tache?.nom || 'RECOLTE'}" sans variété Cerise/Ronde explicite : choisissez la variété avant d'exporter.`,
    };
  }

  // 2. TTT D2 (15 DH / heure) et TTT D3 (16 DH / heure)
  const isTtt =
    /\bttt\b/.test(fullTask) ||
    /^ttt/i.test(codeNorm) ||
    fullTask.includes('ttt d2') ||
    fullTask.includes('ttt d3') ||
    fullTask.includes('traitement') ||
    fullTask.includes('phyto') ||
    /^phy/i.test(codeNorm);

  if (isTtt) {
    const explicitD2 =
      fullTask.includes('ttt d2') ||
      fullTask.includes('ttt02') ||
      fullTask.includes('tttd2') ||
      (/\bd2\b/.test(fullTask) && !fullTask.includes('d3'));
    const explicitD3 =
      fullTask.includes('ttt d3') ||
      fullTask.includes('ttt03') ||
      fullTask.includes('tttd3') ||
      (/\bd3\b/.test(fullTask) && !fullTask.includes('d2'));

    if (explicitD2 || (!explicitD3 && domNorm === 'D2')) {
      const rate = tariffs.tttD2Heure;
      return {
        category: 'TTT_D2',
        mode: 'HEURE',
        tarifValue: rate,
        coefficient: '',
        tarifAppliqueLabel: `${rate} DH / heure`,
        uniteMetrique: 'HEURE',
      };
    }
    if (explicitD3 || (!explicitD2 && domNorm === 'D3')) {
      const rate = tariffs.tttD3Heure;
      return {
        category: 'TTT_D3',
        mode: 'HEURE',
        tarifValue: rate,
        coefficient: '',
        tarifAppliqueLabel: `${rate} DH / heure`,
        uniteMetrique: 'HEURE',
      };
    }
  }

  // 3. ÉBOURGEONNAGE D5 (150 DH / jour — jamais cumulé avec 95 DH)
  if (
    fullTask.includes('ebourgeon') ||
    fullTask.includes('bourgeon') ||
    codeNorm === 'ebd05'
  ) {
    if (domNorm === 'D5' || fullTask.includes('d5') || codeNorm === 'ebd05') {
      const rate = tariffs.ebourgeonnageD5Jour;
      return {
        category: 'EBOURGEONNAGE_D5',
        mode: 'FORFAIT_JOUR',
        tarifValue: rate,
        coefficient: '',
        tarifAppliqueLabel: `${rate} DH / jour`,
        uniteMetrique: 'JOUR',
      };
    }
  }

  // 4. STATIONNAIRE (100 DH / jour — jamais cumulé avec 95 DH)
  if (fullTask.includes('stationnaire') || fullTask.includes('station') || codeNorm === 'sta01') {
    const rate = tariffs.stationnaireJour;
    return {
      category: 'STATIONNAIRE',
      mode: 'FORFAIT_JOUR',
      tarifValue: rate,
      coefficient: '',
      tarifAppliqueLabel: `${rate} DH / jour`,
      uniteMetrique: 'JOUR',
    };
  }

  // 5. GARDIEN (100 DH / jour — jamais cumulé avec 95 DH)
  if (fullTask.includes('gardien') || fullTask.includes('gardiennage') || codeNorm === 'gar01') {
    const rate = tariffs.gardienJour;
    return {
      category: 'GARDIEN',
      mode: 'FORFAIT_JOUR',
      tarifValue: rate,
      coefficient: '',
      tarifAppliqueLabel: `${rate} DH / jour`,
      uniteMetrique: 'JOUR',
    };
  }

  // 6. TRAVAIL NORMAL (95 DH / jour, ou prorata heures réelles 95/8 = 11,875 DH/h)
  const normalJour = tariffs.travailNormalJour;
  return {
    category: 'TRAVAIL_NORMAL',
    mode: 'NORMAL_JOUR',
    tarifValue: normalJour,
    coefficient: '',
    tarifAppliqueLabel: `${normalJour} DH / jour`,
    uniteMetrique: 'JOUR',
  };
}

// ------------------------- CONSTRUCTION DES LIGNES DE PAIEMENT -------------------------

export interface BuildPaiementParams {
  companyId?: string;
  dateIso: string;
  domaineFilter?: string;
  ouvriers: Ouvrier[];
  taches: Tache[];
  domaines: Domaine[];
  serres: Serre[];
  pointages: Pointage[];
  affectations: AffectationTache[];
  recoltes: RecolteEntry[];
  tacheSerresConfigs?: TacheSerreConfig[];
  defaultDomaineId?: string;
  tariffs?: PaiementTariffsConfig;
  hoursOverrides?: Record<string, PaiementHoursOverride>;
  varietyOverrides?: Record<string, RecolteVarietyChoice>;
  respectFrozenSnapshot?: boolean;
}

export function buildPaiementRows(params: BuildPaiementParams): PaiementPreviewResult {
  const {
    companyId = 'cie_lahcen_pointeur',
    dateIso,
    domaineFilter = 'ALL',
    ouvriers,
    taches,
    domaines,
    serres,
    pointages,
    affectations,
    recoltes,
    tacheSerresConfigs = [],
    defaultDomaineId = 'dom_d2',
    hoursOverrides = {},
    varietyOverrides = {},
    respectFrozenSnapshot = true,
  } = params;

  // Non-rétroactivité : si la date a déjà été exportée/figée historiquement, retourner le snapshot figé
  if (respectFrozenSnapshot) {
    const frozen = getFrozenSnapshotForDate(companyId, dateIso, domaineFilter);
    if (frozen) {
      const normalizedFilterFrozen =
        domaineFilter && domaineFilter !== 'ALL'
          ? normalizePaiementDomaineShort(
              domaines.find((d) => d.id === domaineFilter)?.nom || domaineFilter,
              domaineFilter
            )
          : 'ALL';

      const filteredFrozenRows = frozen.rows.filter(
        (r) => normalizedFilterFrozen === 'ALL' || r.domaineShort === normalizedFilterFrozen
      );
      const aggregated = aggregatePaiementTotals(filteredFrozenRows);
      return {
        dateIso,
        rows: filteredFrozenRows,
        totalByWorker: aggregated.totalByWorker,
        totalByDomaine: aggregated.totalByDomaine,
        grandTotalDH: aggregated.grandTotalDH,
        totalOuvriersDistincts: aggregated.totalByWorker.length,
        tariffsApplied: frozen.tariffsSnapshot,
        isHistoricalFrozen: true,
        frozenSnapshot: frozen,
        blockedVarietyRowsCount: 0,
        blockedMissingQuantityRowsCount: 0,
        blockedMissingQuantityWorkers: [],
        warnings: [],
      };
    }
  }

  const tariffs = params.tariffs || loadPaiementTariffs(companyId);

  const ouvrierById = new Map<string, Ouvrier>();
  const ouvrierByNum = new Map<number, Ouvrier>();
  ouvriers.forEach((o) => {
    if (o?.id) ouvrierById.set(o.id, o);
    if (o?.numero && Number(o.numero) > 0) ouvrierByNum.set(Number(o.numero), o);
  });

  const tacheById = new Map<string, Tache>(taches.filter(Boolean).map((t) => [t.id, t]));
  const domaineById = new Map<string, Domaine>(domaines.filter(Boolean).map((d) => [d.id, d]));
  const serreById = new Map<string, Serre>(serres.filter(Boolean).map((s) => [s.id, s]));
  const serreByCodeOrName = new Map<string, Serre>();
  serres.forEach((s) => {
    if (!s) return;
    if (s.code) serreByCodeOrName.set(s.code.trim().toUpperCase(), s);
    if (s.nom) serreByCodeOrName.set(s.nom.trim().toUpperCase(), s);
  });

  const taskConfigMap = new Map<string, TacheSerreConfig>();
  tacheSerresConfigs
    .filter((c) => c && c.date === dateIso)
    .forEach((c) => taskConfigMap.set(c.tache_id, c));

  // Uniquement les ouvriers présents dans Pointage Matin (absents strictement exclus ; BROUILLON conservé)
  const presentPointagesByWorker = new Map<string, Pointage>();
  pointages
    .filter((p) => p && p.date === dateIso && p.present !== false)
    .forEach((p) => {
      const key = p.ouvrier_id
        ? `id:${p.ouvrier_id}`
        : p.numero_ouvrier
        ? `num:${p.numero_ouvrier}`
        : `ptg:${p.id}`;
      const prev = presentPointagesByWorker.get(key);
      if (!prev || Number(p.timestamp || 0) >= Number(prev.timestamp || 0)) {
        presentPointagesByWorker.set(key, p);
      }
    });

  const dayAffectations = affectations.filter((a) => a && a.date === dateIso);
  const dayRecoltesAll = recoltes.filter((r) => r && r.date === dateIso);
  const dayRecoltesHarvest = dayRecoltesAll.filter(
    (r) => !r.type_operation || r.type_operation === 'RECOLTE'
  );
  const dayRecoltesTransport = dayRecoltesAll.filter(
    (r) => r.type_operation === 'CHARGEMENT' || r.type_operation === 'DECHARGEMENT'
  );

  interface GroupedWork {
    groupKey: string;
    workerKey: string;
    tacheId: string;
    numeroOuvrier: number;
    nomOuvrier: string;
    domaineId: string;
    domaineShort: string;
    dtCode: string;
    tacheObj: Tache | null;
    tacheTypeId: string;
    tacheNom: string;
    rawStatut: string;
    serreCodesSet: Set<string>;
    serreCodesOrder: string[];
    cultureSet: Set<string>;
    equipeSet: Set<string>;
    recolteNotes: string[];
    recolteVarietes: string[];
    recolteCaisses: number;
    recolteEntriesCount: number;
    transportCaisses: number;
    transportEntriesCount: number;
    explicitCaisses?: number;
    explicitHeureDeb?: string;
    explicitHeureFin?: string;
    explicitDureeRep?: number | '';
    explicitHeures?: number;
    explicitPeriodeJo?: string;
    seenAffSignatures: Set<string>;
  }

  const groupsMap = new Map<string, GroupedWork>();

  const resolveDomaine = (domId?: string | null) => {
    const id = domId || defaultDomaineId;
    const domObj = id ? domaineById.get(id) : undefined;
    const domShort = normalizePaiementDomaineShort(domObj?.nom || domId, id) || 'D2';
    const dtCode = formatPaiementDomaineDT(domObj?.nom || domId, id) || 'D002';
    return {
      domaineId: domObj?.id || id || 'dom_d2',
      domaineShort: domShort,
      dtCode,
    };
  };

  const attachSerreToken = (grp: GroupedWork, tok: ResolvedSerreToken) => {
    const code = formatSingleSerreCode(tok, grp.dtCode);
    if (!code) return;
    const k = code.toUpperCase();
    if (!grp.serreCodesSet.has(k)) {
      grp.serreCodesSet.add(k);
      grp.serreCodesOrder.push(code);
    }
  };

  presentPointagesByWorker.forEach((ptg) => {
    const resolvedOuvrier =
      (ptg.ouvrier_id ? ouvrierById.get(ptg.ouvrier_id) : undefined) ||
      (ptg.numero_ouvrier ? ouvrierByNum.get(Number(ptg.numero_ouvrier)) : undefined);

    const anyResolved = resolvedOuvrier as any;
    const anyPtgMeta = ptg as any;
    const numeroOuvrier =
      extractWorkerNum(resolvedOuvrier?.numero) ||
      extractWorkerNum(ptg.numero_ouvrier) ||
      extractWorkerNum(anyResolved?.matricule) ||
      extractWorkerNum(anyPtgMeta?.matricule);

    const nomOuvrier =
      resolvedOuvrier?.nom?.trim() ||
      anyPtgMeta.nom_ouvrier?.trim() ||
      (numeroOuvrier > 0 ? `Ouvrier #${numeroOuvrier}` : 'Ouvrier');

    const workerKey =
      numeroOuvrier > 0
        ? `num_${numeroOuvrier}`
        : resolvedOuvrier?.id || ptg.ouvrier_id || `ptg_${ptg.id}`;

    const ptgRawStatut = String(anyPtgMeta.statut ?? anyPtgMeta.status ?? '').trim();

    const workerAffs = dayAffectations.filter(
      (a) =>
        (numeroOuvrier > 0 && Number(a.numero_ouvrier) === numeroOuvrier) ||
        (ptg.ouvrier_id && a.ouvrier_id === ptg.ouvrier_id) ||
        (resolvedOuvrier?.id && a.ouvrier_id === resolvedOuvrier.id)
    );

    const matchesWorker = (r: RecolteEntry) =>
      (numeroOuvrier > 0 && Number(r.numero_ouvrier) === numeroOuvrier) ||
      (ptg.ouvrier_id && r.ouvrier_id === ptg.ouvrier_id) ||
      (resolvedOuvrier?.id && r.ouvrier_id === resolvedOuvrier.id);

    const workerHarvestRecoltes = dayRecoltesHarvest.filter(matchesWorker);
    const workerTransportRecoltes = dayRecoltesTransport.filter(matchesWorker);

    interface SourceItem {
      tacheObj: Tache | null;
      domaineId: string;
      serreTokens: ResolvedSerreToken[];
      cultureId: string;
      equipeId: string;
      rawStatut: string;
      caisses?: number;
      heureDeb?: string;
      heureFin?: string;
      dureeRep?: number | '';
      heures?: number;
      periodeJo?: string;
      signature: string;
    }

    const items: SourceItem[] = [];

    if (workerAffs.length > 0) {
      workerAffs.forEach((aff) => {
        const tObj = aff.tache_id ? tacheById.get(aff.tache_id) || null : null;
        const domId = aff.domaine_id || ptg.domaine_id || defaultDomaineId;
        let serresResolved = resolveSerreTokens(
          aff.serre_id,
          aff.serre_nom,
          aff.serres_ids,
          aff.serres_noms,
          serreById,
          serreByCodeOrName
        );
        if (serresResolved.length === 0 && aff.tache_id) {
          const cfg = taskConfigMap.get(aff.tache_id);
          if (cfg && (!cfg.domaine_id || cfg.domaine_id === domId)) {
            serresResolved = resolveSerreTokens(
              null,
              null,
              cfg.serre_ids,
              cfg.serre_noms,
              serreById,
              serreByCodeOrName
            );
          }
        }
        const anyAff = aff as any;
        const affRawStatut = String(anyAff.statut ?? anyAff.status ?? '').trim();
        const rawQty = anyAff.caisses ?? anyAff.quantite ?? anyAff.quantite_caisses;
        items.push({
          tacheObj: tObj,
          domaineId: domId,
          serreTokens: serresResolved,
          cultureId: String(anyAff.culture_id || anyAff.culture || '').trim(),
          equipeId: String(anyAff.equipe_id || '').trim(),
          rawStatut: affRawStatut || ptgRawStatut || 'BROUILLON',
          caisses:
            rawQty !== undefined && rawQty !== '' && Number(rawQty) > 0
              ? Number(rawQty)
              : undefined,
          heureDeb: anyAff.heure_debut || anyAff.heureDeb,
          heureFin: anyAff.heure_fin || anyAff.heureFin,
          dureeRep:
            anyAff.dureeRep !== undefined && anyAff.dureeRep !== ''
              ? Number(anyAff.dureeRep)
              : undefined,
          heures:
            anyAff.heures !== undefined && anyAff.heures !== '' && Number(anyAff.heures) > 0
              ? Number(anyAff.heures)
              : undefined,
          periodeJo: anyAff.periodeJo ? String(anyAff.periodeJo).trim() : undefined,
          signature: aff.id || `${aff.tache_id}_${domId}`,
        });
      });
    } else {
      const tObj = ptg.tache_id ? tacheById.get(ptg.tache_id) || null : null;
      const domId = ptg.domaine_id || defaultDomaineId;
      let serresResolved = resolveSerreTokens(
        ptg.serre_id,
        ptg.serre_nom,
        undefined,
        undefined,
        serreById,
        serreByCodeOrName
      );
      if (serresResolved.length === 0 && ptg.tache_id) {
        const cfg = taskConfigMap.get(ptg.tache_id);
        if (cfg && (!cfg.domaine_id || cfg.domaine_id === domId)) {
          serresResolved = resolveSerreTokens(
            null,
            null,
            cfg.serre_ids,
            cfg.serre_noms,
            serreById,
            serreByCodeOrName
          );
        }
      }
      const anyPtg = ptg as any;
      const rawQty = anyPtg.caisses ?? anyPtg.quantite ?? anyPtg.quantite_caisses;
      items.push({
        tacheObj: tObj,
        domaineId: domId,
        serreTokens: serresResolved,
        cultureId: String(anyPtg.culture_id || anyPtg.culture || '').trim(),
        equipeId: String(anyPtg.equipe_id || '').trim(),
        rawStatut: ptgRawStatut || 'BROUILLON',
        caisses:
          rawQty !== undefined && rawQty !== '' && Number(rawQty) > 0
            ? Number(rawQty)
            : undefined,
        heureDeb: anyPtg.heure_debut || anyPtg.heureDeb,
        heureFin: anyPtg.heure_fin || anyPtg.heureFin,
        dureeRep:
          anyPtg.dureeRep !== undefined && anyPtg.dureeRep !== ''
            ? Number(anyPtg.dureeRep)
            : undefined,
        heures:
          anyPtg.heures !== undefined && anyPtg.heures !== '' && Number(anyPtg.heures) > 0
            ? Number(anyPtg.heures)
            : undefined,
        periodeJo: anyPtg.periodeJo ? String(anyPtg.periodeJo).trim() : undefined,
        signature: ptg.id,
      });
    }

    // Dédoublonnage strict : 1 ligne par (date, ouvrier, domaine, tâche)
    items.forEach((item) => {
      const dom = resolveDomaine(item.domaineId);
      const tacheTypeId = item.tacheObj?.code?.trim() || '';
      const tacheNom = item.tacheObj?.nom?.trim() || 'TRAVAIL NORMAL';
      const tacheId = item.tacheObj?.id || '';
      const tacheKey = tacheId || tacheNom || 'TRAVAIL_NORMAL';
      const groupKey = `${dateIso}__${workerKey}__${dom.dtCode}__${tacheKey}`;

      let grp = groupsMap.get(groupKey);
      if (!grp) {
        grp = {
          groupKey,
          workerKey,
          tacheId,
          numeroOuvrier,
          nomOuvrier,
          domaineId: dom.domaineId,
          domaineShort: dom.domaineShort,
          dtCode: dom.dtCode,
          tacheObj: item.tacheObj,
          tacheTypeId,
          tacheNom,
          rawStatut: item.rawStatut,
          serreCodesSet: new Set<string>(),
          serreCodesOrder: [],
          cultureSet: new Set<string>(),
          equipeSet: new Set<string>(),
          recolteNotes: [],
          recolteVarietes: [],
          recolteCaisses: 0,
          recolteEntriesCount: 0,
          transportCaisses: 0,
          transportEntriesCount: 0,
          explicitCaisses: undefined,
          explicitHeureDeb: item.heureDeb,
          explicitHeureFin: item.heureFin,
          explicitDureeRep: item.dureeRep,
          explicitHeures: item.heures,
          explicitPeriodeJo: item.periodeJo,
          seenAffSignatures: new Set<string>(),
        };
        groupsMap.set(groupKey, grp);
      }

      if (grp.seenAffSignatures.has(item.signature)) {
        return; // Prévention double comptage
      }
      grp.seenAffSignatures.add(item.signature);

      item.serreTokens.forEach((tok) => attachSerreToken(grp!, tok));
      if (item.cultureId) grp.cultureSet.add(item.cultureId);
      if (item.equipeId) grp.equipeSet.add(item.equipeId);
      if (!grp.rawStatut && item.rawStatut) grp.rawStatut = item.rawStatut;
      if (item.caisses !== undefined && item.caisses > 0) {
        grp.explicitCaisses = (grp.explicitCaisses || 0) + item.caisses;
      }
      if (!grp.explicitHeureDeb && item.heureDeb) grp.explicitHeureDeb = item.heureDeb;
      if (!grp.explicitHeureFin && item.heureFin) grp.explicitHeureFin = item.heureFin;
      if (grp.explicitDureeRep === undefined && item.dureeRep !== undefined) grp.explicitDureeRep = item.dureeRep;
      if (grp.explicitHeures === undefined && item.heures !== undefined) grp.explicitHeures = item.heures;
    });

    const workerGroups = Array.from(groupsMap.values()).filter((g) => g.workerKey === workerKey);
    const isTransportGroup = (g: GroupedWork) => {
      const nomL = normalizeText(g.tacheNom);
      const codeL = normalizeText(g.tacheTypeId);
      return (
        nomL.includes('chariot') ||
        (nomL.includes('transfert') && nomL.includes('caisse')) ||
        /^ch0*\d*$/i.test(codeL) ||
        /^tc0*\d*$/i.test(codeL)
      );
    };
    const isRecolteGroup = (g: GroupedWork) => {
      if (isTransportGroup(g)) return false;
      const nomL = normalizeText(g.tacheNom);
      const codeL = normalizeText(g.tacheTypeId);
      return nomL.includes('recolte') || nomL.includes('cueillette') || /^r0*\d+$/i.test(codeL);
    };

    const recolteGroups = workerGroups.filter(isRecolteGroup);
    const transportGroups = workerGroups.filter(isTransportGroup);

    // Attacher les quantités de récolte réelles UNIQUEMENT aux tâches de récolte (ou au groupe transport s'il n'y a aucune tâche de récolte pour cet ouvrier)
    if (workerHarvestRecoltes.length > 0) {
      const seenRecolteIds = new Set<string>();
      if (recolteGroups.length > 0) {
        workerHarvestRecoltes.forEach((rec) => {
          if (rec.id && seenRecolteIds.has(rec.id)) return;
          if (rec.id) seenRecolteIds.add(rec.id);

          const recDomShort = normalizePaiementDomaineShort(null, rec.domaine_id || '');
          const target =
            (recDomShort && recolteGroups.find((g) => g.domaineShort === recDomShort)) ||
            recolteGroups[0];
          target.recolteCaisses += Number(rec.caisses) || 0;
          target.recolteEntriesCount += 1;
          if (rec.notes) target.recolteNotes.push(rec.notes);
          const anyRec = rec as any;
          if (anyRec.variete) target.recolteVarietes.push(String(anyRec.variete));
          if (rec.created_by_nom) target.equipeSet.add(rec.created_by_nom);
          const recTokens = resolveSerreTokens(
            rec.serre_id,
            rec.serre_nom,
            undefined,
            undefined,
            serreById,
            serreByCodeOrName
          );
          recTokens.forEach((tok) => attachSerreToken(target, tok));
        });
      } else if (transportGroups.length > 0 && workerTransportRecoltes.length === 0) {
        workerHarvestRecoltes.forEach((rec) => {
          if (rec.id && seenRecolteIds.has(rec.id)) return;
          if (rec.id) seenRecolteIds.add(rec.id);
          const recDomShort = normalizePaiementDomaineShort(null, rec.domaine_id || '');
          const target =
            (recDomShort && transportGroups.find((g) => g.domaineShort === recDomShort)) ||
            transportGroups[0];
          target.transportCaisses += Number(rec.caisses) || 0;
          target.transportEntriesCount += 1;
          if (rec.notes) target.recolteNotes.push(rec.notes);
          if (rec.created_by_nom) target.equipeSet.add(rec.created_by_nom);
          const recTokens = resolveSerreTokens(
            rec.serre_id,
            rec.serre_nom,
            undefined,
            undefined,
            serreById,
            serreByCodeOrName
          );
          recTokens.forEach((tok) => attachSerreToken(target, tok));
        });
      }
    }

    // Attacher les entrées CHARGEMENT / DECHARGEMENT aux tâches Chariot / Transfert Caisse
    if (workerTransportRecoltes.length > 0 && transportGroups.length > 0) {
      const seenTransIds = new Set<string>();
      workerTransportRecoltes.forEach((rec) => {
        if (rec.id && seenTransIds.has(rec.id)) return;
        if (rec.id) seenTransIds.add(rec.id);
        const recDomShort = normalizePaiementDomaineShort(null, rec.domaine_id || '');
        const target =
          (recDomShort && transportGroups.find((g) => g.domaineShort === recDomShort)) ||
          transportGroups[0];
        target.transportCaisses += Number(rec.caisses) || 0;
        target.transportEntriesCount += 1;
        if (rec.notes) target.recolteNotes.push(rec.notes);
        if (rec.created_by_nom) target.equipeSet.add(rec.created_by_nom);
        const recTokens = resolveSerreTokens(
          rec.serre_id,
          rec.serre_nom,
          undefined,
          undefined,
          serreById,
          serreByCodeOrName
        );
        recTokens.forEach((tok) => attachSerreToken(target, tok));
      });
    }
  });

  const normalizedFilter =
    domaineFilter && domaineFilter !== 'ALL'
      ? normalizePaiementDomaineShort(
          domaines.find((d) => d.id === domaineFilter)?.nom || domaineFilter,
          domaineFilter
        )
      : 'ALL';

  const filteredGroups = Array.from(groupsMap.values())
    .filter((g) => normalizedFilter === 'ALL' || g.domaineShort === normalizedFilter)
    .sort((a, b) => {
      if (a.dtCode !== b.dtCode) return a.dtCode.localeCompare(b.dtCode);
      if (a.numeroOuvrier !== b.numeroOuvrier) return a.numeroOuvrier - b.numeroOuvrier;
      return a.tacheNom.localeCompare(b.tacheNom);
    });

  const warnings: string[] = [];
  const blockedMissingQuantityWorkers: Array<{
    ouvrierId: string;
    nomOuvrier: string;
    tache: string;
    reason: string;
  }> = [];

  const rows: PaiementExcelRow[] = filteredGroups.map((g, idx) => {
    const resolvedRule = resolvePaiementTaskTariff({
      tache: g.tacheObj,
      domaineShort: g.domaineShort,
      recolteNotes: g.recolteNotes.join(' '),
      recolteVarietes: g.recolteVarietes,
      varietyOverride: varietyOverrides[g.groupKey],
      tariffs,
    });

    const isRecolteTask =
      resolvedRule.category === 'RECOLTE_CERISE' ||
      resolvedRule.category === 'RECOLTE_RONDE' ||
      resolvedRule.category === 'RECOLTE_AMBIGUE' ||
      (resolvedRule.category === 'CUSTOM' &&
        (resolvedRule.mode === 'RECOLTE_COEFF' || resolvedRule.mode === 'RECOLTE_UNITE') &&
        (normalizeText(g.tacheNom).includes('recolte') ||
          normalizeText(g.tacheNom).includes('cueillette') ||
          /^r0*\d+$/i.test(normalizeText(g.tacheTypeId))));

    const ovr = hoursOverrides[g.groupKey];
    let heureDeb: string;
    let heureFin: string;
    let dureeRep: number;
    let dureeTravaillee: number;

    if (isRecolteTask) {
      // Horaires fixes 07:00–14:00 (pause 0h, 7h) pour toute tâche de Récolte, sans jamais être écrasés par 16:00 par défaut
      heureDeb = (ovr?.heureDeb ?? '07:00').trim() || '07:00';
      heureFin = (ovr?.heureFin ?? '14:00').trim() || '14:00';
      dureeRep = resolvePauseHours(heureDeb, heureFin, ovr?.dureeRep);
      dureeTravaillee =
        ovr?.heures !== undefined && Number(ovr.heures) >= 0
          ? roundPaiementAmount(Number(ovr.heures))
          : computeEffectiveWorkedHours(heureDeb, heureFin, dureeRep);
    } else {
      heureDeb = (ovr?.heureDeb ?? g.explicitHeureDeb ?? '07:00').trim() || '07:00';
      heureFin = (ovr?.heureFin ?? g.explicitHeureFin ?? '16:00').trim() || '16:00';
      dureeRep = resolvePauseHours(
        heureDeb,
        heureFin,
        ovr?.dureeRep !== undefined ? ovr.dureeRep : g.explicitDureeRep
      );
      dureeTravaillee = computeEffectiveWorkedHours(heureDeb, heureFin, dureeRep);
      if (ovr?.heures !== undefined && Number(ovr.heures) >= 0) {
        dureeTravaillee = roundPaiementAmount(Number(ovr.heures));
      } else if (
        !ovr?.heureDeb &&
        !ovr?.heureFin &&
        !g.explicitHeureDeb &&
        !g.explicitHeureFin &&
        g.explicitHeures !== undefined &&
        g.explicitHeures >= 0
      ) {
        dureeTravaillee = roundPaiementAmount(g.explicitHeures);
      }
    }

    const isCrateBasedMode =
      resolvedRule.mode === 'RECOLTE_COEFF' ||
      resolvedRule.mode === 'RECOLTE_UNITE' ||
      resolvedRule.mode === 'CAISSE_SEUIL';

    const sourceCaisses =
      resolvedRule.mode === 'CAISSE_SEUIL' ||
      resolvedRule.category === 'CHARIOT' ||
      resolvedRule.category === 'TRANSFERT_CAISSE'
        ? g.transportCaisses > 0
          ? g.transportCaisses
          : g.explicitCaisses || 0
        : g.recolteCaisses > 0
        ? g.recolteCaisses
        : g.explicitCaisses || 0;

    const effectiveCaisses = isCrateBasedMode
      ? ovr?.caisses !== undefined && Number.isFinite(Number(ovr.caisses))
        ? Math.max(0, Number(ovr.caisses))
        : Math.max(0, sourceCaisses)
      : 0;

    // Pour tout travail payé au temps (heure/jour), quantiteMetrique reste strictement vide
    const quantiteMetrique: number | '' =
      isCrateBasedMode && effectiveCaisses > 0 ? roundPaiementAmount(effectiveCaisses) : '';

    const ouvrierId = formatPaiementOuvrierId(g.numeroOuvrier, g.domaineShort) || String(g.numeroOuvrier || '');

    let missingQuantityBlocked = false;
    let missingQuantityReason: string | undefined;

    if (resolvedRule.needsVarietySelection && resolvedRule.varietyBlockedReason) {
      warnings.push(`${g.nomOuvrier} : ${resolvedRule.varietyBlockedReason}`);
    }
    if (isRecolteTask && effectiveCaisses <= 0) {
      missingQuantityBlocked = true;
      missingQuantityReason = `Aucune caisse saisie pour "${g.nomOuvrier}" (${g.tacheNom}) le ${dateIso}. Saisie individuelle obligatoire (> 0).`;
      warnings.push(missingQuantityReason);
      blockedMissingQuantityWorkers.push({
        ouvrierId,
        nomOuvrier: g.nomOuvrier,
        tache: g.tacheNom,
        reason: missingQuantityReason,
      });
    } else if (resolvedRule.mode === 'CAISSE_SEUIL' && effectiveCaisses <= 0) {
      warnings.push(
        `${g.nomOuvrier} (${g.tacheNom}) : nombre de caisses manquant (0). Aucun repli vers 95 DH normal.`
      );
    }

    let remuneration = 0;
    let tarifExcep: number | '' = resolvedRule.tarifValue;
    let tarifAppliqueLabel = resolvedRule.tarifAppliqueLabel;

    if (resolvedRule.needsVarietySelection || missingQuantityBlocked) {
      remuneration = 0;
      if (resolvedRule.needsVarietySelection) {
        tarifExcep = '';
      }
    } else {
      switch (resolvedRule.mode) {
        case 'RECOLTE_COEFF': {
          const qty = typeof quantiteMetrique === 'number' ? quantiteMetrique : 0;
          remuneration = roundPaiementAmount(qty * resolvedRule.tarifValue);
          break;
        }
        case 'RECOLTE_UNITE': {
          const qty = typeof quantiteMetrique === 'number' ? quantiteMetrique : 0;
          remuneration = roundPaiementAmount(qty * resolvedRule.tarifValue);
          break;
        }
        case 'CAISSE_SEUIL': {
          const qty = typeof quantiteMetrique === 'number' ? quantiteMetrique : 0;
          const refQty =
            resolvedRule.quantiteRef && resolvedRule.quantiteRef > 0
              ? resolvedRule.quantiteRef
              : 400;
          const refTarif = resolvedRule.tarifValue;
          if (qty <= 0) {
            remuneration = 0;
            tarifExcep = refTarif;
          } else if (qty <= refQty) {
            remuneration = roundPaiementAmount(refTarif);
            tarifExcep = refTarif;
          } else {
            remuneration = roundPaiementAmount((qty * refTarif) / refQty);
            tarifExcep = roundPaiementAmount(refTarif / refQty);
          }
          break;
        }
        case 'HEURE': {
          remuneration = roundPaiementAmount(dureeTravaillee * resolvedRule.tarifValue);
          break;
        }
        case 'FORFAIT_JOUR': {
          // Forfait journalier (Stationnaire 100 DH, Gardien 100 DH, Ébourgeonnage D5 150 DH) — jamais cumulé avec 95 DH
          remuneration = roundPaiementAmount(resolvedRule.tarifValue);
          break;
        }
        case 'NORMAL_JOUR': {
          // 8h standard = forfait plein (95 DH), heures incomplètes = prorata (tarifJour / 8) * dureeTravaillee
          if (Math.abs(dureeTravaillee - 8) < 0.0001) {
            remuneration = roundPaiementAmount(resolvedRule.tarifValue);
            tarifExcep = resolvedRule.tarifValue;
            tarifAppliqueLabel = `${resolvedRule.tarifValue} DH / jour`;
          } else {
            const hourlyRate = roundPaiementAmount(resolvedRule.tarifValue / 8);
            remuneration = roundPaiementAmount(hourlyRate * dureeTravaillee);
            tarifExcep = hourlyRate;
            tarifAppliqueLabel = `${hourlyRate} DH / h (${resolvedRule.tarifValue} DH/j)`;
          }
          break;
        }
      }
    }

    const hasMissingSerre = g.serreCodesOrder.length === 0;
    const serreId =
      g.serreCodesOrder.length > 1
        ? PAIEMENT_ALL_SERRES_LABEL
        : g.serreCodesOrder.length === 1
        ? g.serreCodesOrder[0]
        : '';
    if (hasMissingSerre) {
      warnings.push(
        `${g.nomOuvrier} (${g.tacheNom}) : aucune serre renseignée pour le ${dateIso}.`
      );
    }

    const docId = `${g.dtCode}_${dateIso}_${ouvrierId || 'NA'}_${idx + 1}`;

    return {
      rowKey: g.groupKey,
      workerKey: g.workerKey,
      docId,
      dateTrava: dateIso,
      ouvrierId,
      numeroOuvrier: g.numeroOuvrier,
      nomOuvrier: g.nomOuvrier,
      DT: g.dtCode,
      domaineId: g.domaineId,
      domaineShort: g.domaineShort,
      serreId,
      hasMissingSerre,
      rubanId: PAIEMENT_RUBAN_LABEL,
      cultureId: Array.from(g.cultureSet).join('+'),
      tacheTypeId: g.tacheTypeId,
      tacheId: g.tacheId,
      tache: g.tacheNom,
      category: resolvedRule.category,
      mode: resolvedRule.mode,
      uniteMetrique: resolvedRule.uniteMetrique,
      quantiteMetrique,
      quantite: '', // Toujours vide
      heureDeb,
      heureFin,
      dureeRep,
      dureeTravaillee,
      periodeJo: g.explicitPeriodeJo || 'JOURNEE',
      statut: g.rawStatut || 'BROUILLON',
      equipeId: Array.from(g.equipeSet).join(', '),
      tarifExcep,
      tarifAppliqueLabel,
      coefficient: resolvedRule.coefficient,
      remuneration,
      needsVarietySelection: Boolean(resolvedRule.needsVarietySelection),
      varietyBlockedReason: resolvedRule.varietyBlockedReason,
      missingQuantityBlocked,
      missingQuantityReason,
      notes: g.recolteNotes,
    };
  });

  const aggregated = aggregatePaiementTotals(rows);
  const blockedVarietyRowsCount = rows.filter((r) => r.needsVarietySelection).length;
  const blockedMissingQuantityRowsCount = rows.filter((r) => r.missingQuantityBlocked).length;

  return {
    dateIso,
    rows,
    totalByWorker: aggregated.totalByWorker,
    totalByDomaine: aggregated.totalByDomaine,
    grandTotalDH: aggregated.grandTotalDH,
    totalOuvriersDistincts: aggregated.totalByWorker.length,
    tariffsApplied: tariffs,
    isHistoricalFrozen: false,
    frozenSnapshot: null,
    blockedVarietyRowsCount,
    blockedMissingQuantityRowsCount,
    blockedMissingQuantityWorkers,
    warnings,
  };
}

export function aggregatePaiementTotals(rows: PaiementExcelRow[]): {
  totalByWorker: PaiementWorkerTotal[];
  totalByDomaine: PaiementDomaineTotal[];
  grandTotalDH: number;
} {
  const workerMap = new Map<string, PaiementWorkerTotal>();
  rows.forEach((r) => {
    const prev = workerMap.get(r.workerKey) || {
      workerKey: r.workerKey,
      ouvrierId: r.ouvrierId,
      numeroOuvrier: r.numeroOuvrier,
      nomOuvrier: r.nomOuvrier,
      domaineDT: r.DT,
      taches: [],
      tarifsAppliques: [],
      coefficients: [],
      totalHeures: 0,
      totalRecolte: 0,
      rowsCount: 0,
      totalDH: 0,
    };
    if (r.tache && !prev.taches.includes(r.tache)) prev.taches.push(r.tache);
    if (r.tarifAppliqueLabel && !prev.tarifsAppliques.includes(r.tarifAppliqueLabel)) {
      prev.tarifsAppliques.push(r.tarifAppliqueLabel);
    }
    if (r.coefficient !== '' && !prev.coefficients.includes(String(r.coefficient))) {
      prev.coefficients.push(String(r.coefficient));
    }
    prev.totalHeures = roundPaiementAmount(prev.totalHeures + (Number(r.dureeTravaillee) || 0));
    if (typeof r.quantiteMetrique === 'number') {
      prev.totalRecolte = roundPaiementAmount(prev.totalRecolte + r.quantiteMetrique);
    }
    prev.rowsCount += 1;
    prev.totalDH = roundPaiementAmount(prev.totalDH + r.remuneration);
    workerMap.set(r.workerKey, prev);
  });

  const totalByWorker = Array.from(workerMap.values()).sort(
    (a, b) => a.numeroOuvrier - b.numeroOuvrier
  );

  const domMap = new Map<
    string,
    {
      DT: string;
      domaineShort: string;
      domaineId: string;
      workers: Set<string>;
      rowsCount: number;
      totalDH: number;
    }
  >();

  rows.forEach((r) => {
    const prev = domMap.get(r.DT) || {
      DT: r.DT,
      domaineShort: r.domaineShort,
      domaineId: r.domaineId,
      workers: new Set<string>(),
      rowsCount: 0,
      totalDH: 0,
    };
    prev.workers.add(r.workerKey);
    prev.rowsCount += 1;
    prev.totalDH = roundPaiementAmount(prev.totalDH + r.remuneration);
    domMap.set(r.DT, prev);
  });

  const totalByDomaine: PaiementDomaineTotal[] = Array.from(domMap.values())
    .map((d) => ({
      DT: d.DT,
      domaineShort: d.domaineShort,
      domaineId: d.domaineId,
      ouvriersCount: d.workers.size,
      rowsCount: d.rowsCount,
      totalDH: d.totalDH,
    }))
    .sort((a, b) => a.DT.localeCompare(b.DT));

  const grandTotalDH = roundPaiementAmount(
    rows.reduce((sum, r) => sum + (Number(r.remuneration) || 0), 0)
  );

  return { totalByWorker, totalByDomaine, grandTotalDH };
}

// ------------------------- GÉNÉRATION EXCEL (.xlsx) FIDÈLE AU MODÈLE -------------------------

export function getExportPaiementFilename(
  dateIso: string,
  domaineFilter: string,
  domaines: Domaine[]
): string {
  const domObj = domaines.find((d) => d.id === domaineFilter);
  const dt =
    !domaineFilter || domaineFilter === 'ALL'
      ? 'TOUS_DOMAINES'
      : formatPaiementDomaineDT(domObj?.nom || domaineFilter, domaineFilter) || 'DOMAINE';
  return `EXPORT_PAIEMENT_${dt}_${dateIso}.xlsx`;
}

function cloneStyleSafe<T>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj;
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return obj;
  }
}

function paiementRowToExcel21Values(r: PaiementExcelRow): (string | number)[] {
  return [
    r.docId,
    r.dateTrava,
    r.ouvrierId,
    r.nomOuvrier,
    r.DT,
    r.serreId,
    r.rubanId,
    r.cultureId || '',
    r.tacheTypeId || '',
    r.tache,
    r.uniteMetrique || '',
    r.quantiteMetrique === '' ? '' : r.quantiteMetrique,
    '', // Colonne 13 (quantite) STRICTEMENT vide
    r.heureDeb,
    r.heureFin,
    r.dureeRep === '' ? '' : r.dureeRep,
    r.periodeJo,
    r.statut, // Conservé exactement tel quel (BROUILLON / VALIDÉE / autre)
    r.equipeId || '',
    r.tarifExcep === '' ? '' : r.tarifExcep,
    r.remuneration,
  ];
}

/**
 * Construit le classeur Excel (.xlsx) EXCLUSIVEMENT depuis le fichier modèle original :
 * - Si `templateBuffer` est absent ou invalide : BLOQUE immédiatement sans inventer de fichier de remplacement.
 * - Préserve exactement la feuille "Pointage" à 21 colonnes, ses styles, couleurs, polices, bordures, largeurs,
 *   hauteurs de ligne et mise en page d'origine.
 * - Ajoute en option la feuille complémentaire "Totaux par Ouvrier" (avec totaux par ouvrier, domaine et total général)
 *   sans altérer la structure de la feuille principale "Pointage".
 */
export async function buildPaiementWorkbookFromTemplate(params: {
  dateIso: string;
  rows: PaiementExcelRow[];
  totalByWorker: PaiementWorkerTotal[];
  totalByDomaine?: PaiementDomaineTotal[];
  grandTotalDH: number;
  templateBuffer?: ArrayBuffer | Uint8Array | null;
  includeTotauxSheet?: boolean;
}): Promise<{ workbook: ExcelJS.Workbook; usedTemplateFile: boolean }> {
  const {
    dateIso,
    rows,
    totalByWorker,
    totalByDomaine,
    grandTotalDH,
    templateBuffer,
    includeTotauxSheet = true,
  } = params;

  if (!templateBuffer || templateBuffer.byteLength === 0) {
    throw new Error(
      `TEMPLATE_MISSING: Le modèle Excel original "${PAIEMENT_TEMPLATE_FILENAME}" est requis pour générer le fichier de paiement. Veuillez l'importer avant de continuer.`
    );
  }

  const tplCheck = await validateAdminExcelTemplate(templateBuffer);
  if (!tplCheck.valid) {
    throw new Error(`TEMPLATE_INVALID: ${tplCheck.error}`);
  }

  const workbook = new ExcelJS.Workbook();
  const rawArr =
    templateBuffer instanceof Uint8Array
      ? new Uint8Array(templateBuffer)
      : new Uint8Array(templateBuffer);
  const copiedAb = new ArrayBuffer(rawArr.byteLength);
  new Uint8Array(copiedAb).set(rawArr);
  await workbook.xlsx.load(copiedAb);

  const wsPointage = workbook.getWorksheet(PAIEMENT_SHEET_POINTAGE)!;
  const hadAutoFilter = Boolean(wsPointage.autoFilter);

  // Mémoriser les styles/hauteur de la ligne modèle (ligne 2) avant nettoyage des lignes d'exemple
  const sampleRow = wsPointage.rowCount >= 2 ? wsPointage.getRow(2) : null;
  const sampleRowHeight = sampleRow?.height;
  const colTemplateStyles: Partial<ExcelJS.Style>[] = [];
  for (let c = 1; c <= PAIEMENT_POINTAGE_COLUMNS.length; c++) {
    const cell = sampleRow ? sampleRow.getCell(c) : null;
    colTemplateStyles.push(cell?.style ? cloneStyleSafe(cell.style) : {});
  }

  // Supprimer les lignes d'exemple (>= 2) sans modifier en-tête, largeurs, polices, couleurs, mise en page ni propriétés
  if (wsPointage.rowCount > 1) {
    wsPointage.spliceRows(2, wsPointage.rowCount - 1);
  }

  rows.forEach((r, idx) => {
    const targetRow = wsPointage.getRow(idx + 2);
    if (sampleRowHeight !== undefined) {
      targetRow.height = sampleRowHeight;
    }
    const values = paiementRowToExcel21Values(r);
    values.forEach((val, colIdx) => {
      const cell = targetRow.getCell(colIdx + 1);
      if (colTemplateStyles[colIdx] && Object.keys(colTemplateStyles[colIdx]).length > 0) {
        cell.style = cloneStyleSafe(colTemplateStyles[colIdx]);
      }
      cell.value = val === '' ? null : val;
    });
    targetRow.commit();
  });

  if (hadAutoFilter) {
    wsPointage.autoFilter = `A1:U${Math.max(rows.length + 1, 1)}`;
  }

  // Feuille complémentaire : "Totaux par Ouvrier" sans toucher à la structure 21 colonnes de "Pointage"
  if (includeTotauxSheet) {
    const wsTotaux = workbook.addWorksheet(PAIEMENT_SHEET_TOTAUX);
    const totHeader = wsTotaux.addRow([
      'Date',
      'Identifiant ouvrier',
      'Nom ouvrier',
      'Domaine',
      'Tâche(s)',
      'Tarif(s) appliqué(s)',
      'Coefficient',
      'Durée travaillée (h)',
      'Quantité récolte',
      'Total Ouvrier (DH)',
    ]);
    totHeader.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    totHeader.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0F172A' },
    };
    totHeader.alignment = { vertical: 'middle', horizontal: 'center' };
    totHeader.height = 24;

    totalByWorker.forEach((w) => {
      const row = wsTotaux.addRow([
        dateIso,
        w.ouvrierId,
        w.nomOuvrier,
        w.domaineDT,
        w.taches.join(' + '),
        w.tarifsAppliques.join(' | '),
        w.coefficients.length > 0 ? w.coefficients.join(', ') : null,
        w.totalHeures,
        w.totalRecolte > 0 ? w.totalRecolte : null,
        w.totalDH,
      ]);
      row.getCell(8).numFmt = '0.##';
      row.getCell(10).numFmt = '#,##0.00## "DH"';
      row.getCell(10).font = { bold: true };
    });

    wsTotaux.addRow([]);
    const grandRow = wsTotaux.addRow([
      dateIso,
      `${totalByWorker.length} ouvrier(s)`,
      'TOTAL GÉNÉRAL',
      '',
      '',
      '',
      '',
      roundPaiementAmount(totalByWorker.reduce((s, w) => s + w.totalHeures, 0)),
      roundPaiementAmount(totalByWorker.reduce((s, w) => s + w.totalRecolte, 0)),
      grandTotalDH,
    ]);
    grandRow.font = { bold: true, size: 12, color: { argb: 'FF064E3B' } };
    grandRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD1FAE5' },
    };
    grandRow.getCell(10).numFmt = '#,##0.00## "DH"';

    const domainesList = totalByDomaine || aggregatePaiementTotals(rows).totalByDomaine;
    if (domainesList.length > 0) {
      wsTotaux.addRow([]);
      const domHeader = wsTotaux.addRow([
        'Domaine (DT)',
        'Ouvriers distincts',
        'Lignes pointées',
        'Total Domaine (DH)',
      ]);
      domHeader.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      domHeader.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF065F46' },
      };
      domainesList.forEach((d) => {
        const dRow = wsTotaux.addRow([d.DT, d.ouvriersCount, d.rowsCount, d.totalDH]);
        dRow.getCell(4).numFmt = '#,##0.00## "DH"';
        dRow.getCell(4).font = { bold: true };
      });
    }

    wsTotaux.columns = [
      { width: 13 },
      { width: 18 },
      { width: 25 },
      { width: 11 },
      { width: 26 },
      { width: 28 },
      { width: 13 },
      { width: 20 },
      { width: 17 },
      { width: 20 },
    ];
  }

  return { workbook, usedTemplateFile: true };
}

function triggerExcelDownload(buffer: Uint8Array, filename: string): void {
  if (typeof document !== 'undefined' && typeof URL !== 'undefined') {
    const blob = new Blob([buffer as BlobPart], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1500);
  }
}

export async function exportPaiementExcel(params: {
  companyId: string;
  preview: PaiementPreviewResult;
  domaineFilter: string;
  domaines: Domaine[];
  currentUser?: Pick<UserAccount, 'id' | 'role' | 'module_attribue' | 'username' | 'nom' | 'actif'> | null;
  templateBuffer?: ArrayBuffer | Uint8Array | null;
  includeTotauxSheet?: boolean;
  skipBrowserDownload?: boolean;
  persistSnapshot?: boolean;
}): Promise<{
  success: boolean;
  filename: string;
  totalLignes: number;
  grandTotalDH: number;
  usedTemplateFile: boolean;
  needsTemplateImport?: boolean;
  workbook?: ExcelJS.Workbook;
  buffer?: Uint8Array;
  snapshot?: PaiementExportSnapshot;
  error?: string;
}> {
  if (!isAdminPaiementAuthorized(params.currentUser)) {
    return {
      success: false,
      filename: '',
      totalLignes: 0,
      grandTotalDH: 0,
      usedTemplateFile: false,
      error: 'Accès refusé : EXPORT PAIEMENT EXCEL est strictement réservé à l’administrateur.',
    };
  }

  const {
    companyId,
    preview,
    domaineFilter,
    domaines,
    templateBuffer = null,
    includeTotauxSheet = true,
    skipBrowserDownload = false,
    persistSnapshot = true,
  } = params;

  if (!templateBuffer || templateBuffer.byteLength === 0) {
    return {
      success: false,
      filename: '',
      totalLignes: 0,
      grandTotalDH: 0,
      usedTemplateFile: false,
      needsTemplateImport: true,
      error: `Génération bloquée : le modèle Excel original "${PAIEMENT_TEMPLATE_FILENAME}" est manquant. Veuillez l'importer pour générer le paiement.`,
    };
  }

  if (!preview.rows || preview.rows.length === 0) {
    return {
      success: false,
      filename: '',
      totalLignes: 0,
      grandTotalDH: 0,
      usedTemplateFile: false,
      error: 'Aucun ouvrier présent dans Pointage Matin pour cette date et ce domaine.',
    };
  }

  const blockedRows = preview.rows.filter((r) => r.needsVarietySelection);
  if (blockedRows.length > 0) {
    return {
      success: false,
      filename: '',
      totalLignes: 0,
      grandTotalDH: 0,
      usedTemplateFile: false,
      error: `Export bloqué : ${blockedRows.length} ligne(s) de récolte générique nécessitent une sélection explicite de variété (Cerise 3,8 DH ou Ronde 1,1875 DH).`,
    };
  }

  const missingQtyRows = preview.rows.filter((r) => r.missingQuantityBlocked);
  if (missingQtyRows.length > 0) {
    const workersList = missingQtyRows.map((r) => `${r.nomOuvrier} (${r.tache})`).join(', ');
    return {
      success: false,
      filename: '',
      totalLignes: 0,
      grandTotalDH: 0,
      usedTemplateFile: false,
      error: `Export bloqué : saisie individuelle des caisses de récolte obligatoire (> 0) pour : ${workersList}.`,
    };
  }

  try {
    const filename = getExportPaiementFilename(preview.dateIso, domaineFilter, domaines);
    const { workbook, usedTemplateFile } = await buildPaiementWorkbookFromTemplate({
      dateIso: preview.dateIso,
      rows: preview.rows,
      totalByWorker: preview.totalByWorker,
      totalByDomaine: preview.totalByDomaine,
      grandTotalDH: preview.grandTotalDH,
      templateBuffer,
      includeTotauxSheet,
    });
    const rawOut = await workbook.xlsx.writeBuffer();
    const buffer = rawOut instanceof Uint8Array ? rawOut : new Uint8Array(rawOut);

    let savedSnapshot: PaiementExportSnapshot | undefined;
    if (persistSnapshot && !preview.isHistoricalFrozen) {
      const snapRes = savePaiementExportSnapshot(params.currentUser, {
        companyId,
        dateIso: preview.dateIso,
        domaineFilter: domaineFilter || 'ALL',
        filename,
        tariffsSnapshot: preview.tariffsApplied,
        rows: preview.rows,
        totalByWorker: preview.totalByWorker,
        grandTotalDH: preview.grandTotalDH,
        totalOuvriersDistincts: preview.totalOuvriersDistincts,
      });
      savedSnapshot = snapRes.snapshot;
    }

    if (!skipBrowserDownload) {
      triggerExcelDownload(buffer, filename);
    }

    return {
      success: true,
      filename,
      totalLignes: preview.rows.length,
      grandTotalDH: preview.grandTotalDH,
      usedTemplateFile,
      workbook,
      buffer,
      snapshot: savedSnapshot || preview.frozenSnapshot || undefined,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur lors de la génération Excel.';
    return {
      success: false,
      filename: '',
      totalLignes: 0,
      grandTotalDH: 0,
      usedTemplateFile: false,
      needsTemplateImport: msg.startsWith('TEMPLATE_MISSING') || msg.startsWith('TEMPLATE_INVALID'),
      error: msg,
    };
  }
}

/**
 * Re-télécharge à l'identique un snapshot historique figé SANS jamais recalculer avec les tarifs actuels.
 */
export async function reexportPaiementSnapshotExcel(params: {
  snapshot: PaiementExportSnapshot;
  currentUser?: Pick<UserAccount, 'id' | 'role' | 'module_attribue' | 'username' | 'nom' | 'actif'> | null;
  templateBuffer?: ArrayBuffer | Uint8Array | null;
  includeTotauxSheet?: boolean;
  skipBrowserDownload?: boolean;
}): Promise<{
  success: boolean;
  filename: string;
  totalLignes: number;
  grandTotalDH: number;
  usedTemplateFile: boolean;
  needsTemplateImport?: boolean;
  workbook?: ExcelJS.Workbook;
  buffer?: Uint8Array;
  error?: string;
}> {
  if (!isAdminPaiementAuthorized(params.currentUser)) {
    return {
      success: false,
      filename: '',
      totalLignes: 0,
      grandTotalDH: 0,
      usedTemplateFile: false,
      error: 'Accès refusé : le téléchargement de l’historique de paiement est réservé à l’administrateur.',
    };
  }

  const {
    snapshot,
    templateBuffer = null,
    includeTotauxSheet = true,
    skipBrowserDownload = false,
  } = params;

  if (!templateBuffer || templateBuffer.byteLength === 0) {
    return {
      success: false,
      filename: '',
      totalLignes: 0,
      grandTotalDH: 0,
      usedTemplateFile: false,
      needsTemplateImport: true,
      error: `Téléchargement bloqué : le modèle Excel original "${PAIEMENT_TEMPLATE_FILENAME}" est requis pour reconstruire le fichier figé.`,
    };
  }

  try {
    const { workbook, usedTemplateFile } = await buildPaiementWorkbookFromTemplate({
      dateIso: snapshot.dateIso,
      rows: snapshot.rows,
      totalByWorker: snapshot.totalByWorker,
      grandTotalDH: snapshot.grandTotalDH,
      templateBuffer,
      includeTotauxSheet,
    });
    const rawOut = await workbook.xlsx.writeBuffer();
    const buffer = rawOut instanceof Uint8Array ? rawOut : new Uint8Array(rawOut);

    if (!skipBrowserDownload) {
      triggerExcelDownload(buffer, snapshot.filename);
    }

    return {
      success: true,
      filename: snapshot.filename,
      totalLignes: snapshot.rows.length,
      grandTotalDH: snapshot.grandTotalDH,
      usedTemplateFile,
      workbook,
      buffer,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur lors du re-téléchargement du snapshot.';
    return {
      success: false,
      filename: '',
      totalLignes: 0,
      grandTotalDH: 0,
      usedTemplateFile: false,
      needsTemplateImport: msg.startsWith('TEMPLATE_MISSING') || msg.startsWith('TEMPLATE_INVALID'),
      error: msg,
    };
  }
}
