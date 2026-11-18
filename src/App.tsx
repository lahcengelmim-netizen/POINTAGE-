/**
 * Application principale Lahcen Pointeur
 * Conçue pour smartphone Android, utilisable d'une seule main et hors-ligne (PWA)
 * Système multi-comptes sécurisé (Administrateur & Caporal) et module Récolte
 */

import { useState, useEffect } from 'react';
import { useAgriPointage } from './hooks/useAgriPointage';
import { Header } from './components/Header';
import { StatsBar } from './components/StatsBar';
import { Navigation, ActiveScreen } from './components/Navigation';
import { PointageMatin } from './components/PointageMatin';
import { EcranTaches } from './components/EcranTaches';
import { AbsencesView } from './components/AbsencesView';
import { RecapWhatsApp } from './components/RecapWhatsApp';
import { SuiviGazoil } from './components/SuiviGazoil';
import { GestionPatron } from './components/GestionPatron';
import { HelpModal } from './components/HelpModal';
import { HeuresSupplementairesModal } from './components/HeuresSupplementairesModal';
import { RecolteCaporal } from './components/RecolteCaporal';
import { RecolteAdminDashboard } from './components/RecolteAdminDashboard';
import { LoginModal } from './components/LoginModal';
import { LoginPage } from './components/LoginPage';
import { StockProDashboard } from './components/StockPro/StockProDashboard';
import { HeuresSupplementairesView } from './components/HeuresSupplementairesView';
import { TachesSupplementairesView } from './components/TachesSupplementairesView';
import { SupplementairesAdminModule } from './components/Supplementaires/SupplementairesAdminModule';
import { ContractuellesModule } from './components/Contractuelles/ContractuellesModule';
import { ExportPaiementView } from './components/ExportPaiementView';
import { useUser } from './context/UserContext';
import { syncBidirectionalAll } from './services/globalSyncService';
import { HelpCircle, AlertTriangle, ShieldAlert, Database } from 'lucide-react';

