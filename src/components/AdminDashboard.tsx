import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabaseClient';
import { useUser } from '../context/UserContext';

interface User {
  id: string;
  username: string;
  nom: string;
  role: 'admin' | 'caporal';
  actif: boolean;
  company_id: string;
}

export const AdminDashboard: React.FC = () => {
  const { user } = useUser();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [newUsername, setNewUsername] = useState('');
  const [newNom, setNewNom] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'caporal'>('caporal');
  const [newPassword, setNewPassword] = useState('');

  useEffect(() => {
    if (user?.company_id) {
      fetchUsers();
    }
  }, [user]);

  const fetchUsers = async () => {
    if (!user?.company_id) return;
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('company_id', user.company_id);
    if (data) setUsers(data);
    setLoading(false);
  };

  const checkConfig = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch('/api/debug-config', {
        headers: { 'Authorization': `Bearer ${session?.access_token}` }
      });
      const data = await response.json();
      
      const frontendUrl = import.meta.env.VITE_SUPABASE_URL || '';
      const frontendId = frontendUrl ? new URL(frontendUrl).hostname.split('.')[0] : 'non-défini';
      
      const match = data.projectId === frontendId;
      alert(`Backend: ${data.projectId}\nFrontend: ${frontendId}\n\nRésultat: ${match ? 'Identiques' : 'Différents'}`);
    } catch (err) {
      alert('Erreur de diagnostic');
    }
  };

  const createUser = async () => {
    const trimmedUsername = newUsername.trim();
    if (!trimmedUsername || !newNom || !newPassword) {
      alert('Veuillez remplir tous les champs.');
      return;
    }
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      const response = await fetch('/api/create-caporal', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`
        },
        body: JSON.stringify({
          username: trimmedUsername,
          nom: newNom,
          password: newPassword
        })
      });
      
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error);
      }
      
      alert('Compte créé avec succès !');
      fetchUsers();
    } catch (err: any) {
      alert('Erreur: ' + err.message);
    }
  };

  const toggleUserStatus = async (userId: string, currentStatus: boolean) => {
    await supabase.from('profiles').update({ actif: !currentStatus }).eq('id', userId);
    fetchUsers();
  };

  if (loading) return <div>Chargement...</div>;

  return (
    <div className="p-4">
      <div className="bg-gray-100 p-4 mb-4 rounded flex justify-between items-center">
        <h2 className="text-xl font-bold">Administration des Caporaux</h2>
        <button onClick={checkConfig} className="bg-yellow-500 text-white px-4 py-2 rounded">Vérifier la configuration</button>
      </div>
      
      <div className="bg-gray-100 p-4 mb-4 rounded">
        <h3 className="font-bold mb-2">Créer un nouveau compte</h3>
        <input className="border p-2 mr-2" placeholder="Username" value={newUsername} onChange={e => setNewUsername(e.target.value)} />
        <input className="border p-2 mr-2" placeholder="Nom" value={newNom} onChange={e => setNewNom(e.target.value)} />
        <input className="border p-2 mr-2" type="password" placeholder="Mot de passe" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
        <select className="border p-2 mr-2" value={newRole} onChange={e => setNewRole(e.target.value as 'admin' | 'caporal')}>
          <option value="caporal">Caporal</option>
          <option value="admin">Admin</option>
        </select>
        <button onClick={createUser} className="bg-green-500 text-white px-4 py-2 rounded">Créer</button>
      </div>

      <table className="min-w-full bg-white">
        <thead>
          <tr>
            <th className="py-2">Username</th>
            <th className="py-2">Nom</th>
            <th className="py-2">Rôle</th>
            <th className="py-2">Actif</th>
            <th className="py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map(user => (
            <tr key={user.id}>
              <td className="py-2">{user.username}</td>
              <td className="py-2">{user.nom}</td>
              <td className="py-2">{user.role}</td>
              <td className="py-2">{user.actif ? 'Oui' : 'Non'}</td>
              <td className="py-2">
                <button 
                  onClick={() => toggleUserStatus(user.id, user.actif)}
                  className="bg-blue-500 text-white px-2 py-1 rounded"
                >
                  {user.actif ? 'Désactiver' : 'Activer'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
