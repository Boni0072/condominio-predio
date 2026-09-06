import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
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
  serverTimestamp,
  orderBy,
  limit
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
  // Evita que o onAuthStateChanged interfira enquanto signUpMember grava o perfil.
  const cadastroEmAndamento = useRef(false)

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
          // Durante o cadastro do morador (signUpMember), o perfil ainda não foi
          // gravado no Firestore. Se o getDoc rodar agora, as regras bloqueiam
          // (exists(users/uid) == false) e o erro cai no catch, exibindo
          // "Sem permissão". Por isso checamos a flag ANTES de ler.
          if (cadastroEmAndamento.current) {
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
            // Conta autenticada mas sem perfil concluído: marca como pendente
            // para o usuário informar o código do condomínio. Não inventa
            // perfil de síndico — isso fazia entrar no condomínio errado.
            setUserProfile({
              uid: firebaseUser.uid,
              email: firebaseUser.email,
              nome: firebaseUser.displayName || firebaseUser.email.split('@')[0],
              role: 'morador',
              condominioId: null,
              perfilPendente: true
            })
          }
        } catch (err) {
          // Falha ao ler o perfil (sem conexão ou regras desatualizadas):
          // não inventa perfil — o Login exibirá o aviso com "Tentar novamente".
          setErroConexao(
            err?.code === 'permission-denied' || /permission/i.test(err?.message || '')
              ? 'Sem permissão para ler seu perfil no Firestore. Verifique se as regras (firestore.rules) estão publicadas no console do Firebase.'
              : `Não foi possível carregar seu perfil: ${err?.message || err}`
          )
          setUserProfile(null)
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
    const email = String(dados.email || '').trim().toLowerCase()
    const credential = await createUserWithEmailAndPassword(auth, email, dados.senha)
    const firebaseUser = credential.user
    await updateProfile(firebaseUser, { displayName: dados.nome })

    const codigo = await gerarCodigoUnico()
    const dadosCondominio = {
      nome: dados.condominoNome,
      endereco: dados.endereco || '',
      criadoEm: serverTimestamp(),
      codigo
    }
    await setDoc(doc(db, 'condominios', firebaseUser.uid), dadosCondominio)
    await setDoc(doc(db, 'users', firebaseUser.uid), {
      uid: firebaseUser.uid,
      email,
      nome: dados.nome,
      role: 'sindico',
      condominioId: firebaseUser.uid,
      status: 'ativo',
      criadoEm: serverTimestamp()
    })
    setUserProfile({
      uid: firebaseUser.uid,
      email,
      nome: dados.nome,
      role: 'sindico',
      condominioId: firebaseUser.uid,
      codigo
    })
    setCondominio({ id: firebaseUser.uid, ...dadosCondominio, criadoEm: new Date().toISOString() })
    return firebaseUser
  }

  // Wrapper: sinaliza ao onAuthStateChanged que o perfil está sendo gravado.
  async function signUpMember(dados) {
    cadastroEmAndamento.current = true
    try {
      return await signUpMemberInterno(dados)
    } finally {
      cadastroEmAndamento.current = false
    }
  }

  async function signUpMemberInterno(dados) {
    // 1. Conta de autenticação. Se o e-mail já tem conta (tentativa anterior
    //    interrompida por código inválido ou por regra do Firestore), entra na
    //    conta existente e conclui o cadastro — a conta nunca é apagada.
    const email = String(dados.email || '').trim().toLowerCase()
    const codigoCondominio = String(dados.condominioCodigo || '').trim().toUpperCase()
    let credential
    try {
      credential = await createUserWithEmailAndPassword(auth, email, dados.senha)
    } catch (err) {
      if (err?.code !== 'auth/email-already-in-use') throw err
      try {
        credential = await signInWithEmailAndPassword(auth, email, dados.senha)
      } catch {
        throw new Error('Já existe uma conta com este e-mail, mas a senha não confere. Use "Esqueci minha senha" na tela de login.')
      }
    }
    const firebaseUser = credential.user
    try {
      // 2. Conta já cadastrada (perfil existe no Firestore)? Apenas entra,
      //    sem sobrescrever o cadastro atual.
      const perfilExistente = await getDoc(doc(db, 'users', firebaseUser.uid))
      if (perfilExistente.exists()) {
        setUserProfile(perfilExistente.data())
        return firebaseUser
      }
      // 3. Localiza o condomínio pelo código de acesso (ex.: DP8D3Y)
      // orderBy + limit garante resultado determinístico mesmo que haja códigos
      // duplicados legados no banco (o mais recente prevalece).
      const q = query(
        collection(db, 'condominios'),
        where('codigo', '==', codigoCondominio),
        orderBy('criadoEm', 'desc'),
        limit(1)
      )
      const snapshot = await getDocs(q)
      if (snapshot.empty) {
        throw new Error('Código do condomínio não encontrado. Confira o código exibido nas Configurações do síndico e tente novamente.')
      }
      const condominioId = snapshot.docs[0].id

      await updateProfile(firebaseUser, { displayName: dados.nome })
      // 4. Moradores criam a própria conta pelo código. Zeladores e porteiros
      //    são cadastrados pelo síndico em Gestão de usuários.
      const role = dados.role || 'morador'
      await setDoc(doc(db, 'users', firebaseUser.uid), {
        uid: firebaseUser.uid,
        email,
        nome: dados.nome,
        role,
        condominioId,
        status: 'ativo',
        criadoEm: serverTimestamp()
      })
      setUserProfile({
        uid: firebaseUser.uid,
        email,
        nome: dados.nome,
        role,
        condominioId
      })
      return firebaseUser
    } catch (err) {
      // Código inválido ou falha no Firestore: encerra a sessão, mas mantém a
      // conta no Authentication para o usuário concluir o cadastro depois.
      await signOut(auth).catch(() => {})
      if (err?.code === 'permission-denied') {
        throw new Error('Sem permissão para consultar o condomínio. Publique as regras do Firestore (firestore.rules) no console do Firebase.')
      }
      throw err
    }
  }

  // Conclui o cadastro de uma conta autenticada que ainda não tem perfil
  // (tela "Completar cadastro": usuário informa o código do condomínio).
  async function completarCadastroMorador(codigo) {
    if (!user) throw new Error('Nenhuma sessão ativa. Entre com seu e-mail e senha.')
    const codigoCondominio = String(codigo || '').trim().toUpperCase()
    const q = query(
      collection(db, 'condominios'),
      where('codigo', '==', codigoCondominio),
      orderBy('criadoEm', 'desc'),
      limit(1)
    )
    const snapshot = await getDocs(q)
    if (snapshot.empty) {
      throw new Error('Código do condomínio não encontrado. Confira o código exibido nas Configurações do síndico e tente novamente.')
    }
    const condominioId = snapshot.docs[0].id
    const email = userProfile?.email || user.email
    const nome = userProfile?.nome || user.displayName || user.email.split('@')[0]
    await setDoc(doc(db, 'users', user.uid), {
      uid: user.uid,
      email,
      nome,
      role: 'morador',
      condominioId,
      status: 'ativo',
      criadoEm: serverTimestamp()
    })
    setUserProfile({ uid: user.uid, email, nome, role: 'morador', condominioId, status: 'ativo' })
    const condoDoc = await getDoc(doc(db, 'condominios', condominioId))
    if (condoDoc.exists()) {
      setCondominio({ id: condoDoc.id, ...condoDoc.data() })
    }
    return true
  }

  async function cadastrarUsuario(dados) {
    const email = String(dados.email || '').trim().toLowerCase()
    const secondaryApp = initializeApp(firebaseConfig, `cadastro-${Date.now()}`)
    const secondaryAuth = getSecondaryAuth(secondaryApp)
    let contaCriada = null
    try {
      const credential = await createSecondaryUser(secondaryAuth, email, dados.senha)
      const firebaseUser = credential.user
      contaCriada = firebaseUser
      await updateProfile(firebaseUser, { displayName: dados.nome })
      const perfilAdmin = await getDoc(doc(db, 'users', auth.currentUser.uid))
      const dadosAdmin = perfilAdmin.exists() ? perfilAdmin.data() : null
      const condominioId = dadosAdmin?.condominioId || userProfile?.condominioId || auth.currentUser.uid
      await setDoc(doc(db, 'users', firebaseUser.uid), {
        uid: firebaseUser.uid,
        email,
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
    const codigo = await gerarCodigoUnico()

    try {
      const email = String(dados.email || '').trim().toLowerCase()
      const credential = await createSecondaryUser(secondaryAuth, email, dados.senha)
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
        email,
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
    const credential = await signInWithEmailAndPassword(auth, String(email || '').trim(), password)
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

  // Gera um código de acesso único, verificando no banco se já existe.
  // Essencial para sistema multi-inquilino: códigos duplicados fariam o morador
  // entrar no condomínio errado.
  async function gerarCodigoUnico() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    for (let tentativa = 0; tentativa < 100; tentativa++) {
      let codigo = ''
      for (let i = 0; i < 6; i++) {
        codigo += chars.charAt(Math.floor(Math.random() * chars.length))
      }
      const q = query(collection(db, 'condominios'), where('codigo', '==', codigo))
      const existente = await getDocs(q)
      if (existente.empty) return codigo
    }
    throw new Error('Não foi possível gerar um código único de acesso. Tente novamente.')
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
    completarCadastroMorador,
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