export default function App() {
  const {
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
    updatePointage,
    updateTask,
    saveDomaine,
    deleteDomaine,
    updateDomainesOrder,
    setDefaultDomaineId,
    removePointage,
    checkWorkerForHeuresSupp,
    saveHeureSupp,
    pointHeuresSupp,
    removeHeureSupp,
    // Gazoil
    gazoilStatus,
    gazoilMouvements,
    setStockInitialGazoil,
    addGazoilMouvement,
    deleteGazoilMouvement,
    lancerCommandeGazoil,
    cloturerCommandeGazoil,
    // Quota Stockage
    storageQuotaError,
    clearStorageQuotaError,
    // Multi-comptes
    currentUser,
    users,
    switchUser,
    logout,
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
  } = useAgriPointage();

  const { user, loading } = useUser();

  const activeUser = user || currentUser;

  const [activeScreen, setActiveScreen] = useState<ActiveScreen>(() => {
    if (
      activeUser.role === 'caporal_contractuelles' ||
      activeUser.module_attribue === 'contractuelles' ||
      activeUser.username === 'tariq'
    ) {
      return 'contractuelles';
    }
    return activeUser.role === 'caporal' ? 'recolte' : 'pointage';
  });
  const [showHelpModal, setShowHelpModal] = useState<boolean>(false);
  const [showHeuresSuppModal, setShowHeuresSuppModal] = useState<boolean>(false);
  const [showLoginModal, setShowLoginModal] = useState<boolean>(false);
  const [adminRecolteSubMode, setAdminRecolteSubMode] = useState<'dashboard' | 'saisie'>('dashboard');

  const isCaporalContractuel =
    activeUser.role === 'caporal_contractuelles' ||
    activeUser.module_attribue === 'contractuelles' ||
    activeUser.username === 'tariq';
  const isCaporal = activeUser.role === 'caporal' && !isCaporalContractuel;
  const isAnyCaporal = isCaporal || isCaporalContractuel;

  // RÈGLE D'AUTORISATION STRICTE :
  // - Le caporal Contractuelles a accès UNIQUEMENT à 'contractuelles'.
  // - Le caporal Récolte a accès aux modules 'recolte', 'heures_supp', et 'taches_supp'.
  // - S'ils tentent d'accéder à un écran non autorisé, les rediriger vers leur écran respectif.
  useEffect(() => {
    if (isCaporalContractuel) {
      if (activeScreen !== 'contractuelles') {
        setActiveScreen('contractuelles');
      }
    } else if (isCaporal && !['recolte', 'heures_supp', 'taches_supp'].includes(activeScreen)) {
      setActiveScreen('recolte');
    }
  }, [isCaporalContractuel, isCaporal, activeScreen]);

  // Synchronisation bidirectionnelle globale (session, reconnexion réseau, retour premier plan, intervalle)
  // Respecte strictement le cloisonnement company_id et les permissions par rôle (Admin / Caporal / Contractuelles).
  useEffect(() => {
    if (!user || !currentCompany?.id) return;

    const triggerGlobalSync = () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      syncBidirectionalAll({
        companyId: currentCompany.id,
        user: activeUser,
        dateIso: selectedDate,
      }).catch(() => {});
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        triggerGlobalSync();
      }
    };

    triggerGlobalSync();
    window.addEventListener('online', triggerGlobalSync);
    document.addEventListener('visibilitychange', handleVisibility);
    const intervalId = window.setInterval(triggerGlobalSync, 5 * 60 * 1000);

    return () => {
      window.removeEventListener('online', triggerGlobalSync);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.clearInterval(intervalId);
    };
  }, [user?.id, currentCompany?.id, activeUser.role, activeUser.module_attribue, activeUser.username, selectedDate]);

  // Protection d'écran d'accès obligatoire avant ouverture de l'application
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-emerald-50 via-white to-emerald-100 text-emerald-950 flex flex-col items-center justify-center p-4 selection:bg-emerald-600 font-sans">
        <div className="w-full max-w-[240px] sm:max-w-[280px] bg-white rounded-3xl p-4 shadow-xl border border-emerald-200/80 mb-4 flex items-center justify-center">
          <img
            src="/assets/aistudio/Logo_d_application_agricole_avec_pointage_4d078075.png"
            alt="LAHCEN POINTEUR – POINTAGE AGRICOLE"
            width={1536}
            height={1024}
            loading="eager"
            decoding="async"
            className="w-full h-auto max-h-40 object-contain"
          />
        </div>
        <h1 className="text-xl font-black tracking-wider mb-1 uppercase text-emerald-950">
          LAHCEN <span className="text-orange-600">POINTEUR</span>
        </h1>
        <p className="text-[11px] font-bold tracking-widest uppercase text-emerald-700 mb-3">
          POINTAGE AGRICOLE
        </p>
        <div className="flex items-center gap-2 text-xs font-semibold text-emerald-800">
          <div className="w-4 h-4 border-2 border-emerald-600/30 border-t-emerald-700 rounded-full animate-spin" />
          <span>Vérification de la session en cours...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <div className="min-h-screen bg-slate-200/80 text-slate-900 flex justify-center selection:bg-emerald-500 selection:text-white">
      {/* Conteneur mobile centré (émule un smartphone sur grand écran et 100% plein écran sur mobile) */}
      <div className="w-full max-w-md min-h-screen bg-slate-100 flex flex-col shadow-2xl relative">
        {/* En-tête avec exploitation, date et compte connecté */}
        <Header
          currentCompany={currentCompany}
          companies={companies}
          onSwitchCompany={switchCompany}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          onOpenHeuresSupp={() => setShowHeuresSuppModal(true)}
          heuresSuppCount={heuresSupplementaires.length}
          currentUser={activeUser}
          onOpenLoginModal={() => setShowLoginModal(true)}
        />

        {/* Barre de statistiques : visible uniquement pour l'administrateur */}
        {!isAnyCaporal && <StatsBar stats={stats} />}

        {/* Alerte Quota Stockage si la mémoire locale du navigateur est saturée */}
        {storageQuotaError && (
          <div className="mx-3 mt-2 p-3 bg-red-600 text-white rounded-2xl shadow-lg flex items-start justify-between gap-2 text-xs font-bold animate-pulse">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-yellow-300" />
              <div>
                <p className="font-black text-sm">Mémoire saturée (Quota dépassé)</p>
                <p className="text-[11px] font-normal leading-relaxed opacity-95">
                  Le stockage local du navigateur est plein. Veuillez exporter une sauvegarde JSON dans l'écran Gestion, puis nettoyer les anciens historiques pour continuer à enregistrer sereinement.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={clearStorageQuotaError}
              className="text-white hover:text-red-200 p-1 text-sm font-bold shrink-0"
              title="Fermer cette notification"
            >
              ✕
            </button>
          </div>
        )}

        {/* Contenu principal de l'écran actif */}
        <main className="flex-1 p-3 overflow-y-auto">
          {/* ===================== ÉCRAN RÉCOLTE ===================== */}
          {activeScreen === 'recolte' && (
            isCaporalContractuel ? (
              <AccessDeniedScreen isContractuel onGoToRecolte={() => setActiveScreen('contractuelles')} />
            ) : (
            <>
              {isCaporal ? (
                // Vue Caporal : Saisie rapide et synthèse de ses caisses
                <RecolteCaporal
                  currentUser={activeUser}
                  activeOuvriers={activeOuvriers}
                  serres={serres}
                  domaines={domaines}
                  recoltes={allRecoltes}
                  selectedDate={selectedDate}
                  onSelectDate={setSelectedDate}
                  onAddRecolte={addRecolte}
                  onUpdateRecolte={updateRecolte}
                  onDeleteRecolte={deleteRecolte}
                  onSync={syncRecolte}
                />
              ) : (
                // Vue Administrateur : Choix entre Supervision / Dashboard et Saisie de terrain
                <div className="space-y-3">
                  <div className="bg-white p-1 rounded-2xl border border-slate-200 flex text-xs font-bold shadow-2xs">
                    <button
                      type="button"
                      onClick={() => setAdminRecolteSubMode('dashboard')}
                      className={`flex-1 py-1.5 rounded-xl transition ${
                        adminRecolteSubMode === 'dashboard'
                          ? 'bg-purple-700 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      📊 Tableau de Bord Récolte
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdminRecolteSubMode('saisie')}
                      className={`flex-1 py-1.5 rounded-xl transition ${
                        adminRecolteSubMode === 'saisie'
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      ✍️ Saisie directe (Terrain)
                    </button>
                  </div>

                  {adminRecolteSubMode === 'dashboard' ? (
                    <RecolteAdminDashboard
                      recoltes={allRecoltes}
                      serres={serres}
                      domaines={domaines}
                      ouvriers={allOuvriers}
                      users={users}
                      selectedDate={selectedDate}
                      onSelectDate={setSelectedDate}
                      onSaveSerre={saveSerre}
                      onDeleteSerre={deleteSerre}
                      onToggleSerreActif={toggleSerreActif}
                      onDeleteRecolte={deleteRecolte}
                    />
                  ) : (
                    <RecolteCaporal
                      currentUser={activeUser}
                      activeOuvriers={activeOuvriers}
                      serres={serres}
                      domaines={domaines}
                      recoltes={allRecoltes}
                      selectedDate={selectedDate}
                      onSelectDate={setSelectedDate}
                      onAddRecolte={addRecolte}
                      onUpdateRecolte={updateRecolte}
                      onDeleteRecolte={deleteRecolte}
                      onSync={syncRecolte}
                    />
                  )}
                </div>
              )}
            </>
            )
          )}

          {/* ===================== ÉCRAN HEURES SUPPLÉMENTAIRES ===================== */}
          {activeScreen === 'heures_supp' && (
            <HeuresSupplementairesView
              currentUser={activeUser}
              allOuvriers={allOuvriers}
              taches={taches}
              domaines={domaines}
              serres={serres}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
            />
          )}

          {/* ===================== ÉCRAN TÂCHES SUPPLÉMENTAIRES ===================== */}
          {activeScreen === 'taches_supp' && (
            <TachesSupplementairesView
              currentUser={activeUser}
              allOuvriers={allOuvriers}
              taches={taches}
              domaines={domaines}
              serres={serres}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
            />
          )}

          {/* ===================== ÉCRANS ADMINISTRATIFS (RÉSERVÉS ADMIN) ===================== */}
          {activeScreen === 'pointage' && (
            isAnyCaporal ? (
              <AccessDeniedScreen isContractuel={isCaporalContractuel} onGoToRecolte={() => setActiveScreen(isCaporalContractuel ? 'contractuelles' : 'recolte')} />
            ) : (
              <PointageMatin
                activeOuvriers={activeOuvriers}
                ouvriersRestants={ouvriersRestants}
                pointesDetails={pointesDetails}
                taches={taches}
                domaines={domaines}
                serres={serres}
                defaultDomaineId={defaultDomaineId}
                checkWorkerByNumber={checkWorkerByNumber}
                onPointWorker={pointWorker}
                onAssignWorkerToTask={assignWorkerToTask}
                onUpdateAffectation={updateAffectation}
                onRemoveAffectation={removeAffectation}
                onUpdatePointage={updatePointage}
                onUpdateTask={updateTask}
                onRemovePointage={removePointage}
                selectedDate={selectedDate}
                onOpenHeuresSupp={!isCaporal ? () => setShowHeuresSuppModal(true) : undefined}
                heuresSuppCount={!isCaporal ? heuresSupplementaires.length : 0}
                gazoilStatus={gazoilStatus}
                onNavigateGazoil={() => setActiveScreen('gazoil')}
                onNavigateGestion={() => setActiveScreen('gestion')}
                pointageFinancier={pointageFinancier}
              />
            )
          )}

          {activeScreen === 'taches' && (
            isAnyCaporal ? (
              <AccessDeniedScreen isContractuel={isCaporalContractuel} onGoToRecolte={() => setActiveScreen(isCaporalContractuel ? 'contractuelles' : 'recolte')} />
            ) : (
              <EcranTaches
                taches={taches}
                pointagesDuJour={pointages}
                activeOuvriers={activeOuvriers}
                affectationsDuJour={affectations}
                domaines={domaines}
                serres={serres}
                tacheSerresConfigs={tacheSerresConfigs}
                defaultDomaineId={defaultDomaineId}
                onSetTaskWorkers={setTaskWorkers}
                onSaveTaskSerres={saveTaskSerres}
                onRemoveWorkerFromTask={removeWorkerFromTask}
                onNavigateToPointage={() => setActiveScreen('pointage')}
                selectedDate={selectedDate}
              />
            )
          )}

          {activeScreen === 'absences' && (
            isAnyCaporal ? (
              <AccessDeniedScreen isContractuel={isCaporalContractuel} onGoToRecolte={() => setActiveScreen(isCaporalContractuel ? 'contractuelles' : 'recolte')} />
            ) : (
              <AbsencesView
                absents={absents}
                totalActifs={stats.totalActifs}
                totalPointes={stats.pointes}
                taches={taches}
                domaines={domaines}
                serres={serres}
                defaultDomaineId={defaultDomaineId}
                onPointWorker={pointWorker}
                onUpdateTask={updateTask}
                selectedDate={selectedDate}
              />
            )
          )}

          {/* ===================== ÉCRAN CONTRACTUELLES (NOUVEAU MODULE INDÉPENDANT) ===================== */}
          {activeScreen === 'contractuelles' && (
            isCaporal && !isCaporalContractuel ? (
              <AccessDeniedScreen onGoToRecolte={() => setActiveScreen('recolte')} />
            ) : (
              <ContractuellesModule
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
                domaines={domaines}
                serres={serres}
                taches={taches}
                currentUser={activeUser}
              />
            )
          )}

          {/* ===================== ÉCRAN STOCK PRO (RÉSERVÉ ADMIN) ===================== */}
          {activeScreen === 'stock' && (
            isAnyCaporal ? (
              <AccessDeniedScreen isContractuel={isCaporalContractuel} onGoToRecolte={() => setActiveScreen(isCaporalContractuel ? 'contractuelles' : 'recolte')} />
            ) : (
              <StockProDashboard
                currentUser={activeUser}
                domaines={domaines}
              />
            )
          )}

          {/* ===================== ÉCRAN SUPPLÉMENTAIRES (RÉSERVÉ ADMIN) ===================== */}
          {activeScreen === 'supplementaires' && (
            isAnyCaporal ? (
              <AccessDeniedScreen isContractuel={isCaporalContractuel} onGoToRecolte={() => setActiveScreen(isCaporalContractuel ? 'contractuelles' : 'recolte')} />
            ) : (
              <SupplementairesAdminModule
                currentUser={activeUser}
                allOuvriers={allOuvriers}
                taches={taches}
                domaines={domaines}
                serres={serres}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
              />
            )
          )}

          {/* ===================== ÉCRAN EXPORT PAIEMENT EXCEL (RÉSERVÉ ADMIN) ===================== */}
          {activeScreen === 'export_paiement' && (
            isAnyCaporal ? (
              <AccessDeniedScreen
                isContractuel={isCaporalContractuel}
                onGoToRecolte={() => setActiveScreen(isCaporalContractuel ? 'contractuelles' : 'recolte')}
              />
            ) : (
              <ExportPaiementView
                currentUser={activeUser}
                currentCompany={currentCompany}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
                allOuvriers={allOuvriers}
                taches={taches}
                domaines={domaines}
                serres={serres}
                defaultDomaineId={defaultDomaineId}
                allRecoltes={allRecoltes}
                tacheSerresConfigs={tacheSerresConfigs}
              />
            )
          )}

          {activeScreen === 'gazoil' && (
            isAnyCaporal ? (
              <AccessDeniedScreen isContractuel={isCaporalContractuel} onGoToRecolte={() => setActiveScreen(isCaporalContractuel ? 'contractuelles' : 'recolte')} />
            ) : (
              <SuiviGazoil
                companyName={currentCompany.nom}
                gazoilStatus={gazoilStatus}
                mouvements={gazoilMouvements}
                onSetStockInitial={setStockInitialGazoil}
                onAddMouvement={addGazoilMouvement}
                onDeleteMouvement={deleteGazoilMouvement}
                onLancerCommande={lancerCommandeGazoil}
                onCloturerCommande={cloturerCommandeGazoil}
                onOpenGestion={() => setActiveScreen('gestion')}
              />
            )
          )}

          {activeScreen === 'recap' && (
            isAnyCaporal ? (
              <AccessDeniedScreen isContractuel={isCaporalContractuel} onGoToRecolte={() => setActiveScreen(isCaporalContractuel ? 'contractuelles' : 'recolte')} />
            ) : (
              <RecapWhatsApp
                recapText={recapWhatsAppText}
                selectedDate={selectedDate}
                totalPointes={stats.pointes}
                totalAbsents={stats.restants}
                totalSupp={heuresSupplementaires.length}
                pointageFinancier={pointageFinancier}
                pointesDetails={pointesDetails}
              />
            )
          )}

          {activeScreen === 'gestion' && (
            isAnyCaporal ? (
              <AccessDeniedScreen isContractuel={isCaporalContractuel} onGoToRecolte={() => setActiveScreen(isCaporalContractuel ? 'contractuelles' : 'recolte')} />
            ) : (
              <GestionPatron
                currentCompany={currentCompany}
                companies={companies}
                onSwitchCompany={switchCompany}
                allOuvriers={allOuvriers}
                taches={taches}
                domaines={domaines}
                defaultDomaineId={defaultDomaineId}
                onSaveDomaine={saveDomaine}
                onDeleteDomaine={deleteDomaine}
                onUpdateDomainesOrder={updateDomainesOrder}
                onSetDefaultDomaineId={setDefaultDomaineId}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
              />
            )
          )}

          {/* Accès direct sécurisé à l'outil de sauvetage intégral */}
          <div className="mt-4 pt-3 border-t border-slate-200/80 pb-2">
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('lahcen:open-recovery'))}
              className="w-full py-2 px-3 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-950 font-black text-[11px] rounded-xl flex items-center justify-center gap-1.5 transition cursor-pointer"
            >
              <Database className="w-3.5 h-3.5 text-amber-700 shrink-0" />
              <span>RÉCUPÉRATION DES DONNÉES — MODE SÉCURISÉ</span>
            </button>
          </div>
        </main>

        {/* Bouton Flottant d'Aide & Guide de test (pour Administrateur) */}
        {!isAnyCaporal && (
          <button
            type="button"
            onClick={() => setShowHelpModal(true)}
            className="fixed bottom-18 right-4 sm:right-[calc(50%-200px)] z-30 bg-emerald-800 hover:bg-emerald-900 text-white p-2.5 rounded-full shadow-lg border-2 border-emerald-500/50 flex items-center justify-center transition active:scale-95 cursor-pointer"
            title="Guide & Comment tester"
          >
            <HelpCircle className="w-5 h-5 text-emerald-200" />
          </button>
        )}

        {/* Modale Pointage des Heures Supplémentaires */}
        {!isAnyCaporal && (
          <HeuresSupplementairesModal
            isOpen={showHeuresSuppModal}
            onClose={() => setShowHeuresSuppModal(false)}
            activeOuvriers={activeOuvriers}
            allOuvriers={allOuvriers}
            taches={taches}
            domaines={domaines}
            serres={serres}
            currentUser={activeUser}
            heuresSuppDetails={heuresSuppDetails}
            allHeuresSupplementaires={allHeuresSupplementaires}
            checkWorkerForHeuresSupp={checkWorkerForHeuresSupp}
            onSaveHeureSupp={saveHeureSupp}
            onRemoveHeureSupp={removeHeureSupp}
            selectedDate={selectedDate}
          />
        )}

        {/* Modale d'aide "Comment tester" */}
        <HelpModal
          isOpen={showHelpModal}
          onClose={() => setShowHelpModal(false)}
        />

        {/* Modale de Connexion / Changement de compte */}
        <LoginModal
          isOpen={showLoginModal}
          onClose={() => setShowLoginModal(false)}
          currentUser={activeUser}
          companyName={currentCompany.nom}
          onLoginSuccess={(user) => {
            switchUser(user);
            if (user.role === 'caporal_contractuelles' || user.module_attribue === 'contractuelles') {
              setActiveScreen('contractuelles');
            } else if (user.role === 'caporal') {
              setActiveScreen('recolte');
            }
          }}
          onLogout={logout}
        />

        {/* Barre de navigation inférieure fixe */}
        <Navigation
          activeScreen={activeScreen}
          onSelectScreen={setActiveScreen}
          absentsCount={stats.restants}
          gazoilAlert={gazoilStatus.isStockBas}
          currentUserRole={isCaporalContractuel ? 'caporal_contractuelles' : activeUser.role}
          currentUserModule={activeUser.module_attribue}
          onOpenAccountModal={() => setShowLoginModal(true)}
        />
      </div>
    </div>
  );
}

