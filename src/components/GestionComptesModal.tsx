/**
 * Modale de gestion des comptes d'utilisateurs et des caporals
 * Accessible UNIQUEMENT par l'administrateur dans l'écran Gestion
 */

import React, { useState } from 'react';
import { X, Users, UserPlus, Trash2, Key, CheckCircle2, AlertCircle, ShieldAlert, Phone } from 'lucide-react';
import { UserAccount, UserRole } from '../types';

interface GestionComptesModalProps {
  isOpen: boolean;
  onClose: () => void;
  users: UserAccount[];
  onSaveUser: (data: {
    id?: string;
    username: string;
    nom: string;
    role: UserRole;
    password?: string;
    actif?: boolean;
    telephone?: string;
  }) => Promise<{ success: boolean; error?: string; user?: UserAccount }>;
  onToggleUserActif: (id: string) => { success: boolean; error?: string; actif?: boolean };
  onDeleteUser: (id: string) => { success: boolean; error?: string };
}

export const GestionComptesModal: React.FC<GestionComptesModalProps> = ({
  isOpen,
  onClose,
  users,
  onSaveUser,
  onToggleUserActif,
  onDeleteUser,
}) => {
  const [showForm, setShowForm] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [nom, setNom] = useState('');
  const [password, setPassword] = useState('');
  const [telephone, setTelephone] = useState('');
  const [role, setRole] = useState<UserRole>('caporal');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Modale de réinitialisation de mot de passe
  const [resetModalUser, setResetModalUser] = useState<UserAccount | null>(null);
  const [newPassword, setNewPassword] = useState('');

  if (!isOpen) return null;

  const handleOpenAddForm = () => {
    setEditingUserId(null);
    setUsername('');
    setNom('');
    setPassword('');
    setTelephone('');
    setRole('caporal');
    setError(null);
    setShowForm(true);
  };

  const handleOpenEdit = (user: UserAccount) => {
    setEditingUserId(user.id);
    setUsername(user.username);
    setNom(user.nom);
    setPassword('');
    setTelephone(user.telephone || '');
    setRole(user.role);
    setError(null);
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const res = await onSaveUser({
      id: editingUserId || undefined,
      username,
      nom,
      role,
      password: password || undefined,
      telephone,
    });

    if (!res.success) {
      setError(res.error || "Erreur lors de l'enregistrement.");
      return;
    }

    setSuccess(editingUserId ? 'Utilisateur modifié avec succès !' : 'Nouveau compte créé !');
    setShowForm(false);
    setTimeout(() => setSuccess(null), 3000);
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetModalUser || !newPassword.trim()) return;

    if (newPassword.trim().length < 4) {
      setError('Le mot de passe doit comporter au moins 4 caractères.');
      return;
    }

    const res = await onSaveUser({
      id: resetModalUser.id,
      username: resetModalUser.username,
      nom: resetModalUser.nom,
      role: resetModalUser.role,
      password: newPassword.trim(),
    });

    if (!res.success) {
      setError(res.error || 'Erreur lors de la réinitialisation.');
      return;
    }

    setSuccess(`Mot de passe réinitialisé pour ${resetModalUser.nom} !`);
    setResetModalUser(null);
    setNewPassword('');
    setTimeout(() => setSuccess(null), 3500);
  };

  const handleDelete = (user: UserAccount) => {
    if (user.id === 'usr_admin') {
      alert('Impossible de supprimer le compte administrateur principal.');
      return;
    }
    if (window.confirm(`Supprimer définitivement le compte de ${user.nom} (${user.username}) ?`)) {
      const res = onDeleteUser(user.id);
      if (!res.success) {
        alert(res.error || 'Erreur lors de la suppression.');
      } else {
        setSuccess(`Compte "${user.username}" supprimé.`);
        setTimeout(() => setSuccess(null), 3000);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white rounded-3xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border border-slate-200">
        {/* En-tête */}
        <div className="bg-slate-900 text-white p-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-600 flex items-center justify-center text-white font-black text-sm">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-black text-sm">Gestion des Comptes & Caporals</h3>
              <p className="text-[11px] text-slate-400">Rôles, identifiants et permissions</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-full transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Corps défilable */}
        <div className="p-4 overflow-y-auto space-y-4 text-xs">
          {success && (
            <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-950 rounded-xl font-bold flex items-center gap-1.5 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{success}</span>
            </div>
          )}

          {error && (
            <div className="p-2.5 bg-red-50 border border-red-200 text-red-900 rounded-xl font-bold flex items-center gap-1.5 animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Règle de sécurité & permissions */}
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 text-[11px] text-emerald-900 space-y-1">
            <span className="font-black text-emerald-950 block">Règles d'accès :</span>
            <p>
              • <strong>Administrateur :</strong> Accès total (Pointage, Tâches, Absences, Récolte, Gazoil, WhatsApp, Gestion).
            </p>
            <p>
              • <strong>Caporal :</strong> Accès <em>strictement limité</em> au module de Récolte et à la synthèse de ses caisses. Aucun accès aux paramètres, aux ouvriers, au pointage du matin ni aux données sensibles.
            </p>
          </div>

          {/* Bouton Ajouter */}
          {!showForm && (
            <button
              type="button"
              onClick={handleOpenAddForm}
              className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-black py-2.5 rounded-xl transition shadow-xs active:scale-98"
            >
              <UserPlus className="w-4 h-4" />
              <span>Créer un nouveau compte Caporal</span>
            </button>
          )}

          {/* Formulaire de création / édition */}
          {showForm && (
            <form onSubmit={handleSave} className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <h4 className="font-black text-slate-900 text-xs">
                  {editingUserId ? "Modifier l'utilisateur" : "Nouveau compte"}
                </h4>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="text-slate-400 hover:text-slate-600 text-xs font-bold"
                >
                  Annuler
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="text-[11px] font-bold text-slate-700 block mb-1">
                    Identifiant de connexion :
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="ex: caporal_brahim"
                    required
                    autoCapitalize="none"
                    className="w-full bg-white border border-slate-300 rounded-xl p-2 font-bold text-slate-800 outline-none focus:border-emerald-600 text-xs"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-700 block mb-1">
                    Nom complet affiché :
                  </label>
                  <input
                    type="text"
                    value={nom}
                    onChange={(e) => setNom(e.target.value)}
                    placeholder="ex: Brahim"
                    required
                    className="w-full bg-white border border-slate-300 rounded-xl p-2 font-bold text-slate-800 outline-none focus:border-emerald-600 text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="text-[11px] font-bold text-slate-700 block mb-1">
                    {editingUserId ? "Nouveau mot de passe (laisser vide si inchangé) :" : "Mot de passe :"}
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Au moins 4 caractères"
                    required={!editingUserId}
                    className="w-full bg-white border border-slate-300 rounded-xl p-2 font-bold text-slate-800 outline-none focus:border-emerald-600 text-xs"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-700 block mb-1">
                    Rôle de l'utilisateur :
                  </label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as UserRole)}
                    disabled={editingUserId === 'usr_admin'}
                    className="w-full bg-white border border-slate-300 rounded-xl p-2 font-bold text-slate-800 outline-none focus:border-emerald-600 text-xs"
                  >
                    <option value="caporal">🌾 Caporal (Module Récolte seul)</option>
                    <option value="admin">👑 Administrateur (Accès complet)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-700 block mb-1">
                  Téléphone (optionnel) :
                </label>
                <input
                  type="tel"
                  value={telephone}
                  onChange={(e) => setTelephone(e.target.value)}
                  placeholder="ex: 06 12 34 56 78"
                  className="w-full bg-white border border-slate-300 rounded-xl p-2 text-slate-800 outline-none focus:border-emerald-600 text-xs font-medium"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold py-2 rounded-xl text-xs transition"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black py-2 rounded-xl text-xs transition shadow-xs"
                >
                  {editingUserId ? 'Mettre à jour' : 'Créer le compte'}
                </button>
              </div>
            </form>
          )}

          {/* Liste des utilisateurs */}
          <div className="space-y-2">
            <h4 className="font-bold text-slate-800 text-xs">
              Comptes configurés ({users.length}) :
            </h4>

            {users.map((u) => {
              const isAdmin = u.role === 'admin';
              return (
                <div
                  key={u.id}
                  className={`p-3 rounded-2xl border transition ${
                    u.actif ? 'bg-white border-slate-200' : 'bg-slate-50 border-slate-200 opacity-60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm ${
                          isAdmin ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {isAdmin ? '👑' : '🌾'}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-black text-slate-900 text-xs">{u.nom}</span>
                          <span
                            className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
                              isAdmin
                                ? 'bg-amber-100 text-amber-900'
                                : 'bg-emerald-100 text-emerald-900'
                            }`}
                          >
                            {isAdmin ? 'Admin' : 'Caporal'}
                          </span>
                          {!u.actif && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold bg-red-100 text-red-700">
                              Désactivé
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono mt-0.5">
                          <span>ID : @{u.username}</span>
                          {u.telephone && <span>• 📞 {u.telephone}</span>}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      {/* Bouton Réinitialiser mot de passe */}
                      <button
                        type="button"
                        onClick={() => {
                          setResetModalUser(u);
                          setNewPassword('');
                          setError(null);
                        }}
                        title="Changer le mot de passe"
                        className="p-1.5 text-slate-400 hover:text-emerald-700 hover:bg-slate-100 rounded-lg transition"
                      >
                        <Key className="w-4 h-4" />
                      </button>

                      {/* Bouton Activer / Désactiver */}
                      {u.id !== 'usr_admin' && (
                        <button
                          type="button"
                          onClick={() => onToggleUserActif(u.id)}
                          title={u.actif ? 'Désactiver le compte' : 'Activer le compte'}
                          className={`px-2 py-1 rounded-lg text-[10px] font-bold transition ${
                            u.actif
                              ? 'bg-slate-100 text-slate-600 hover:bg-amber-100 hover:text-amber-800'
                              : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                          }`}
                        >
                          {u.actif ? 'Désactiver' : 'Activer'}
                        </button>
                      )}

                      {/* Bouton Supprimer */}
                      {u.id !== 'usr_admin' && (
                        <button
                          type="button"
                          onClick={() => handleDelete(u)}
                          title="Supprimer définitivement"
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Modale de réinitialisation de mot de passe */}
        {resetModalUser && (
          <div className="fixed inset-0 z-60 bg-black/70 flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl max-w-xs w-full p-4 shadow-2xl space-y-3 border border-slate-200 animate-in fade-in">
              <div className="flex items-center gap-2 text-slate-900 font-black text-xs">
                <Key className="w-4 h-4 text-emerald-600" />
                <span>Nouveau mot de passe</span>
              </div>
              <p className="text-[11px] text-slate-600">
                Définir un nouveau mot de passe pour <strong>{resetModalUser.nom}</strong> (@{resetModalUser.username}) :
              </p>
              <form onSubmit={handleResetPassword} className="space-y-3">
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Nouveau mot de passe"
                  required
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-bold outline-none focus:border-emerald-600"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setResetModalUser(null)}
                    className="flex-1 bg-slate-100 text-slate-700 py-2 rounded-xl font-bold text-xs"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    className="flex-1 bg-emerald-600 text-white py-2 rounded-xl font-black text-xs shadow-xs"
                  >
                    Valider
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
