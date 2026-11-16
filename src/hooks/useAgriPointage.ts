/**
 * Hook central pour gérer l'état réactif de l'application AgriPointage
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Company,
  Ouvrier,
  Tache,
  Pointage,
  Domaine,
  PointageStats,
  HeureSupplementaire,
  TypeSupplementaire,
  GazoilMouvementType,
  UserAccount,
  Serre,
  RecolteEntry,
  RecolteFilter,
  AffectationTache,
  TacheSerreConfig,
} from '../types';
import * as storage from '../services/storage';
import {
  syncQueueToSupabase,
  syncPointageQueueToSupabase,
  pullTachesFromSupabase,
  pullAllCompanyDataFromSupabase,
  subscribeCompanyRealtime,
} from '../services/supabaseSync';
import {
  syncPendingContractuelPointages,
  getPendingContractuelPointagesCount,
} from '../services/contractuelService';
import { generateWhatsAppRecap } from '../utils/whatsappFormatter';
import {
  calculerPointageFinancierMatin,
  CalculFinancierPointageResult,
} from '../utils/pointageFinancier';
import {
  syncAndFetchHeuresSupplementairesServer,
  createHeureSupplementaireServer,
  updateHeureSupplementaireServer,
  deleteHeureSupplementaireServer,
} from '../services/heuresSupplementairesService';
import { fetchTachesSupplementairesServer } from '../services/tachesSupplementairesService';

export function getTodayIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function useAgriPointage() {
  const [selectedDate, setSelectedDate] = useState<string>(getTodayIsoDate);
  const [activeCompanyId, setActiveCompanyIdState] = useState<string>(storage.getActiveCompanyId);
  const [updateTick, setUpdateTick] = useState(0);
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(() => storage.getLastSyncAt());
  const syncInFlightRef = useRef<boolean>(false);

  const isReadOnlyUser = useCallback(() => {
    return storage.getCurrentUser()?.role === 'lecteur';
  }, []);

  // S'abonner aux changements de stockage (persistance localStorage + inter-composants)
  useEffect(() => {
    storage.initStorage();
    const unsubscribe = storage.subscribeToStorage(() => {
      setActiveCompanyIdState(storage.getActiveCompanyId());
      setLastSyncAt(storage.getLastSyncAt());
      setUpdateTick((t) => t + 1);
    });
    return unsubscribe;
  }, []);

  const syncAll = useCallback(async () => {
    if (syncInFlightRef.current) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setIsOnline(false);
      return;
    }
    syncInFlightRef.current = true;
    setIsSyncing(true);
    try {
      setIsOnline(true);
      await syncQueueToSupabase().catch(() => {});
      await Promise.allSettled([
        storage.syncRecolteWithServer(activeCompanyId),
        syncPendingContractuelPointages(),
        pullAllCompanyDataFromSupabase(activeCompanyId, selectedDate),
        pullTachesFromSupabase(activeCompanyId),
        syncAndFetchHeuresSupplementairesServer({ date: selectedDate }),
        fetchTachesSupplementairesServer({ date: selectedDate }),
      ]);
      setLastSyncAt(storage.getLastSyncAt());
      setUpdateTick((t) => t + 1);
    } finally {
      syncInFlightRef.current = false;
      setIsSyncing(false);
    }
  }, [activeCompanyId, selectedDate]);

  // Synchronisation automatique multi-appareils :
  // - Chargement / changement date / société
  // - Retour réseau (online), focus fenêtre, onglet visible (visibilitychange)
  // - Polling léger 20s uniquement sur onglet visible
  // - Abonnement Supabase Realtime (postgres_changes)
  useEffect(() => {
    syncAll();

    const handleOnline = () => {
      setIsOnline(true);
      syncAll();
    };
    const handleOffline = () => {
      setIsOnline(false);
    };
    const handleFocus = () => {
      syncAll();
    };
    const handleVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        syncAll();
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribeRealtime = subscribeCompanyRealtime(activeCompanyId, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        syncAll();
      }, 400);
    });

    const intervalId = setInterval(() => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'visible' &&
        (typeof navigator === 'undefined' || navigator.onLine)
      ) {
        syncAll();
      }
    }, 20000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      unsubscribeRealtime();
      if (debounceTimer) clearTimeout(debounceTimer);
      clearInterval(intervalId);
    };
  }, [activeCompanyId, selectedDate, syncAll]);

  // Liste des sociétés
  const companies = useMemo(() => {
    // depend on updateTick
    void updateTick;
    return storage.getCompanies();
  }, [updateTick]);

  // Société courante
  const currentCompany = useMemo(() => {
    return companies.find((c) => c.id === activeCompanyId) || companies[0] || {
      id: 'cie_default',
      nom: 'Domaine Agricole',
      code: 'AGRI',
      createdAt: new Date().toISOString(),
    };
  }, [companies, activeCompanyId]);

  // Ouvriers de la société active
  const allOuvriers = useMemo(() => {
    void updateTick;
    return storage.getOuvriers(activeCompanyId);
  }, [activeCompanyId, updateTick]);

  const activeOuvriers = useMemo(() => {
    return allOuvriers.filter((o) => o.actif);
  }, [allOuvriers]);

  // Tâches
  const taches = useMemo(() => {
    void updateTick;
    return storage.getTaches(activeCompanyId);
  }, [activeCompanyId, updateTick]);

  // Domaines configurés (D1 à D5, avec D2 par défaut)
  const domaines = useMemo(() => {
    void updateTick;
    return storage.getDomaines();
  }, [updateTick]);

  const defaultDomaineId = useMemo(() => {
    void updateTick;
    return storage.getDefaultDomaineId();
  }, [updateTick]);

  // Pointages pour la société et la date sélectionnée
  const pointages = useMemo(() => {
    void updateTick;
    return storage.getPointages(activeCompanyId, selectedDate);
  }, [activeCompanyId, selectedDate, updateTick]);

  // Heures supplémentaires pour la société et la date sélectionnée
  const heuresSupplementaires = useMemo(() => {
    void updateTick;
    return storage.getHeuresSupplementaires(activeCompanyId, selectedDate);
  }, [activeCompanyId, selectedDate, updateTick]);

  // Toutes les heures et tâches supplémentaires de la société (historique multi-dates)
  const allHeuresSupplementaires = useMemo(() => {
    void updateTick;
    return storage.getAllHeuresSupplementaires(activeCompanyId);
  }, [activeCompanyId, updateTick]);

  // Les heures supplémentaires sont synchronisées via syncAll() ci-dessus

  // Affectations de tâches pour la société et la date sélectionnée
  const affectations = useMemo(() => {
    void updateTick;
    return storage.getAffectations(activeCompanyId, selectedDate);
  }, [activeCompanyId, selectedDate, updateTick]);

  // Configuration multi-serres des tâches pour la société et la date sélectionnée
  const tacheSerresConfigs = useMemo<TacheSerreConfig[]>(() => {
    void updateTick;
    return storage.getTacheSerresConfigs(activeCompanyId, selectedDate);
  }, [activeCompanyId, selectedDate, updateTick]);

  // Ensemble des IDs d'ouvriers pointés pour la date sélectionnée (présents uniquement)
  const pointesOuvrierIds = useMemo(() => {
    return new Set(pointages.filter((p) => p.present !== false).map((p) => p.ouvrier_id));
  }, [pointages]);

  // Ouvriers pointés avec détails ouvrier + toutes ses tâches + serre par tâche + domaine (présents uniquement)
  const pointesDetails = useMemo(() => {
    const ouvriersMap = new Map(allOuvriers.map((o) => [o.id, o]));
    const tachesMap = new Map(taches.map((t) => [t.id, t]));
    const domainesMap = new Map(domaines.map((d) => [d.id, d]));
    const allSerresList = storage.getSerres(activeCompanyId);
    const serresMap = new Map(allSerresList.map((s) => [s.id, s]));

    return pointages
      .filter((ptg) => ptg.present !== false)
      .map((ptg) => {
        const workerAffs = affectations.filter((a) => a.ouvrier_id === ptg.ouvrier_id);
        const workerTaches = workerAffs
          .map((a) => tachesMap.get(a.tache_id))
          .filter(Boolean) as Tache[];

        if (workerTaches.length === 0 && ptg.tache_id) {
          const legacyTache = tachesMap.get(ptg.tache_id);
          if (legacyTache) workerTaches.push(legacyTache);
        }

        const affectationDetails = workerAffs.map((aff) => ({
          affectation: aff,
          tache: tachesMap.get(aff.tache_id),
          domaine: domainesMap.get(aff.domaine_id || ptg.domaine_id || defaultDomaineId),
          serre: aff.serre_id && !aff.serre_id.includes(',') ? serresMap.get(aff.serre_id) : undefined,
        }));

        return {
          pointage: ptg,
          ouvrier: ouvriersMap.get(ptg.ouvrier_id),
          tache: workerTaches[0],
          taches: workerTaches,
          affectations: workerAffs as AffectationTache[],
          affectationDetails,
          domaine: domainesMap.get(ptg.domaine_id || defaultDomaineId),
        };
      });
  }, [pointages, affectations, allOuvriers, taches, domaines, defaultDomaineId, activeCompanyId]);

  // Détails des heures supplémentaires avec infos ouvrier et tâche
  const heuresSuppDetails = useMemo(() => {
    const ouvriersMap = new Map(allOuvriers.map((o) => [o.id, o]));
    const tachesMap = new Map(taches.map((t) => [t.id, t]));
    return heuresSupplementaires.map((item) => ({
      item,
      ouvrier: ouvriersMap.get(item.ouvrier_id),
      tache: item.tache_id ? tachesMap.get(item.tache_id) : undefined,
    }));
  }, [heuresSupplementaires, allOuvriers, taches]);

  // Ouvriers restants à pointer (actifs et non encore pointés)
  const ouvriersRestants = useMemo(() => {
    return activeOuvriers
      .filter((o) => !pointesOuvrierIds.has(o.id))
      .sort((a, b) => a.numero - b.numero);
  }, [activeOuvriers, pointesOuvrierIds]);

  // Absents (exactement la liste des ouvriers actifs non pointés pour la date sélectionnée)
  const absents = ouvriersRestants;

  // Statistiques permanentes
  const stats: PointageStats = useMemo(() => {
    const total = activeOuvriers.length;
    const pointes = pointesOuvrierIds.size;
    const restants = Math.max(0, total - pointes);
    const tauxPresence = total > 0 ? Math.round((pointes / total) * 100) : 0;
    return {
      totalActifs: total,
      pointes,
      restants,
      tauxPresence,
    };
  }, [activeOuvriers, pointesOuvrierIds]);

  // Texte Récap WhatsApp calculé en temps réel avec domaines et affectations multi-tâches
  const recapWhatsAppText = useMemo(() => {
    return generateWhatsAppRecap({
      dateIso: selectedDate,
      ouvriersActifs: activeOuvriers,
      taches,
      pointages,
      affectations,
      domaines,
      defaultDomaineId,
      heuresSupp: heuresSupplementaires,
    });
  }, [selectedDate, activeOuvriers, taches, pointages, affectations, domaines, defaultDomaineId, heuresSupplementaires]);

  // Récapitulatif financier automatique pour POINTAGE MATIN D1–D5
  const pointageFinancier = useMemo<CalculFinancierPointageResult>(() => {
    return calculerPointageFinancierMatin({
      pointages,
      affectations,
      taches,
      domaines,
      defaultDomaineId,
    });
  }, [pointages, affectations, taches, domaines, defaultDomaineId]);

  // --- ACTIONS ---

  // Valider un numéro d'ouvrier pour pointage
  const checkWorkerByNumber = useCallback(
    (numero: number): { valid: boolean; ouvrier?: Ouvrier; error?: string; isAlreadyPointed?: boolean; existingPointage?: Pointage } => {
      // 1. L'ouvrier existe-t-il dans la liste des actifs de la société ?
      const ouvrier = activeOuvriers.find((o) => o.numero === numero);
      if (!ouvrier) {
        // Est-ce un ouvrier inactif ?
        const inactif = allOuvriers.find((o) => o.numero === numero);
        if (inactif) {
          return {
            valid: false,
            error: `L'ouvrier #${numero} (${inactif.nom}) est désactivé. Réactivez-le dans l'onglet Gestion.`,
          };
        }
        return {
          valid: false,
          error: `Le numéro ${numero} n'existe pas dans la liste des ouvriers de cette exploitation.`,
        };
      }

      // 2. Est-il déjà pointé présent pour la date sélectionnée ?
      const existing = pointages.find((p) => p.ouvrier_id === ouvrier.id && p.present !== false);
      if (existing) {
        return {
          valid: false,
          isAlreadyPointed: true,
          ouvrier,
          existingPointage: existing,
          error: `Ouvrier #${numero} (${ouvrier.nom}) DÉJÀ POINTÉ aujourd'hui à ${existing.heure} !`,
        };
      }

      return { valid: true, ouvrier };
    },
    [activeOuvriers, allOuvriers, pointages]
  );

  // Enregistrer le pointage d'un ouvrier (avec domaine optionnel ou par défaut)
  const pointWorker = useCallback(
    (
      ouvrierId: string,
      tacheId: string | null = null,
      domaineId?: string,
      serreId?: string | null,
      serreNom?: string | null
    ): { success: boolean; message?: string; pointage?: Pointage } => {
      if (isReadOnlyUser()) {
        return { success: false, message: 'Compte Lecture Seule : modification non autorisée.' };
      }
      const res = storage.addPointage(
        activeCompanyId,
        ouvrierId,
        selectedDate,
        tacheId,
        domaineId || defaultDomaineId,
        serreId,
        serreNom
      );
      if (res.success && res.pointage) {
        syncPointageQueueToSupabase().catch(() => {});
        return { success: true, message: 'Pointage enregistré avec succès !', pointage: res.pointage };
      }
      return { success: false, message: res.error || 'Erreur lors de l\'enregistrement.' };
    },
    [activeCompanyId, selectedDate, defaultDomaineId, isReadOnlyUser]
  );

  // Affectation des ouvriers et serres multiples aux tâches
  const setTaskWorkers = useCallback(
    (
      tacheId: string,
      ouvrierIds: string[],
      options?: { domaineId?: string; serreIds?: string[]; serreNoms?: string[] }
    ) => {
      if (isReadOnlyUser()) {
        return { success: false, error: 'Compte Lecture Seule : modification non autorisée.' };
      }
      const res = storage.setTaskWorkers(activeCompanyId, selectedDate, tacheId, ouvrierIds, options);
      if (res.success) {
        syncQueueToSupabase().catch(() => {});
      }
      return res;
    },
    [activeCompanyId, selectedDate, isReadOnlyUser]
  );

  const saveTaskSerres = useCallback(
    (tacheId: string, domaineId: string, serreIds: string[], serreNoms: string[]) => {
      if (isReadOnlyUser()) {
        return { success: false, updatedCount: 0 };
      }
      const res = storage.updateTacheAffectationsSerres(
        activeCompanyId,
        selectedDate,
        tacheId,
        domaineId,
        serreIds,
        serreNoms
      );
      if (res.success) {
        syncQueueToSupabase().catch(() => {});
      }
      return res;
    },
    [activeCompanyId, selectedDate, isReadOnlyUser]
  );

  const removeWorkerFromTask = useCallback(
    (ouvrierId: string, tacheId: string) => {
      if (isReadOnlyUser()) return;
      storage.removeWorkerFromTask(activeCompanyId, selectedDate, ouvrierId, tacheId);
      syncPointageQueueToSupabase().catch(() => {});
    },
    [activeCompanyId, selectedDate, isReadOnlyUser]
  );

  const assignWorkerToTask = useCallback(
    (
      ouvrierId: string,
      tacheId: string,
      domaineId?: string,
      serreId?: string | null,
      serreNom?: string | null
    ) => {
      if (isReadOnlyUser()) {
        return { success: false, error: 'Compte Lecture Seule : modification non autorisée.' };
      }
      const res = storage.assignWorkerToTask(
        activeCompanyId,
        selectedDate,
        ouvrierId,
        tacheId,
        domaineId,
        serreId,
        serreNom
      );
      if (res.success) {
        syncPointageQueueToSupabase().catch(() => {});
      }
      return res;
    },
    [activeCompanyId, selectedDate, isReadOnlyUser]
  );

  const updateAffectation = useCallback(
    (
      affectationId: string,
      updates: { tacheId?: string; domaineId?: string; serreId?: string | null; serreNom?: string | null }
    ) => {
      if (isReadOnlyUser()) {
        return { success: false, error: 'Compte Lecture Seule : modification non autorisée.' };
      }
      const res = storage.updateAffectationTache(affectationId, updates);
      if (res.success) {
        syncPointageQueueToSupabase().catch(() => {});
      }
      return res;
    },
    [isReadOnlyUser]
  );

  const removeAffectation = useCallback((affectationId: string) => {
    if (isReadOnlyUser()) return;
    storage.removeAffectationById(affectationId);
    syncPointageQueueToSupabase().catch(() => {});
  }, [isReadOnlyUser]);

  // Sauvegarde et nettoyage complet
  const getLastBackupDate = useCallback(() => {
    return storage.getLastBackupDate();
  }, []);

  const recordBackupDate = useCallback(() => {
    storage.recordBackupDate();
  }, []);

  const clearAllDataPermanently = useCallback(() => {
    if (isReadOnlyUser()) return;
    storage.clearAllDataPermanently();
  }, [isReadOnlyUser]);

  // Modifier un pointage existant (tâche et/ou domaine)
  const updatePointage = useCallback(
    (pointageId: string, updates: { tacheId?: string | null; domaineId?: string }) => {
      if (isReadOnlyUser()) return;
      storage.updatePointage(pointageId, {
        tache_id: updates.tacheId,
        domaine_id: updates.domaineId,
      });
      syncPointageQueueToSupabase().catch(() => {});
    },
    [isReadOnlyUser]
  );

  // Modifier la tâche d'un pointage existant (rétro-compatibilité)
  const updateTask = useCallback((pointageId: string, tacheId: string | null) => {
    if (isReadOnlyUser()) return;
    storage.updatePointageTache(pointageId, tacheId);
    syncPointageQueueToSupabase().catch(() => {});
  }, [isReadOnlyUser]);

  // Gestion des domaines
  const saveDomaine = useCallback((dom: { id?: string; nom: string; ordre?: number }) => {
    if (isReadOnlyUser()) return null;
    const res = storage.saveDomaine(dom);
    syncQueueToSupabase().catch(() => {});
    return res;
  }, [isReadOnlyUser]);

  const deleteDomaine = useCallback((id: string) => {
    if (isReadOnlyUser()) {
      return { success: false, error: 'Compte Lecture Seule : modification non autorisée.' };
    }
    const res = storage.deleteDomaine(id);
    if (res.success) syncQueueToSupabase().catch(() => {});
    return res;
  }, [isReadOnlyUser]);

  const updateDomainesOrder = useCallback((domList: Domaine[]) => {
    if (isReadOnlyUser()) return;
    storage.updateDomainesOrder(domList);
    syncQueueToSupabase().catch(() => {});
  }, [isReadOnlyUser]);

  const setDefaultDomaineId = useCallback((id: string) => {
    if (isReadOnlyUser()) return;
    storage.setDefaultDomaineId(id);
  }, [isReadOnlyUser]);

  // Annuler / supprimer un pointage (en cas d'erreur de frappe)
  const removePointage = useCallback((pointageId: string) => {
    if (isReadOnlyUser()) return;
    storage.deletePointage(pointageId);
    syncPointageQueueToSupabase().catch(() => {});
  }, [isReadOnlyUser]);

  // Passer un ouvrier en Absent (retire ses affectations de tâches du jour)
  const passerEnAbsent = useCallback(
    (ouvrierId: string, date?: string) => {
      if (isReadOnlyUser()) return { success: false, tasksRemoved: 0 };
      const targetDate = date || selectedDate;
      const res = storage.passerPointageEnAbsent(activeCompanyId, ouvrierId, targetDate);
      if (res.success) syncPointageQueueToSupabase().catch(() => {});
      return res;
    },
    [activeCompanyId, selectedDate, isReadOnlyUser]
  );

  // Passer un ouvrier en Présent (sans tâche, avec domaine du jour)
  const passerEnPresent = useCallback(
    (ouvrierId: string, date?: string, domaineId?: string) => {
      if (isReadOnlyUser()) return { success: false };
      const targetDate = date || selectedDate;
      const res = storage.passerPointageEnPresent(
        activeCompanyId,
        ouvrierId,
        targetDate,
        domaineId || defaultDomaineId
      );
      if (res.success) syncPointageQueueToSupabase().catch(() => {});
      return res;
    },
    [activeCompanyId, selectedDate, defaultDomaineId, isReadOnlyUser]
  );

  // Changer de domaine pour un pointage
  const changerDomaine = useCallback(
    (pointageId: string, newDomaineId: string) => {
      if (isReadOnlyUser()) return;
      storage.updatePointageDomaine(pointageId, newDomaineId);
      syncPointageQueueToSupabase().catch(() => {});
    },
    [isReadOnlyUser]
  );

  // Nombre de tâches affectées à un ouvrier pour une date
  const getWorkerTasksCount = useCallback(
    (ouvrierId: string, date?: string) => {
      const targetDate = date || selectedDate;
      return storage.getWorkerAffectationsCount(activeCompanyId, ouvrierId, targetDate);
    },
    [activeCompanyId, selectedDate]
  );

  // Valider un ouvrier pour les heures supplémentaires
  const checkWorkerForHeuresSupp = useCallback(
    (numero: number): { valid: boolean; ouvrier?: Ouvrier; error?: string; existingEntries?: HeureSupplementaire[] } => {
      const ouvrier = activeOuvriers.find((o) => o.numero === numero);
      if (!ouvrier) {
        const inactif = allOuvriers.find((o) => o.numero === numero);
        if (inactif) {
          return {
            valid: false,
            error: `L'ouvrier #${numero} (${inactif.nom}) est désactivé.`,
          };
        }
        return {
          valid: false,
          error: `Le numéro ${numero} n'existe pas dans la liste des ouvriers.`,
        };
      }

      const existingEntries = heuresSupplementaires.filter((h) => h.ouvrier_id === ouvrier.id);
      return { valid: true, ouvrier, existingEntries };
    },
    [activeOuvriers, allOuvriers, heuresSupplementaires]
  );

  // Enregistrer ou modifier une entrée en heures supplémentaires (par heures ou par tâche)
  const saveHeureSupp = useCallback(
    async (
      ouvrierId: string,
      data: {
        id?: string;
        date?: string;
        type: TypeSupplementaire;
        tache_id?: string | null;
        nom_tache?: string | null;
        quantite?: number | null;
        unite?: string;
        heures?: number | null;
        domaine_id?: string | null;
        serre_id?: string | null;
        observation?: string | null;
        created_by_id?: string | null;
        created_by_nom?: string | null;
        updated_by_id?: string | null;
        updated_by_nom?: string | null;
      }
    ): Promise<{ success: boolean; message?: string; item?: HeureSupplementaire; isUpdated?: boolean }> => {
      if (isReadOnlyUser()) {
        return { success: false, message: 'Compte Lecture Seule : modification non autorisée.' };
      }
      const targetDate = data.date || selectedDate;
      const ouvrier = activeOuvriers.find((o) => o.id === ouvrierId) || allOuvriers.find((o) => o.id === ouvrierId);

      // Si un ID est fourni -> Modification sur le serveur
      if (data.id) {
        const sRes = await updateHeureSupplementaireServer(data.id, {
          type: data.type,
          tache_id: data.tache_id,
          nom_tache: data.nom_tache,
          quantite: data.quantite,
          unite: data.unite,
          heures: data.heures,
          domaine_id: data.domaine_id,
          serre_id: data.serre_id,
          observation: data.observation,
          date: targetDate,
        });

        if (!sRes.success) {
          return { success: false, message: sRes.error || 'Erreur lors de la mise à jour sur le serveur.' };
        }

        const localRes = storage.saveHeureSupplementaire(activeCompanyId, ouvrierId, targetDate, data);
        return {
          success: true,
          item: sRes.item || localRes.item,
          isUpdated: true,
          message: 'Opération mise à jour avec succès !',
        };
      } else {
        // Sinon -> Création sur le serveur
        if (!ouvrier) {
          return { success: false, message: 'Ouvrier introuvable dans cette exploitation.' };
        }

        const sRes = await createHeureSupplementaireServer({
          ouvrier_id: ouvrierId,
          numero_ouvrier: ouvrier.numero,
          date: targetDate,
          type: data.type,
          tache_id: data.tache_id,
          nom_tache: data.nom_tache,
          quantite: data.quantite,
          unite: data.unite,
          heures: data.heures,
          domaine_id: data.domaine_id,
          serre_id: data.serre_id,
          observation: data.observation,
        });

        if (!sRes.success) {
          return { success: false, message: sRes.error || 'Erreur lors de l\'enregistrement sur le serveur.' };
        }

        const localRes = storage.saveHeureSupplementaire(activeCompanyId, ouvrierId, targetDate, {
          ...data,
          id: sRes.item?.id,
        });

        return {
          success: true,
          item: sRes.item || localRes.item,
          isUpdated: false,
          message: 'Opération enregistrée avec succès !',
        };
      }
    },
    [activeCompanyId, selectedDate, activeOuvriers, allOuvriers, isReadOnlyUser]
  );

  // Enregistrer une entrée en heures supplémentaires (rétro-compatibilité)
  const pointHeuresSupp = useCallback(
    async (ouvrierId: string, heures?: number | null): Promise<{ success: boolean; message?: string }> => {
      const res = await saveHeureSupp(ouvrierId, {
        type: 'heures',
        quantite: heures,
        heures,
        unite: 'HEURE',
      });
      return { success: res.success, message: res.message };
    },
    [saveHeureSupp]
  );

  // Supprimer une entrée en heures supplémentaires
  const removeHeureSupp = useCallback(async (id: string): Promise<{ success: boolean; message?: string }> => {
    if (isReadOnlyUser()) {
      return { success: false, message: 'Compte Lecture Seule : suppression non autorisée.' };
    }
    const sRes = await deleteHeureSupplementaireServer(id);
    if (!sRes.success) {
      return { success: false, message: sRes.error || 'Erreur lors de la suppression sur le serveur.' };
    }
    storage.deleteHeureSupplementaire(id);
    return { success: true, message: 'Opération supprimée avec succès.' };
  }, [isReadOnlyUser]);

  // Changer de société
  const switchCompany = useCallback((companyId: string) => {
    storage.setActiveCompanyId(companyId);
    setActiveCompanyIdState(companyId);
  }, []);

  // --- GAZOIL (SUIVI DU CARBURANT) ---
  const gazoilStatus = useMemo(() => {
    void updateTick;
    return storage.calculerStockGazoil(activeCompanyId);
  }, [activeCompanyId, updateTick]);

  const gazoilMouvements = useMemo(() => {
    void updateTick;
    return storage.getGazoilMouvements(activeCompanyId);
  }, [activeCompanyId, updateTick]);

  // Vérifier et notifier si passage sous le seuil
  useEffect(() => {
    storage.checkAndNotifyStockBas(activeCompanyId);
  }, [activeCompanyId, gazoilStatus.stockActuel, gazoilStatus.isStockBas]);

  const setStockInitialGazoil = useCallback(
    (stockInitial: number) => {
      if (isReadOnlyUser()) return storage.getGazoilConfig(activeCompanyId);
      const res = storage.setStockInitialGazoil(activeCompanyId, stockInitial);
      syncQueueToSupabase().catch(() => {});
      return res;
    },
    [activeCompanyId, isReadOnlyUser]
  );

  const setSeuilAlerteGazoil = useCallback(
    (seuil: number) => {
      if (isReadOnlyUser()) return storage.getGazoilConfig(activeCompanyId);
      const res = storage.setSeuilAlerteGazoil(activeCompanyId, seuil);
      syncQueueToSupabase().catch(() => {});
      return res;
    },
    [activeCompanyId, isReadOnlyUser]
  );

  const addGazoilMouvement = useCallback(
    (mvt: {
      type: GazoilMouvementType;
      date: string;
      quantite: number;
      engin_ou_tache?: string;
      remarque?: string;
    }) => {
      if (isReadOnlyUser()) {
        return { success: false, error: 'Compte Lecture Seule : modification non autorisée.' };
      }
      const res = storage.addGazoilMouvement(activeCompanyId, mvt);
      if (res.success) syncQueueToSupabase().catch(() => {});
      return res;
    },
    [activeCompanyId, isReadOnlyUser]
  );

  const deleteGazoilMouvement = useCallback(
    (id: string) => {
      if (isReadOnlyUser()) return;
      storage.deleteGazoilMouvement(activeCompanyId, id);
      syncQueueToSupabase().catch(() => {});
    },
    [activeCompanyId, isReadOnlyUser]
  );

  const lancerCommandeGazoil = useCallback(
    (quantite: number, dateStr: string, tel?: string) => {
      if (isReadOnlyUser()) return;
      storage.lancerCommandeGazoil(activeCompanyId, quantite, dateStr, tel);
      syncQueueToSupabase().catch(() => {});
    },
    [activeCompanyId, isReadOnlyUser]
  );

  const cloturerCommandeGazoil = useCallback(() => {
    if (isReadOnlyUser()) return;
    storage.cloturerCommandeGazoil(activeCompanyId);
    syncQueueToSupabase().catch(() => {});
  }, [activeCompanyId, isReadOnlyUser]);

  // Multi-comptes & Utilisateur connecté
  const currentUser = useMemo(() => {
    void updateTick;
    return storage.getCurrentUser();
  }, [updateTick]);

  const users = useMemo(() => {
    void updateTick;
    return storage.getUsers();
  }, [updateTick]);

  const switchUser = useCallback((user: UserAccount) => {
    storage.setCurrentUser(user);
  }, []);

  const logout = useCallback(() => {
    storage.logoutUser();
  }, []);

  // Serres (Greenhouses)
  const serres = useMemo(() => {
    void updateTick;
    return storage.getSerres(activeCompanyId);
  }, [activeCompanyId, updateTick]);

  const saveSerre = useCallback(
    (data: { id?: string; code: string; nom: string; actif?: boolean; domaine_id?: string | null }) => {
      if (isReadOnlyUser()) {
        return { success: false, error: 'Compte Lecture Seule : modification non autorisée.' };
      }
      const res = storage.saveSerre(activeCompanyId, data);
      if (res.success) syncQueueToSupabase().catch(() => {});
      return res;
    },
    [activeCompanyId, isReadOnlyUser]
  );

  const deleteSerre = useCallback((id: string) => {
    if (isReadOnlyUser()) {
      return { success: false, error: 'Compte Lecture Seule : modification non autorisée.' };
    }
    const res = storage.deleteSerre(id);
    if (res.success) syncQueueToSupabase().catch(() => {});
    return res;
  }, [isReadOnlyUser]);

  const toggleSerreActif = useCallback((id: string) => {
    if (isReadOnlyUser()) return;
    storage.toggleSerreActif(id);
    syncQueueToSupabase().catch(() => {});
  }, [isReadOnlyUser]);

  // Récolte (Harvest)
  const allRecoltes = useMemo(() => {
    void updateTick;
    return storage.getRecoltes(activeCompanyId);
  }, [activeCompanyId, updateTick]);

  const addRecolte = useCallback(
    (
      entries: Array<{
        date: string;
        serre_id: string;
        serre_nom: string;
        ouvrier_id: string;
        numero_ouvrier: number;
        nom_ouvrier: string;
        caisses: number;
        notes?: string;
      }>,
      author: { id: string; nom: string }
    ) => {
      if (isReadOnlyUser()) {
        return { success: false, error: 'Compte Lecture Seule : saisie de récolte non autorisée.', count: 0, added: [] };
      }
      return storage.addRecolteEntries(activeCompanyId, entries, author);
    },
    [activeCompanyId, isReadOnlyUser]
  );

  const updateRecolte = useCallback(
    (
      id: string,
      partial: { caisses?: number; notes?: string; date?: string; serre_id?: string; serre_nom?: string },
      updatedBy: { id: string; nom: string }
    ) => {
      if (isReadOnlyUser()) {
        return { success: false, error: 'Compte Lecture Seule : modification non autorisée.' };
      }
      return storage.updateRecolteEntry(id, partial, updatedBy);
    },
    [isReadOnlyUser]
  );

  const deleteRecolte = useCallback((id: string) => {
    if (isReadOnlyUser()) {
      return { success: false, error: 'Compte Lecture Seule : suppression non autorisée.' };
    }
    return storage.deleteRecolteEntry(id);
  }, [isReadOnlyUser]);

  const syncRecolte = useCallback(async () => {
    return await storage.syncRecolteWithServer(activeCompanyId);
  }, [activeCompanyId]);

  const pendingSyncCount = useMemo(() => {
    void updateTick;
    return storage.getPendingSyncCount() + getPendingContractuelPointagesCount();
  }, [updateTick]);

  return {
    selectedDate,
    setSelectedDate,
    companies,
    currentCompany,
    switchCompany,
    allOuvriers,
    activeOuvriers,
    ouvriersRestants,
    absents,
    taches,
    domaines,
    defaultDomaineId,
    pointages,
    affectations,
    tacheSerresConfigs,
    pointesDetails,
    pointesOuvrierIds,
    heuresSupplementaires,
    allHeuresSupplementaires,
    heuresSuppDetails,
    stats,
    recapWhatsAppText,
    pointageFinancier,
    checkWorkerByNumber,
    pointWorker,
    setTaskWorkers,
    saveTaskSerres,
    removeWorkerFromTask,
    assignWorkerToTask,
    updateAffectation,
    removeAffectation,
    getLastBackupDate,
    recordBackupDate,
    clearAllDataPermanently,
    updatePointage,
    updateTask,
    saveDomaine,
    deleteDomaine,
    updateDomainesOrder,
    setDefaultDomaineId,
    removePointage,
    passerEnAbsent,
    passerEnPresent,
    changerDomaine,
    getWorkerTasksCount,
    checkWorkerForHeuresSupp,
    saveHeureSupp,
    pointHeuresSupp,
    removeHeureSupp,
    // Gazoil
    gazoilStatus,
    gazoilMouvements,
    setStockInitialGazoil,
    setSeuilAlerteGazoil,
    addGazoilMouvement,
    deleteGazoilMouvement,
    lancerCommandeGazoil,
    cloturerCommandeGazoil,
    // Stockage & Quota
    storageQuotaError: storage.getStorageQuotaError(),
    clearStorageQuotaError: storage.clearStorageQuotaError,
    // État synchronisation multi-appareils
    isOnline,
    isSyncing,
    lastSyncAt,
    pendingSyncCount,
    forceSyncNow: syncAll,
    // Multi-comptes
    currentUser,
    users,
    switchUser,
    logout,
    saveUser: storage.saveUser,
    toggleUserActif: storage.toggleUserActif,
    deleteUser: storage.deleteUser,
    // Serres
    serres,
    saveSerre,
    deleteSerre,
    toggleSerreActif,
    // Récolte
    allRecoltes,
    addRecolte,
    updateRecolte,
    deleteRecolte,
    syncRecolte,
  };
}