/**
 * Écran de blocage d'autorisation si un Caporal tente d'accéder à un écran administratif
 */
function AccessDeniedScreen({
  onGoToRecolte,
  isContractuel = false,
}: {
  onGoToRecolte: () => void;
  isContractuel?: boolean;
}) {
  return (
    <div className="bg-white rounded-3xl p-6 text-center border-2 border-amber-300 shadow-md space-y-3 animate-in fade-in">
      <div className="w-12 h-12 bg-amber-100 text-amber-700 rounded-2xl flex items-center justify-center mx-auto">
        <ShieldAlert className="w-7 h-7" />
      </div>
      <h3 className="font-black text-slate-900 text-sm">Accès Réservé à l'Administrateur</h3>
      <p className="text-xs text-slate-600 leading-relaxed">
        {isContractuel ? (
          <>
            Votre compte <strong>Caporal Contractuelles</strong> a un accès strictement dédié au module Contractuelles.
            Les autres modules sont administrés par le patron.
          </>
        ) : (
          <>
            Votre compte <strong>Caporal</strong> a un accès strictement dédié à la gestion de la récolte.
            Les paramètres et le pointage général sont administrés par le patron.
          </>
        )}
      </p>
      <button
        type="button"
        onClick={onGoToRecolte}
        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black py-2.5 rounded-xl text-xs transition shadow-xs"
      >
        {isContractuel ? 'Aller au module Contractuelles' : 'Aller au module Récolte'}
      </button>
    </div>
  );
}
