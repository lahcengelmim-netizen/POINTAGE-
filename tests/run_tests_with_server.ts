import { app } from '../server.ts';
import http from 'http';

const PORT = 3000;
const server = http.createServer(app);

server.listen(PORT, async () => {
  console.log(`Serveur de test démarré sur http://127.0.0.1:${PORT}`);
  try {
    // Exécuter la suite de tests officielle
    await import('./run_all_tests.ts');
  } catch (err) {
    console.error('Erreur exécution tests:', err);
    process.exit(1);
  }
  // Attendre un court instant pour la fin des requêtes puis fermer le serveur
  setTimeout(() => {
    server.close(() => {
      console.log('Serveur de test arrêté.');
      process.exit(0);
    });
  }, 2000);
});
