/**
 * Module de calcul financier automatique pour le POINTAGE MATIN D1–D5 (Lahcen Pointeur)
 *
 * Barème officiel des tâches :
 * - Toutes les tâches standard / Instable : 95 DH par ouvrier
 * - STATIONNAIRE : 100 DH par ouvrier
 * - ÉBOURGEONNAGE D5 : 150 DH par ouvrier
 * - TRAITEMENT PHYTO : 105 DH par ouvrier
 * - Toutes les autres tâches non spécifiées utilisent 95 DH
 *
 * Règles strictes :
 * 1. Seuls les ouvriers PRÉSENTS sont comptabilisés. Les absents et non-pointés sont exclus (0 DH).
 * 2. Un ouvrier affecté à plusieurs tâches n'est pas comptabilisé deux fois dans la même journée (aucun double comptage).
 * 3. Afficher uniquement les tâches réellement pointées (quantité > 0).
 */

import { Pointage, AffectationTache, Tache, Domaine } from '../types/index';

export type CategorieFinanciereKey =
  | 'INSTABLE'
  | 'STATIONNAIRE'
  | 'EBOURGEONNAGE_D5'
  | 'TRAITEMENT_PHYTO';

export interface LigneFinancierePointage {
  key: CategorieFinanciereKey;
  nomAffiche: string;
  tarifUnitaire: number;
  nombreOuvriers: number;
  montantTotal: number;
  ouvrierNumeros: number[];
  detailsTaches?: string[];
}

export interface CalculFinancierPointageResult {
  lignes: LigneFinancierePointage[];
  categoriesPresentes: LigneFinancierePointage[]; // Uniquement celles ayant nombreOuvriers > 0
  totalGeneralDH: number;
  totalOuvriersComptabilises: number;
  texteRecapWhatsApp: string; // Bloc prêt pour le récapitulatif WhatsApp
}

/**
 * Normalise une chaîne de texte (casse et accents insensibles)
 */
export function normalizeTaskText(str?: string | null): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Détermine la catégorie financière d'une tâche selon le barème officiel
 */
export function classifyTacheFinanciere(
  tache?: { nom?: string; code?: string } | null,
  domaine?: { nom?: string; id?: string } | null
): {
  key: CategorieFinanciereKey;
  nomAffiche: string;
  tarifUnitaire: number;
} {
  const nomClean = normalizeTaskText(tache?.nom);
  const codeClean = normalizeTaskText(tache?.code);
  const domNomClean = normalizeTaskText(domaine?.nom);
  const isDomD5 = domNomClean === 'd5' || domNomClean.includes('d5') || domaine?.id === 'dom_d5';

  const fullText = `${nomClean} ${codeClean}`.trim();

  // 1. STATIONNAIRE (100 DH)
  if (fullText.includes('stationnaire') || fullText.includes('station')) {
    return {
      key: 'STATIONNAIRE',
      nomAffiche: 'STATIONNAIRE',
      tarifUnitaire: 100,
    };
  }

  // 2. ÉBOURGEONNAGE D5 (150 DH)
  // S'applique si la tâche mentionne "ebourgeonnage" / "bourgeon" avec D5 ou effectuée dans le domaine D5
  if (
    (fullText.includes('ebourgeonnage') || fullText.includes('bourgeon')) &&
    (fullText.includes('d5') || isDomD5)
  ) {
    return {
      key: 'EBOURGEONNAGE_D5',
      nomAffiche: 'ÉBOURGEONNAGE D5',
      tarifUnitaire: 150,
    };
  }

  // 3. TRAITEMENT PHYTO (105 DH)
  // S'applique si "phyto", "traitement", "phytosanitaire"
  if (fullText.includes('phyto') || fullText.includes('traitement')) {
    return {
      key: 'TRAITEMENT_PHYTO',
      nomAffiche: 'TRAITEMENT PHYTO',
      tarifUnitaire: 105,
    };
  }

  // 4. Par défaut : Toutes les tâches standard / Instable (95 DH)
  // (ex: RECOLTE, EFFEUILLAGE, ENTRETIEN, PLANTATION, INSTABLE, ou sans tâche)
  return {
    key: 'INSTABLE',
    nomAffiche: 'INSTABLE',
    tarifUnitaire: 95,
  };
}

/**
 * Calcule le récapitulatif financier complet du pointage matin pour une date donnée
 */
