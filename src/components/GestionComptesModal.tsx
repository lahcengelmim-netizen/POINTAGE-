/**
 * Modale de gestion des comptes d'utilisateurs et des caporals
 * Accessible UNIQUEMENT par l'administrateur dans l'écran Gestion
 */

import React, { useState, useEffect } from 'react';
import { X, Users, UserPlus, Trash2, Key, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { UserAccount, UserRole } from '../types';
import { supabase } from '../services/supabaseClient';
import { getCurrentUser } from '../services/storage';
import { useUser } from '../context/UserContext';

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

async function getModalAuthHeaders(): Promise<HeadersInit> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
      return headers;
    }
  } catch {
    // ignore
  }
  if (!import.meta.env.VITE_SUPABASE_URL) {
    const u = getCurrentUser();
    if (u?.role === 'lecteur') headers['Authorization'] = 'Bearer dev_lecteur_token';
    else if (u?.role === 'caporal_contractuelles') headers['Authorization'] = 'Bearer dev_caporal_contractuel_token';
    else if (u?.role === 'caporal') headers['Authorization'] = 'Bearer dev_caporal_token';
    else headers['Authorization'] = 'Bearer dev_admin_token';
  }
  return headers;
}

export const GestionComptesModal: React.FC<GestionComptesModalProps> = ({
  isOpen,
  onClose,
  users: localUsers,
  onSaveUser,
  onToggleUserActif,
  onDeleteUser,
}) => {
  const { isReadOnly } = useUser();
  const [remoteUsers, setRemoteUsers] = useState<UserAccount[] | null>(null);
  const [loadingUsers, setLoadingUsers] = useState(false);
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

  const loadRemoteUsers = async () => {
    setLoadingUsers(true);
    try {
      const headers = await getModalAuthHeaders();
      const res = await fetch('/api/users', { headers });
      const data = await res.json();
      if (res.ok && data.success && Array.isArray(data.users)) {
        setRemoteUsers(data.users);
      }
    } catch {
      // Fallback localUsers si hors ligne
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadRemoteUsers();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const users = remoteUsers && remoteUsers.length > 0 ? remoteUsers : localUsers;

  const handleOpenAddForm = () => {
    if (isReadOnly) return;
    setEditingUserId(null);
    setUsername('');
    setNom('');
    setPassword('');
    setTelephone('');
    setRole('caporal');
    setError(null);
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) return;
    setError(null);

    if (!editingUserId) {
      // Création serveur via /api/create-caporal (Auth + profiles)
      try {
        const headers = await getModalAuthHeaders();
        const res = await fetch('/api/create-caporal', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            username: username.trim().toLowerCase(),
            nom: nom.trim(),
            password,
            role,
            telephone: telephone.trim() || undefined,
            module_attribue:
              role === 'caporal_contractuelles'
                ? 'contractuelles'
                : role === 'caporal'
                ? 'recolte'
                : 'all',
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          setError(data.error || `Erreur serveur HTTP ${res.status}.`);
          return;
        }
        await loadRemoteUsers();
      } catch (err: any) {
        // Fallback local uniquement si vraiment hors ligne
        if (navigator.onLine) {
          setError(err?.message || "Erreur réseau lors de la création.");
          return;
        }
      }
    }

    const res = await onSaveUser({
      id: editingUserId || undefined,
      username,
      nom,
      role,
      password: password || undefined,
      telephone,
    });

    if (!res.success && !remoteUsers) {
      setError(res.error || "Erreur lors de l'enregistrement.");
      return;
    }

    setSuccess(editingUserId ? 'Utilisateur modifié avec succès !' : 'Nouveau compte créé !');
    setShowForm(false);
    setTimeout(() => setSuccess(null), 3000);
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly || !resetModalUser || !newPassword.trim()) return;

    if (newPassword.trim().length < 4) {
      setError('Le mot de passe doit comporter au moins 4 caractères.');
      return;
    }

    try {
      const headers = await getModalAuthHeaders();
      const apiRes = await fetch(`/api/users/${encodeURIComponent(resetModalUser.id)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ password: newPassword.trim() }),
      });
      const apiData = await apiRes.json();
      if (!apiRes.ok || !apiData.success) {
        setError(apiData.error || 'Erreur serveur lors de la mise à jour.');
        return;
      }
      await loadRemoteUsers();
    } catch {
      await onSaveUser({
        id: resetModalUser.id,
        username: resetModalUser.username,
        nom: resetModalUser.nom,
        role: resetModalUser.role,
        password: newPassword.trim(),
      });
    }

    setSuccess(`Mot de passe réinitialisé pour ${resetModalUser.nom} !`);
    setResetModalUser(null);
    setNewPassword('');
    setTimeout(() => setSuccess(null), 3500);
  };

  const handleToggle = async (user: UserAccount) => {
    if (isReadOnly) return;
    try {
      const headers = await getModalAuthHeaders();
      const apiRes = await fetch(`/api/users/${encodeURIComponent(user.id)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ actif: !user.actif }),
      });
      const apiData = await apiRes.json();
      if (apiRes.ok && apiData.success) {
        await loadRemoteUsers();
        return;
      }
      setError(apiData.error || 'Erreur lors de la mise à jour du statut.');
    } catch {
      onToggleUserActif(user.id);
    }
  };

  const handleDelete = (user: UserAccount) => {
    if (isReadOnly) return;
    if (user.id === 'usr_admin') {
      alert('Impossible de supprimer le compte administrateur principal.');
      return;
    }
    if (window.confirm(`Supprimer définitivement le compte local de ${user.nom} (${user.username}) ?`)) {
      const res = onDeleteUser(user.id);
      if (!res.success) {
        alert(res.error || 'Erreur lors de la suppression.');
      } else {
        setSuccess(`Compte "${user.username}" supprimé.`);
        setTimeout(() => setSuccess(null), 3000);
      }
    }
  };

  const getRoleBadge = (r: UserRole) => {
    if (r === 'admin') return { label: 'Admin', icon: '👑', bg: 'bg-amber-100 text-amber-900', iconBg: 'bg-amber-100 text-amber-800' };
    if (r === 'lecteur') return { label: 'Lecteur', icon: '👁️', bg: 'bg-sky-100 text-sky-900', iconBg: 'bg-sky-100 text-sky-800' };
    if (r === 'caporal_contractuelles') return { label: 'Cap. Contract.', icon: '📋', bg: 'bg-indigo-100 text-indigo-900', iconBg: 'bg-indigo-100 text-indigo-800' };
    return { label: 'Caporal', icon: '🌾', bg: 'bg-emerald-100 text-emerald-900', iconBg: 'bg-emerald-100 text-emerald-800' };
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
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={loadRemoteUsers}
              className="text-slate-400 hover:text-white p-1.5 rounded-full transition"
              title="Actualiser depuis Supabase"
            >
              <RefreshCw className={`w-4 h-4 ${loadingUsers ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1 rounded-full transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
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
            <p>• <strong>Administrateur :</strong> Accès total.</p>
            <p>• <strong>Caporal Récolte / Contractuelles :</strong> Accès terrain limité à son module.</p>
            <p>• <strong>Lecteur :</strong> Consultation complète en lecture seule (aucune écriture).</p>
          </div>

          {/* Bouton Ajouter */}
          {!showForm && !isReadOnly && (
            <button
              type="button"
              onClick={handleOpenAddForm}
              className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-black py-2.5 rounded-xl transition shadow-xs active:scale-98"
            >
              <UserPlus className="w-4 h-4" />
              <span>Créer un nouveau compte</span>
            </button>
          )}

          {/* Formulaire de création / édition */}
          {showForm && !isReadOnly && (
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
                    Identifiant / Email :
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="ex: mahdi@lecture.com"
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
                    placeholder="ex: Mahdi"
                    required
                    className="w-full bg-white border border-slate-300 rounded-xl p-2 font-bold text-slate-800 outline-none focus:border-emerald-600 text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="text-[11px] font-bold text-slate-700 block mb-1">
                    {editingUserId ? "Nouveau mot de passe (optionnel) :" : "Mot de passe :"}
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
                    <option value="caporal_contractuelles">📋 Caporal Contractuelles</option>
                    <option value="lecteur">👁️ Lecteur (Lecture seule)</option>
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
              const badge = getRoleBadge(u.role);
              return (
                <div
                  key={u.id}
                  className={`p-3 rounded-2xl border transition ${
                    u.actif !== false ? 'bg-white border-slate-200' : 'bg-slate-50 border-slate-200 opacity-60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm ${badge.iconBg}`}>
                        {badge.icon}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-black text-slate-900 text-xs">{u.nom}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${badge.bg}`}>
                            {badge.label}
                          </span>
                          {u.actif === false && (
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

                    {!isReadOnly && (
                      <div className="flex items-center gap-1">
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

                        {u.id !== 'usr_admin' && u.role !== 'admin' && (
                          <button
                            type="button"
                            onClick={() => handleToggle(u)}
                            title={u.actif !== false ? 'Désactiver le compte' : 'Activer le compte'}
                            className={`px-2 py-1 rounded-lg text-[10px] font-bold transition ${
                              u.actif !== false
                                ? 'bg-slate-100 text-slate-600 hover:bg-amber-100 hover:text-amber-800'
                                : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                            }`}
                          >
                            {u.actif !== false ? 'Désactiver' : 'Activer'}
                          </button>
                        )}

                        {u.id !== 'usr_admin' && u.role !== 'admin' && (
                          <button
                            type="button"
                            onClick={() => handleDelete(u)}
                            title="Supprimer localement"
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Modale de réinitialisation de mot de passe */}
        {resetModalUser && !isReadOnly && (
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

