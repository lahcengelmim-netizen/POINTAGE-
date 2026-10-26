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
import { HelpCircle, AlertTriangle, ShieldAlert } from 'lucide-react';

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
    pointesDetails,
    heuresSupplementaires,
    heuresSuppDetails,
    stats,
    recapWhatsAppText,
    checkWorkerByNumber,
    pointWorker,
    setTaskWorkers,
    removeWorkerFromTask,
    assignWorkerToTask,
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

  const [activeScreen, setActiveScreen] = useState<ActiveScreen>(() => {
    return currentUser.role === 'caporal' ? 'recolte' : 'pointage';
  });
  const [showHelpModal, setShowHelpModal] = useState<boolean>(false);
  const [showHeuresSuppModal, setShowHeuresSuppModal] = useState<boolean>(false);
  const [showLoginModal, setShowLoginModal] = useState<boolean>(false);
  const [adminRecolteSubMode, setAdminRecolteSubMode] = useState<'dashboard' | 'saisie'>('dashboard');

  // RÈGLE D'AUTORISATION STRICTE :
  // Si le caporal est connecté, forcer l'écran sur 'recolte'
  useEffect(() => {
    if (currentUser.role === 'caporal' && activeScreen !== 'recolte') {
      setActiveScreen('recolte');
    }
  }, [currentUser.role, activeScreen]);

  // Synchronisation en arrière-plan à la reconnexion internet
  useEffect(() => {
    const handleOnline = () => {
      syncRecolte().catch(() => {});
    };
    window.addEventListener('online', handleOnline);
    // Première synchronisation au chargement
    if (navigator.onLine) {
      syncRecolte().catch(() => {});
    }
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [syncRecolte]);

  // Vérification de sécurité pour empêcher un caporal d'accéder aux écrans d'administration
  const isCaporal = currentUser.role === 'caporal';

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
          currentUser={currentUser}
          onOpenLoginModal={() => setShowLoginModal(true)}
        />

        {/* Barre de statistiques : visible uniquement pour l'administrateur */}
        {!isCaporal && <StatsBar stats={stats} />}

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
            <>
              {isCaporal ? (
                // Vue Caporal : Saisie rapide et synthèse de ses caisses
                <RecolteCaporal
                  currentUser={currentUser}
                  activeOuvriers={activeOuvriers}
                  serres={serres}
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
                      currentUser={currentUser}
                      activeOuvriers={activeOuvriers}
                      serres={serres}
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
          )}

          {/* ===================== ÉCRANS ADMINISTRATIFS (RÉSERVÉS ADMIN) ===================== */}
          {activeScreen === 'pointage' && (
            isCaporal ? (
              <AccessDeniedScreen onGoToRecolte={() => setActiveScreen('recolte')} />
            ) : (
              <PointageMatin
                activeOuvriers={activeOuvriers}
                ouvriersRestants={ouvriersRestants}
                pointesDetails={pointesDetails}
                taches={taches}
                domaines={domaines}
                defaultDomaineId={defaultDomaineId}
                checkWorkerByNumber={checkWorkerByNumber}
                onPointWorker={pointWorker}
                onUpdatePointage={updatePointage}
                onUpdateTask={updateTask}
                onRemovePointage={removePointage}
                selectedDate={selectedDate}
                onOpenHeuresSupp={() => setShowHeuresSuppModal(true)}
                heuresSuppCount={heuresSupplementaires.length}
                gazoilStatus={gazoilStatus}
                onNavigateGazoil={() => setActiveScreen('gazoil')}
                onNavigateGestion={() => setActiveScreen('gestion')}
              />
            )
          )}

          {activeScreen === 'taches' && (
            isCaporal ? (
              <AccessDeniedScreen onGoToRecolte={() => setActiveScreen('recolte')} />
            ) : (
              <EcranTaches
                taches={taches}
                pointagesDuJour={pointages}
                activeOuvriers={activeOuvriers}
                affectationsDuJour={affectations}
                domaines={domaines}
                defaultDomaineId={defaultDomaineId}
                onSetTaskWorkers={setTaskWorkers}
                onRemoveWorkerFromTask={removeWorkerFromTask}
                onNavigateToPointage={() => setActiveScreen('pointage')}
                selectedDate={selectedDate}
              />
            )
          )}

          {activeScreen === 'absences' && (
            isCaporal ? (
              <AccessDeniedScreen onGoToRecolte={() => setActiveScreen('recolte')} />
            ) : (
              <AbsencesView
                absents={absents}
                totalActifs={stats.totalActifs}
                totalPointes={stats.pointes}
                taches={taches}
                domaines={domaines}
                defaultDomaineId={defaultDomaineId}
                onPointWorker={pointWorker}
                onUpdateTask={updateTask}
                selectedDate={selectedDate}
              />
            )
          )}

          {activeScreen === 'gazoil' && (
            isCaporal ? (
              <AccessDeniedScreen onGoToRecolte={() => setActiveScreen('recolte')} />
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
            isCaporal ? (
              <AccessDeniedScreen onGoToRecolte={() => setActiveScreen('recolte')} />
            ) : (
              <RecapWhatsApp
                recapText={recapWhatsAppText}
                selectedDate={selectedDate}
                totalPointes={stats.pointes}
                totalAbsents={stats.restants}
                totalSupp={heuresSupplementaires.length}
              />
            )
          )}

          {activeScreen === 'gestion' && (
            isCaporal ? (
              <AccessDeniedScreen onGoToRecolte={() => setActiveScreen('recolte')} />
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
        </main>

        {/* Bouton Flottant d'Aide & Guide de test (pour Administrateur) */}
        {!isCaporal && (
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
        {!isCaporal && (
          <HeuresSupplementairesModal
            isOpen={showHeuresSuppModal}
            onClose={() => setShowHeuresSuppModal(false)}
            activeOuvriers={activeOuvriers}
            taches={taches}
            heuresSuppDetails={heuresSuppDetails}
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
          currentUser={currentUser}
          onLoginSuccess={(user) => {
            switchUser(user);
            if (user.role === 'caporal') {
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
          currentUserRole={currentUser.role}
          onOpenAccountModal={() => setShowLoginModal(true)}
        />
      </div>
    </div>
  );
}

/**
 * Écran de blocage d'autorisation si un Caporal tente d'accéder à un écran administratif
 */
function AccessDeniedScreen({ onGoToRecolte }: { onGoToRecolte: () => void }) {
  return (
    <div className="bg-white rounded-3xl p-6 text-center border-2 border-amber-300 shadow-md space-y-3 animate-in fade-in">
      <div className="w-12 h-12 bg-amber-100 text-amber-700 rounded-2xl flex items-center justify-center mx-auto">
        <ShieldAlert className="w-7 h-7" />
      </div>
      <h3 className="font-black text-slate-900 text-sm">Accès Réservé à l'Administrateur</h3>
      <p className="text-xs text-slate-600 leading-relaxed">
        Votre compte <strong>Caporal</strong> a un accès strictement dédié à la gestion de la récolte.
        Les paramètres et le pointage général sont administrés par le patron.
      </p>
      <button
        type="button"
        onClick={onGoToRecolte}
        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black py-2.5 rounded-xl text-xs transition shadow-xs"
      >
        Aller au module Récolte
      </button>
    </div>
  );
}
