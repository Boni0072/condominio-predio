import React, { createContext, useContext, useEffect, useState } from 'react'
import { deleteApp, initializeApp } from 'firebase/app'
import { getAuth as getSecondaryAuth, createUserWithEmailAndPassword as createSecondaryUser, deleteUser } from 'firebase/auth'
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
  updateProfile
} from 'firebase/auth'
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp
} from 'firebase/firestore'
import { auth, db, firebaseConfig } from '../firebase/config.js'

const AuthContext = createContext(null)
export const MASTER_EMAIL = 'ander.fj@hotmail.com'

function ehMaster(email) {
  return email?.trim().toLowerCase() === MASTER_EMAIL
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [userProfile, setUserProfile] = useState(null)
  const [condominio, setCondominio] = useState(null)
  const [loading, setLoading] = useState(true)
  const [erroConexao, setErroConexao] = useState(null)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setCondominio(null)
      if (firebaseUser) {
        setUser(firebaseUser)
        try {
          if (ehMaster(firebaseUser.email)) {
            setUserProfile({
              uid: firebaseUser.uid,
              email: firebaseUser.email,
              nome: firebaseUser.displayName || 'Administrador da plataforma',
              role: 'master',
              condominioId: null
            })
            setLoading(false)
            return
          }
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid))
          if (userDoc.exists()) {
            const perfil = userDoc.data()
            setUserProfile(perfil)
            // Buscar dados do condomínio (logo, nome, código)
            if (perfil.condominioId) {
              const condoDoc = await getDoc(doc(db, 'condominios', perfil.condominioId))
              if (condoDoc.exists()) {
                setCondominio({ id: condoDoc.id, ...condoDoc.data() })
              }
            }
          } else {
            // Se não existe no Firestore, cria perfil mínimo para não travar
            setUserProfile({
              uid: firebaseUser.uid,
              email: firebaseUser.email,
              nome: firebaseUser.displayName || firebaseUser.email.split('@')[0],
              role: 'sindico',
              condominioId: firebaseUser.uid
            })
          }
        } catch (err) {
          // Se não consegue ler Firestore, usa perfil mínimo do Auth
          setErroConexao(err.message)
          setUserProfile({
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            nome: firebaseUser.displayName || firebaseUser.email.split('@')[0],
            role: 'sindico',
            condominioId: firebaseUser.uid
          })
        }
      } else {
        setUser(null)
        setUserProfile(null)
        setCondominio(null)
      }
      setLoading(false)
    }, (err) => {
      // Erro no listener do Auth (ex: Firebase não configurado)
      setErroConexao(err?.message || 'Erro de autenticação')
      setLoading(false)
    })
    return unsubscribe
  }, [])

    async function signUpAdmin(dados) {
    const credential = await createUserWithEmailAndPassword(auth, dados.email, dados.senha)
    const firebaseUser = credential.user
    await updateProfile(firebaseUser, { displayName: dados.nome })

    const codigo = gerarCodigo()
    const dadosCondominio = {
      nome: dados.condominoNome,
      endereco: dados.endereco || '',
      criadoEm: serverTimestamp(),
      codigo
    }
    await setDoc(doc(db, 'condominios', firebaseUser.uid), dadosCondominio)
    await setDoc(doc(db, 'users', firebaseUser.uid), {
      uid: firebaseUser.uid,
      email: dados.email,
      nome: dados.nome,
      role: 'sindico',
      condominioId: firebaseUser.uid,
      status: 'ativo',
      criadoEm: serverTimestamp()
    })
    setUserProfile({
      uid: firebaseUser.uid,
      email: dados.email,
      nome: dados.nome,
      role: 'sindico',
      condominioId: firebaseUser.uid,
      codigo
    })
    setCondominio({ id: firebaseUser.uid, ...dadosCondominio, criadoEm: new Date().toISOString() })
    return firebaseUser
  }

  async function signUpMember(dados) {
    // 1. Cria a conta de autenticação primeiro: o usuário precisa estar
    //    autenticado para consultar o Firestore nas etapas seguintes.
    const credential = await createUserWithEmailAndPassword(auth, dados.email, dados.senha)
    const firebaseUser = credential.user
    try {
      // 2. Localiza o condomínio pelo código de acesso (ex.: DP8D3Y)
      const q = query(collection(db, 'condominios'), where('codigo', '==', dados.condominioCodigo))
      const snapshot = await getDocs(q)
      if (snapshot.empty) throw new Error('Código do condomínio não encontrado')
      const condominioId = snapshot.docs[0].id

      await updateProfile(firebaseUser, { displayName: dados.nome })
      // 3. Moradores criam a própria conta pelo código. Zeladores e porteiros
      //    são cadastrados pelo síndico em Gestão de usuários.
      const role = dados.role || 'morador'
      await setDoc(doc(db, 'users', firebaseUser.uid), {
        uid: firebaseUser.uid,
        email: dados.email,
        nome: dados.nome,
        role,
        condominioId,
        status: 'ativo',
        criadoEm: serverTimestamp()
      })
      setUserProfile({
        uid: firebaseUser.uid,
        email: dados.email,
        nome: dados.nome,
        role,
        condominioId
      })
      return firebaseUser
    } catch (err) {
      // Código inválido ou falha no Firestore: desfaz a conta criada
      await deleteUser(firebaseUser).catch(() => {})
      throw err
    }
  }

  async function cadastrarUsuario(dados) {
    const secondaryApp = initializeApp(firebaseConfig, `cadastro-${Date.now()}`)
    const secondaryAuth = getSecondaryAuth(secondaryApp)
    let contaCriada = null
    try {
      const credential = await createSecondaryUser(secondaryAuth, dados.email, dados.senha)
      const firebaseUser = credential.user
      contaCriada = firebaseUser
      await updateProfile(firebaseUser, { displayName: dados.nome })
      const perfilAdmin = await getDoc(doc(db, 'users', auth.currentUser.uid))
      const dadosAdmin = perfilAdmin.exists() ? perfilAdmin.data() : null
      const condominioId = dadosAdmin?.condominioId || userProfile?.condominioId || auth.currentUser.uid
      await setDoc(doc(db, 'users', firebaseUser.uid), {
        uid: firebaseUser.uid,
        email: dados.email,
        nome: dados.nome,
        role: dados.role || 'morador',
        unidade: dados.unidade?.trim() || '',
        acessos: dados.acessos || [],
        condominioId,
        status: 'ativo',
        criadoEm: serverTimestamp()
      })
      return firebaseUser
    } catch (err) {
      if (contaCriada) await deleteUser(contaCriada).catch(() => {})
      throw err
    } finally {
      await secondaryAuth.signOut()
      await deleteApp(secondaryApp)
    }
  }

  async function criarCondominio(dados) {
    if (!ehMaster(auth.currentUser?.email)) {
      throw new Error('Apenas o usuário master pode criar condomínios.')
    }

    const condoRef = doc(collection(db, 'condominios'))
    const secondaryApp = initializeApp(firebaseConfig, `condominio-${Date.now()}`)
    const secondaryAuth = getSecondaryAuth(secondaryApp)
    let contaCriada = null
    let condominioCriado = false
    const codigo = gerarCodigo()

    try {
      const credential = await createSecondaryUser(secondaryAuth, dados.email, dados.senha)
      contaCriada = credential.user
      await updateProfile(contaCriada, { displayName: dados.nome })
      await setDoc(condoRef, {
        nome: dados.condominioNome,
        endereco: dados.endereco || '',
        logo: dados.logo || '',
        codigo,
        criadoPor: auth.currentUser.uid,
        criadoEm: serverTimestamp()
      })
      condominioCriado = true
      await setDoc(doc(db, 'users', contaCriada.uid), {
        uid: contaCriada.uid,
        email: dados.email,
        nome: dados.nome,
        role: 'sindico',
        condominioId: condoRef.id,
        status: 'ativo',
        criadoEm: serverTimestamp()
      })
      return { id: condoRef.id, nome: dados.condominioNome, codigo }
    } catch (err) {
      if (condominioCriado) await deleteDoc(condoRef).catch(() => {})
      if (contaCriada) await deleteUser(contaCriada).catch(() => {})
      throw err
    } finally {
      await secondaryAuth.signOut()
      await deleteApp(secondaryApp)
    }
  }

  async function atualizarCondominioMaster(id, dados) {
    if (!ehMaster(auth.currentUser?.email)) throw new Error('Apenas o usuário master pode editar condomínios.')
    await setDoc(doc(db, 'condominios', id), {
      nome: dados.nome.trim(),
      endereco: dados.endereco?.trim() || '',
      logo: dados.logo || ''
    }, { merge: true })

    // Atualiza também o cadastro do síndico (nome e e-mail), se informado.
    const nomeSindico = (dados.sindicoNome || '').trim()
    const emailSindico = (dados.sindicoEmail || '').trim().toLowerCase()
    if (nomeSindico || emailSindico) {
      const atualizacaoSindico = {}
      if (nomeSindico) atualizacaoSindico.nome = nomeSindico
      if (emailSindico) atualizacaoSindico.email = emailSindico
      const sindicos = await getDocs(
        query(collection(db, 'users'), where('condominioId', '==', id), where('role', '==', 'sindico'))
      )
      await Promise.all(
        sindicos.docs.map((item) => setDoc(item.ref, atualizacaoSindico, { merge: true }))
      )
    }
  }

  async function excluirCondominio(id) {
    if (!ehMaster(auth.currentUser?.email)) throw new Error('Apenas o usuário master pode excluir condomínios.')
    const colecoes = ['visitantes', 'encomendas', 'comunicados', 'moradores', 'despesas', 'orcamentos']
    const batch = writeBatch(db)
    for (const nome of colecoes) {
      const snapshot = await getDocs(collection(db, 'condominios', id, nome))
      snapshot.docs.forEach((item) => batch.delete(item.ref))
    }
    const usuarios = await getDocs(query(collection(db, 'users'), where('condominioId', '==', id)))
    usuarios.docs.forEach((item) => batch.delete(item.ref))
    batch.delete(doc(db, 'condominios', id))
    await batch.commit()
  }

  // Atualizar dados do condomínio (nome, logo, endereço, etc.)
  async function atualizarCondominio(dados) {
    const id = userProfile?.condominioId || userProfile?.uid
    if (!id) throw new Error('Condomínio não identificado')
    const dadosParaSalvar = {
      ...dados,
      logo: typeof dados.logo === 'string' && dados.logo.startsWith('data:image/')
        ? dados.logo
        : (dados.logo || '')
    }
    await setDoc(doc(db, 'condominios', id), dadosParaSalvar, { merge: true })
    setCondominio((atual) => ({ ...(atual || {}), ...dadosParaSalvar }))
    return true
  }

  async function login({ email, password }) {
    const credential = await signInWithEmailAndPassword(auth, email, password)
    return credential.user
  }

  async function enviarRedefinicaoSenha(email) {
    if (!email) throw new Error('Usuário sem e-mail cadastrado.')
    auth.languageCode = 'pt-BR'
    try {
      await sendPasswordResetEmail(auth, email.trim().toLowerCase())
    } catch (err) {
      if (err?.code === 'auth/user-not-found') {
        throw new Error('Este e-mail não está cadastrado no Firebase Authentication.')
      }
      if (err?.code === 'auth/invalid-email') {
        throw new Error('O e-mail deste usuário é inválido.')
      }
      if (err?.code === 'auth/too-many-requests') {
        throw new Error('Muitas tentativas. Aguarde alguns minutos e tente novamente.')
      }
      throw new Error(err?.message || 'O Firebase não conseguiu enviar o e-mail de redefinição.')
    }
  }

  async function logout() {
    await signOut(auth)
    setUser(null)
    setUserProfile(null)
  }

  function gerarCodigo() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    let codigo = ''
    for (let i = 0; i < 6; i++) codigo += chars.charAt(Math.floor(Math.random() * chars.length))
    return codigo
  }

  const value = {
    user,
    userProfile,
    condominio,
    loading,
    erroConexao,
    firebaseOK: !erroConexao && user !== undefined,
        signUpAdmin,
    signUpMember,
    cadastrarUsuario,
    criarCondominio,
    atualizarCondominioMaster,
    excluirCondominio,
    atualizarCondominio,
    login,
    enviarRedefinicaoSenha,
    logout
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider')
  return ctx
}