export function calculerPointageFinancierMatin(params: {
  pointages: Pointage[];
  affectations?: AffectationTache[];
  taches?: Tache[];
  domaines?: Domaine[];
  defaultDomaineId?: string;
}): CalculFinancierPointageResult {
  const {
    pointages,
    affectations = [],
    taches = [],
    domaines = [],
    defaultDomaineId = 'dom_d2',
  } = params;

  // Filtrer STRICTEMENT les ouvriers présents (pointages avec present !== false)
  const presentsPointages = pointages.filter((p) => p.present !== false);

  const tachesMap = new Map<string, Tache>(taches.map((t) => [t.id, t]));
  const domainesMap = new Map<string, Domaine>(domaines.map((d) => [d.id, d]));

  // Structure des 4 catégories officielles
  const categories: Record<
    CategorieFinanciereKey,
    {
      nomAffiche: string;
      tarifUnitaire: number;
      ouvriers: Set<number>;
      tachesNoms: Set<string>;
    }
  > = {
    INSTABLE: {
      nomAffiche: 'INSTABLE',
      tarifUnitaire: 95,
      ouvriers: new Set<number>(),
      tachesNoms: new Set<string>(),
    },
    STATIONNAIRE: {
      nomAffiche: 'STATIONNAIRE',
      tarifUnitaire: 100,
      ouvriers: new Set<number>(),
      tachesNoms: new Set<string>(),
    },
    EBOURGEONNAGE_D5: {
      nomAffiche: 'ÉBOURGEONNAGE D5',
      tarifUnitaire: 150,
      ouvriers: new Set<number>(),
      tachesNoms: new Set<string>(),
    },
    TRAITEMENT_PHYTO: {
      nomAffiche: 'TRAITEMENT PHYTO',
      tarifUnitaire: 105,
      ouvriers: new Set<number>(),
      tachesNoms: new Set<string>(),
    },
  };

  // Traiter chaque ouvrier présent une seule fois (ANTI-DOUBLE COMPTAGE STRICT)
  presentsPointages.forEach((ptg) => {
    const numOuvrier = ptg.numero_ouvrier;
    const workerDomaineId = ptg.domaine_id || defaultDomaineId;
    const workerDomaine = domainesMap.get(workerDomaineId) || null;

    // Récupérer toutes les tâches associées à cet ouvrier aujourd'hui
    const workerAffs = affectations.filter((a) => a.ouvrier_id === ptg.ouvrier_id);
    const workerTaches: Tache[] = workerAffs
      .map((a) => tachesMap.get(a.tache_id))
      .filter((t): t is Tache => Boolean(t));

    // Rétrocompatibilité : si aucune affectation mais pointage.tache_id présent
    if (workerTaches.length === 0 && ptg.tache_id) {
      const legacyTache = tachesMap.get(ptg.tache_id);
      if (legacyTache) workerTaches.push(legacyTache);
    }

    if (workerTaches.length === 0) {
      // Sans tâche -> Toutes tâches standard / Instable (95 DH)
      categories.INSTABLE.ouvriers.add(numOuvrier);
      categories.INSTABLE.tachesNoms.add('Sans tâche');
    } else {
      // Si plusieurs tâches : attribuer la catégorie à plus haute valeur tarifaire pour cet ouvrier unique
      // Barème : Ébourgeonnage D5 (150) > Traitement Phyto (105) > Stationnaire (100) > Instable (95)
      let bestClassification = classifyTacheFinanciere(workerTaches[0], workerDomaine);

      for (let i = 1; i < workerTaches.length; i++) {
        const currentCl = classifyTacheFinanciere(workerTaches[i], workerDomaine);
        if (currentCl.tarifUnitaire > bestClassification.tarifUnitaire) {
          bestClassification = currentCl;
        }
      }

      categories[bestClassification.key].ouvriers.add(numOuvrier);
      workerTaches.forEach((t) => {
        categories[bestClassification.key].tachesNoms.add(t.nom);
      });
    }
  });

  // Ordre strict d'affichage demandé dans la spécification :
  // 1. INSTABLE (95 DH)
  // 2. STATIONNAIRE (100 DH)
  // 3. ÉBOURGEONNAGE D5 (150 DH)
  // 4. TRAITEMENT PHYTO (105 DH)
  const orderedKeys: CategorieFinanciereKey[] = [
    'INSTABLE',
    'STATIONNAIRE',
    'EBOURGEONNAGE_D5',
    'TRAITEMENT_PHYTO',
  ];

  let totalGeneralDH = 0;
  let totalOuvriersComptabilises = 0;

  const lignes: LigneFinancierePointage[] = orderedKeys.map((key) => {
    const cat = categories[key];
    const nombre = cat.ouvriers.size;
    const montant = nombre * cat.tarifUnitaire;

    totalGeneralDH += montant;
    totalOuvriersComptabilises += nombre;

    return {
      key,
      nomAffiche: cat.nomAffiche,
      tarifUnitaire: cat.tarifUnitaire,
      nombreOuvriers: nombre,
      montantTotal: montant,
      ouvrierNumeros: Array.from(cat.ouvriers).sort((a, b) => a - b),
      detailsTaches: Array.from(cat.tachesNoms),
    };
  });

  // Uniquement les catégories ayant au moins 1 ouvrier pointé
  const categoriesPresentes = lignes.filter((l) => l.nombreOuvriers > 0);

  // Formatage du texte WhatsApp selon la spécification exacte :
  // RÉCAPITULATIF FINANCIER :
  //
  // - INSTABLE : Nombre × 95 DH = Total DH.
  // - STATIONNAIRE : Nombre × 100 DH = Total DH.
  // - ÉBOURGEONNAGE D5 : Nombre × 150 DH = Total DH.
  // - TRAITEMENT PHYTO : Nombre × 105 DH = Total DH.
  //
  // TOTAL GÉNÉRAL : XXX DH.
  let texteRecapWhatsApp = '';

  if (categoriesPresentes.length > 0) {
    const linesWhatsApp = categoriesPresentes.map(
      (cat) => `- ${cat.nomAffiche} : ${cat.nombreOuvriers} × ${cat.tarifUnitaire} DH = ${cat.montantTotal} DH.`
    );

    texteRecapWhatsApp = [
      'RÉCAPITULATIF FINANCIER :',
      '',
      ...linesWhatsApp,
      '',
      `TOTAL GÉNÉRAL : ${totalGeneralDH} DH.`,
    ].join('\n');
  }

  return {
    lignes,
    categoriesPresentes,
    totalGeneralDH,
    totalOuvriersComptabilises,
    texteRecapWhatsApp,
  };
}
