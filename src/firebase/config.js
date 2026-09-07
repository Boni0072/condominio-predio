import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'
import { getMessaging } from 'firebase/messaging'

export const firebaseConfig = {
  apiKey: "AIzaSyCNmyvumG0-8Vgdg5nQb-hRT6U5ZbHv9IA",
  authDomain: "portaria-condominio-8fbc9.firebaseapp.com",
  projectId: "portaria-condominio-8fbc9",
  storageBucket: "portaria-condominio-8fbc9.firebasestorage.app",
  messagingSenderId: "494676520919",
  appId: "1:494676520919:web:796b6d6fa17fe8b11b2592"
}

// 🔑 VAPID key — obtenha no Firebase Console:
//   Console Firebase → Project settings → Cloud Messaging → Web configuration → Generate key pair
// FCM_SERVER_KEY (opcional): só é usada como fallback da API LEGADA do FCM.
// Projetos novos NÃO têm mais "Server key" — o envio é feito pela Cloud Function
// (functions/index.js), que usa o Admin SDK e não precisa de nenhuma chave aqui.
export const FCM_VAPID_KEY = 'BJxxlv34DuRgq9OQariqr4CIdlJxv7HGTkt3NsIh8Tc_WVFHr3IBkqWZMh3XVfHLUaUCAKtjSMMEqT4cLM1bUeY'
export const FCM_SERVER_KEY = ''

export const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)
export const messaging = getMessaging(app)
export default app