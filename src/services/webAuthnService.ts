/**
 * Service WebAuthn / Passkeys pour la gestion de la connexion par Empreinte Digitale / Biométrie
 * - Conforme aux normes W3C WebAuthn
 * - Ne stocke AUCUNE donnée biométrique (l'empreinte est validée localement par l'enclave sécurisée de l'appareil)
 * - Supporte Touch ID, Face ID, Empreinte Android, Windows Hello
 */

const BIOMETRIC_KEY_PREFIX = 'agripointage_bio_cred_';
const LAST_BIO_USER_KEY = 'agripointage_last_bio_user';

export interface StoredBiometricCredential {
  credentialId: string;
  userId: string;
  username: string;
  nom: string;
  createdAt: string;
}

/**
 * Vérifie si l'appareil et le navigateur prennent en charge la biométrie matérielle (TouchID, FaceID, Windows Hello, Empreinte Android)
 */
export async function isBiometricSupported(): Promise<boolean> {
  try {
    if (
      typeof window === 'undefined' ||
      !window.PublicKeyCredential ||
      typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function'
    ) {
      return false;
    }
    const isAvailable = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    return isAvailable;
  } catch (err) {
    console.warn('Vérification support biométrique échouée:', err);
    return false;
  }
}

/**
 * Convertit une chaîne de caractères en Uint8Array pour les challenges WebAuthn
 */
function stringToUint8Array(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * Convertit un ArrayBuffer en chaîne Base64URL pour stockage local
 */
function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Enregistre une nouvelle empreinte digitale biométrique pour un utilisateur sur cet appareil
 */
export async function registerBiometricCredential(
  userId: string,
  username: string,
  nom: string
): Promise<boolean> {
  const supported = await isBiometricSupported();
  if (!supported) {
    throw new Error("Cet appareil ou navigateur ne supporte pas l'authentification biométrique matérielle.");
  }

  const challenge = stringToUint8Array(`agripointage_reg_${userId}_${Date.now()}`);
  const userIdBuffer = stringToUint8Array(userId);

  const publicKeyCredentialCreationOptions: PublicKeyCredentialCreationOptions = {
    challenge: challenge.buffer as ArrayBuffer,
    rp: {
      name: 'AGRIPOINTAGE',
      id: window.location.hostname,
    },
    user: {
      id: userIdBuffer.buffer as ArrayBuffer,
      name: username || 'utilisateur',
      displayName: nom || 'Utilisateur AGRIPOINTAGE',
    },
    pubKeyCredParams: [
      { alg: -7, type: 'public-key' }, // ES256
      { alg: -257, type: 'public-key' }, // RS256
    ],
    authenticatorSelection: {
      authenticatorAttachment: 'platform', // Force l'empreinte / biométrie intégrée à l'appareil
      userVerification: 'required',
      requireResidentKey: false,
    },
    timeout: 60000,
    attestation: 'none',
  };

  try {
    const credential = (await navigator.credentials.create({
      publicKey: publicKeyCredentialCreationOptions,
    })) as PublicKeyCredential;

    if (!credential) {
      throw new Error("L'enregistrement de l'empreinte a été annulé.");
    }

    const credIdBase64 = arrayBufferToBase64Url(credential.rawId);

    const storedData: StoredBiometricCredential = {
      credentialId: credIdBase64,
      userId,
      username,
      nom,
      createdAt: new Date().toISOString(),
    };

    localStorage.setItem(`${BIOMETRIC_KEY_PREFIX}${userId}`, JSON.stringify(storedData));
    localStorage.setItem(LAST_BIO_USER_KEY, userId);

    return true;
  } catch (err: any) {
    if (err.name === 'NotAllowedError') {
      throw new Error('Opération biométrique annulée ou refusée par l\'utilisateur.');
    }
    console.error('Erreur enregistrement biométrique:', err);
    throw new Error(err.message || 'Échec de l\'enregistrement de l\'empreinte.');
  }
}

/**
 * Récupère les données d'empreinte enregistrées sur cet appareil pour un utilisateur (ou le dernier utilisateur)
 */
export function getStoredBiometricCredential(userId?: string): StoredBiometricCredential | null {
  try {
    const targetUserId = userId || localStorage.getItem(LAST_BIO_USER_KEY);
    if (!targetUserId) return null;

    const raw = localStorage.getItem(`${BIOMETRIC_KEY_PREFIX}${targetUserId}`);
    if (!raw) return null;

    return JSON.parse(raw) as StoredBiometricCredential;
  } catch {
    return null;
  }
}

/**
 * Authentifie l'utilisateur via la lecture d'empreinte digitale matérielle (WebAuthn)
 */
export async function authenticateWithBiometrics(userId?: string): Promise<StoredBiometricCredential> {
  const storedCred = getStoredBiometricCredential(userId);
  if (!storedCred) {
    throw new Error('Aucune empreinte enregistrée pour cet appareil.');
  }

  const supported = await isBiometricSupported();
  if (!supported) {
    throw new Error('Authentification biométrique non supportée sur cet appareil.');
  }

  const challenge = stringToUint8Array(`agripointage_auth_${storedCred.userId}_${Date.now()}`);

  const publicKeyRequestOptions: PublicKeyCredentialRequestOptions = {
    challenge: challenge.buffer as ArrayBuffer,
    timeout: 60000,
    userVerification: 'required',
    rpId: window.location.hostname,
  };

  try {
    const assertion = await navigator.credentials.get({
      publicKey: publicKeyRequestOptions,
    });

    if (!assertion) {
      throw new Error('Lecture d\'empreinte annulée.');
    }

    // L'enclave matérielle a validé l'empreinte de l'utilisateur
    return storedCred;
  } catch (err: any) {
    if (err.name === 'NotAllowedError') {
      throw new Error('Empreinte non reconnue ou opération annulée par l\'utilisateur.');
    }
    console.error('Erreur authentification biométrique:', err);
    throw new Error(err.message || 'Échec de la vérification par empreinte.');
  }
}

/**
 * Supprime l'empreinte biométrique enregistrée pour cet appareil
 */
export function revokeBiometricCredential(userId?: string): void {
  try {
    const targetUserId = userId || localStorage.getItem(LAST_BIO_USER_KEY);
    if (targetUserId) {
      localStorage.removeItem(`${BIOMETRIC_KEY_PREFIX}${targetUserId}`);
      if (localStorage.getItem(LAST_BIO_USER_KEY) === targetUserId) {
        localStorage.removeItem(LAST_BIO_USER_KEY);
      }
    }
  } catch (err) {
    console.error('Erreur suppression empreinte:', err);
  }
}
