/**
 * Hook central pour gérer l'état réactif de l'application AgriPointage
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
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
} from '../types';
import * as storage from '../services/storage';
import { generateWhatsAppRecap } from '../utils/whatsappFormatter';

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

  // S'abonner aux changements de stockage (persistance localStorage + inter-composants)
  useEffect(() => {
    storage.initStorage();
    const unsubscribe = storage.subscribeToStorage(() => {
      setActiveCompanyIdState(storage.getActiveCompanyId());
      setUpdateTick((t) => t + 1);
    });
    return unsubscribe;
  }, []);

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

  // Affectations de tâches pour la société et la date sélectionnée
  const affectations = useMemo(() => {
    void updateTick;
    return storage.getAffectations(activeCompanyId, selectedDate);
  }, [activeCompanyId, selectedDate, updateTick]);

  // Ensemble des IDs d'ouvriers pointés pour la date sélectionnée (présents uniquement)
  const pointesOuvrierIds = useMemo(() => {
    return new Set(pointages.filter((p) => p.present !== false).map((p) => p.ouvrier_id));
  }, [pointages]);

  // Ouvriers pointés avec détails ouvrier + toutes ses tâches + domaine (présents uniquement)
  const pointesDetails = useMemo(() => {
    const ouvriersMap = new Map(allOuvriers.map((o) => [o.id, o]));
    const tachesMap = new Map(taches.map((t) => [t.id, t]));
    const domainesMap = new Map(domaines.map((d) => [d.id, d]));

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

        return {
          pointage: ptg,
          ouvrier: ouvriersMap.get(ptg.ouvrier_id),
          tache: workerTaches[0],
          taches: workerTaches,
          domaine: domainesMap.get(ptg.domaine_id || defaultDomaineId),
        };
      });
  }, [pointages, affectations, allOuvriers, taches, domaines, defaultDomaineId]);

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
      domaineId?: string
    ): { success: boolean; message?: string; pointage?: Pointage } => {
      const res = storage.addPointage(
        activeCompanyId,
        ouvrierId,
        selectedDate,
        tacheId,
        domaineId || defaultDomaineId
      );
      if (res.success && res.pointage) {
        return { success: true, message: 'Pointage enregistré avec succès !', pointage: res.pointage };
      }
      return { success: false, message: res.error || 'Erreur lors de l\'enregistrement.' };
    },
    [activeCompanyId, selectedDate, defaultDomaineId]
  );

  // Affectation des ouvriers aux tâches
  const setTaskWorkers = useCallback(
    (tacheId: string, ouvrierIds: string[]) => {
      return storage.setTaskWorkers(activeCompanyId, selectedDate, tacheId, ouvrierIds);
    },
    [activeCompanyId, selectedDate]
  );

  const removeWorkerFromTask = useCallback(
    (ouvrierId: string, tacheId: string) => {
      storage.removeWorkerFromTask(activeCompanyId, selectedDate, ouvrierId, tacheId);
    },
    [activeCompanyId, selectedDate]
  );

  const assignWorkerToTask = useCallback(
    (ouvrierId: string, tacheId: string) => {
      return storage.assignWorkerToTask(activeCompanyId, selectedDate, ouvrierId, tacheId);
    },
    [activeCompanyId, selectedDate]
  );

  // Sauvegarde et nettoyage complet
  const getLastBackupDate = useCallback(() => {
    return storage.getLastBackupDate();
  }, []);

  const recordBackupDate = useCallback(() => {
    storage.recordBackupDate();
  }, []);

  const clearAllDataPermanently = useCallback(() => {
    storage.clearAllDataPermanently();
  }, []);

  // Modifier un pointage existant (tâche et/ou domaine)
  const updatePointage = useCallback(
    (pointageId: string, updates: { tacheId?: string | null; domaineId?: string }) => {
      storage.updatePointage(pointageId, {
        tache_id: updates.tacheId,
        domaine_id: updates.domaineId,
      });
    },
    []
  );

  // Modifier la tâche d'un pointage existant (rétro-compatibilité)
  const updateTask = useCallback((pointageId: string, tacheId: string | null) => {
    storage.updatePointageTache(pointageId, tacheId);
  }, []);

  // Gestion des domaines
  const saveDomaine = useCallback((dom: { id?: string; nom: string; ordre?: number }) => {
    return storage.saveDomaine(dom);
  }, []);

  const deleteDomaine = useCallback((id: string) => {
    return storage.deleteDomaine(id);
  }, []);

  const updateDomainesOrder = useCallback((domList: Domaine[]) => {
    storage.updateDomainesOrder(domList);
  }, []);

  const setDefaultDomaineId = useCallback((id: string) => {
    storage.setDefaultDomaineId(id);
  }, []);

  // Annuler / supprimer un pointage (en cas d'erreur de frappe)
  const removePointage = useCallback((pointageId: string) => {
    storage.deletePointage(pointageId);
  }, []);

  // Passer un ouvrier en Absent (retire ses affectations de tâches du jour)
  const passerEnAbsent = useCallback(
    (ouvrierId: string, date?: string) => {
      const targetDate = date || selectedDate;
      return storage.passerPointageEnAbsent(activeCompanyId, ouvrierId, targetDate);
    },
    [activeCompanyId, selectedDate]
  );

  // Passer un ouvrier en Présent (sans tâche, avec domaine du jour)
  const passerEnPresent = useCallback(
    (ouvrierId: string, date?: string, domaineId?: string) => {
      const targetDate = date || selectedDate;
      return storage.passerPointageEnPresent(
        activeCompanyId,
        ouvrierId,
        targetDate,
        domaineId || defaultDomaineId
      );
    },
    [activeCompanyId, selectedDate, defaultDomaineId]
  );

  // Changer de domaine pour un pointage
  const changerDomaine = useCallback(
    (pointageId: string, newDomaineId: string) => {
      storage.updatePointageDomaine(pointageId, newDomaineId);
    },
    []
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
    (
      ouvrierId: string,
      data: {
        id?: string;
        type: TypeSupplementaire;
        tache_id?: string | null;
        quantite?: number | null;
        unite?: string;
        heures?: number | null;
      }
    ): { success: boolean; message?: string; item?: HeureSupplementaire; isUpdated?: boolean } => {
      const res = storage.saveHeureSupplementaire(activeCompanyId, ouvrierId, selectedDate, data);
      if (res.success) {
        return {
          success: true,
          item: res.item,
          isUpdated: res.isUpdated,
          message: res.isUpdated ? 'Entrée mise à jour avec succès !' : 'Enregistrement réussi !',
        };
      }
      return { success: false, message: res.error || 'Erreur lors de l\'enregistrement.' };
    },
    [activeCompanyId, selectedDate]
  );

  // Enregistrer une entrée en heures supplémentaires (rétro-compatibilité)
  const pointHeuresSupp = useCallback(
    (ouvrierId: string, heures?: number | null): { success: boolean; message?: string } => {
      const res = storage.addHeureSupplementaire(activeCompanyId, ouvrierId, selectedDate, heures);
      if (res.success) {
        return { success: true, message: 'Heures supplémentaires enregistrées avec succès !' };
      }
      return { success: false, message: res.error || 'Erreur lors de l\'enregistrement.' };
    },
    [activeCompanyId, selectedDate]
  );

  // Supprimer une entrée en heures supplémentaires
  const removeHeureSupp = useCallback((id: string) => {
    storage.deleteHeureSupplementaire(id);
  }, []);

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
      return storage.setStockInitialGazoil(activeCompanyId, stockInitial);
    },
    [activeCompanyId]
  );

  const setSeuilAlerteGazoil = useCallback(
    (seuil: number) => {
      return storage.setSeuilAlerteGazoil(activeCompanyId, seuil);
    },
    [activeCompanyId]
  );

  const addGazoilMouvement = useCallback(
    (mvt: {
      type: GazoilMouvementType;
      date: string;
      quantite: number;
      engin_ou_tache?: string;
      remarque?: string;
    }) => {
      return storage.addGazoilMouvement(activeCompanyId, mvt);
    },
    [activeCompanyId]
  );

  const deleteGazoilMouvement = useCallback(
    (id: string) => {
      storage.deleteGazoilMouvement(activeCompanyId, id);
    },
    [activeCompanyId]
  );

  const lancerCommandeGazoil = useCallback(
    (quantite: number, dateStr: string, tel?: string) => {
      storage.lancerCommandeGazoil(activeCompanyId, quantite, dateStr, tel);
    },
    [activeCompanyId]
  );

  const cloturerCommandeGazoil = useCallback(() => {
    storage.cloturerCommandeGazoil(activeCompanyId);
  }, [activeCompanyId]);

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
    (data: { id?: string; code: string; nom: string; actif?: boolean }) => {
      return storage.saveSerre(activeCompanyId, data);
    },
    [activeCompanyId]
  );

  const deleteSerre = useCallback((id: string) => {
    return storage.deleteSerre(id);
  }, []);

  const toggleSerreActif = useCallback((id: string) => {
    storage.toggleSerreActif(id);
  }, []);

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
      return storage.addRecolteEntries(activeCompanyId, entries, author);
    },
    [activeCompanyId]
  );

  const updateRecolte = useCallback(
    (
      id: string,
      partial: { caisses?: number; notes?: string; date?: string; serre_id?: string; serre_nom?: string },
      updatedBy: { id: string; nom: string }
    ) => {
      return storage.updateRecolteEntry(id, partial, updatedBy);
    },
    []
  );

  const deleteRecolte = useCallback((id: string) => {
    return storage.deleteRecolteEntry(id);
  }, []);

  const syncRecolte = useCallback(async () => {
    return await storage.syncRecolteWithServer(activeCompanyId);
  }, [activeCompanyId]);

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
    pointesDetails,
    pointesOuvrierIds,
    heuresSupplementaires,
    heuresSuppDetails,
    stats,
    recapWhatsAppText,
    checkWorkerByNumber,
    pointWorker,
    setTaskWorkers,
    removeWorkerFromTask,
    assignWorkerToTask,
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
