import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

export const firebaseConfig = {
  apiKey: "AIzaSyCNmyvumG0-8Vgdg5nQb-hRT6U5ZbHv9IA",
  authDomain: "portaria-condominio-8fbc9.firebaseapp.com",
  projectId: "portaria-condominio-8fbc9",
  storageBucket: "portaria-condominio-8fbc9.firebasestorage.app",
  messagingSenderId: "494676520919",
  appId: "1:494676520919:web:796b6d6fa17fe8b11b2592"
}

const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)
export default app