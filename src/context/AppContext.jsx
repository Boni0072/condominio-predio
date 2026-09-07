import React, { createContext, useContext, useEffect, useState } from 'react'
import { useAuth } from './AuthContext.jsx'
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, updateDoc, where } from 'firebase/firestore'
import { db } from '../firebase/config.js'
import { load, save, uid, nowISO } from '../utils/storage.js'
import { notificarNovaEncomenda, notificarNovoVisitante, solicitarPermissao } from '../utils/notificacao.js'

const AppContext = createContext(null)

const SEED_COMUNICADOS = [
  {
    id: uid(),
    titulo: 'Manutenção da caixa d\'água',
    categoria: 'manutencao',
    conteudo: 'Na quinta-feira, das 8h às 12h, o fornecimento de água será interrompido para limpeza da caixa d\'água.',
    autor: 'Síndico',
    fixado: true,
    criadoEm: nowISO()
  },
  {
    id: uid(),
    titulo: 'Assembleia geral ordinária',
    categoria: 'evento',
    conteudo: 'Convocamos todos os moradores para a assembleia geral no salão de festas, dia 20, às 19h.',
    autor: 'Administração',
    fixado: false,
    criadoEm: nowISO()
  }
]

const SEED_MORADORES = [
  {
    id: uid(),
    nome: 'Ana Beatriz Costa',
    unidade: 'Bloco A, apto 101',
    whatsapp: '11987654321',
    email: 'ana.costa@email.com',
    tipo: 'proprietario',
    criadoEm: nowISO()
  },
  {
    id: uid(),
    nome: 'Carlos Eduardo Lima',
    unidade: 'Bloco B, apto 204',
    whatsapp: '11991234567',
    email: '',
    tipo: 'locatario',
    criadoEm: nowISO()
  }
]

export function AppProvider({ children }) {
  const { userProfile, firebaseOK } = useAuth()
  const condominioId = userProfile?.condominioId || 'local'
  const firestoreAtivo = Boolean(firebaseOK && userProfile?.condominioId)

  const [visitantes, setVisitantes] = useState(() => load(`${condominioId}_visitantes`, []))
  const [encomendas, setEncomendas] = useState(() => load(`${condominioId}_encomendas`, []))
  const [comunicados, setComunicados] = useState(() => load(`${condominioId}_comunicados`, SEED_COMUNICADOS))
  const [moradores, setMoradores] = useState(() => load(`${condominioId}_moradores`, SEED_MORADORES))
  const [despesas, setDespesas] = useState(() => load(`${condominioId}_despesas`, []))
  const [orcamentos, setOrcamentos] = useState(() => load(`${condominioId}_orcamentos`, []))
  const [usuarios, setUsuarios] = useState([])
  const [assembleias, setAssembleias] = useState([])
  const [votacoes, setVotacoes] = useState([])
  const [votos, setVotos] = useState([])

  useEffect(() => {
    if (!firestoreAtivo) return undefined
    setVisitantes([])
    setEncomendas([])
    setComunicados([])
    setMoradores([])
    setDespesas([])
    setOrcamentos([])
    setUsuarios([])
    setAssembleias([])
    setVotacoes([])
    setVotos([])
    const colecoes = [
      ['visitantes', setVisitantes],
      ['encomendas', setEncomendas],
      ['comunicados', setComunicados],
      ['moradores', setMoradores],
      ['despesas', setDespesas],
      ['orcamentos', setOrcamentos]
      , ['assembleias', setAssembleias]
      , ['votacoes', setVotacoes]
      , ['votos', setVotos]
    ]
    const listeners = colecoes.map(([nome, setDados]) => onSnapshot(
      collection(db, 'tenants', condominioId, nome),
      (snapshot) => setDados(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))),
      (error) => console.error(`Erro ao sincronizar ${nome}:`, error)
    ))
    const usuariosQuery = query(collection(db, 'users'), where('condominioId', '==', condominioId))
    const unsubscribeUsuarios = onSnapshot(usuariosQuery, (snapshot) => {
      setUsuarios(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
    }, (error) => console.error('Erro ao sincronizar usuários:', error))
    return () => {
      listeners.forEach((unsubscribe) => unsubscribe())
      unsubscribeUsuarios()
    }
  }, [condominioId, firestoreAtivo])

  function salvarDocumento(nome, item) {
    if (!firestoreAtivo) return
    setDoc(doc(db, 'tenants', condominioId, nome, item.id), item).catch((error) => {
      console.error(`Erro ao salvar ${nome}:`, error)
    })
  }

  function atualizarDocumento(nome, id, dados) {
    if (!firestoreAtivo) return
    updateDoc(doc(db, 'tenants', condominioId, nome, id), dados).catch((error) => {
      console.error(`Erro ao atualizar ${nome}:`, error)
    })
  }

  function removerDocumento(nome, id) {
    if (!firestoreAtivo) return
    deleteDoc(doc(db, 'tenants', condominioId, nome, id)).catch((error) => {
      console.error(`Erro ao remover ${nome}:`, error)
    })
  }

  // ---- Visitantes ----
  function registrarVisitante(dados) {
    const item = { id: uid(), ...dados, entrada: nowISO(), saida: null }
    setVisitantes((v) => {
      const atualizado = [item, ...v]
      save(`${condominioId}_visitantes`, atualizado)
      return atualizado
    })
    salvarDocumento('visitantes', item)
    // Notifica em segundo plano
    notificarNovoVisitante(item)
  }

  function registrarSaida(id) {
    const dados = { saida: nowISO() }
    setVisitantes((v) => {
      const atualizado = v.map((item) => (item.id === id ? { ...item, ...dados } : item))
      save(`${condominioId}_visitantes`, atualizado)
      return atualizado
    })
    atualizarDocumento('visitantes', id, dados)
  }

  function removerVisitante(id) {
    setVisitantes((v) => {
      const atualizado = v.filter((item) => item.id !== id)
      save(`${condominioId}_visitantes`, atualizado)
      return atualizado
    })
    removerDocumento('visitantes', id)
  }

  // ---- Encomendas ----
  function registrarEncomenda(dados) {
    const item = { id: uid(), ...dados, chegadaEm: nowISO(), retiradaEm: null }
    setEncomendas((e) => {
      const atualizado = [item, ...e]
      save(`${condominioId}_encomendas`, atualizado)
      return atualizado
    })
    salvarDocumento('encomendas', item)
    // Notifica em segundo plano
    notificarNovaEncomenda(item)
  }

  function confirmarRetirada(id, assinatura) {
    const dados = { retiradaEm: nowISO(), assinatura: assinatura || null }
    setEncomendas((e) => {
      const atualizado = e.map((item) => (item.id === id ? { ...item, ...dados } : item))
      save(`${condominioId}_encomendas`, atualizado)
      return atualizado
    })
    atualizarDocumento('encomendas', id, dados)
  }

  function removerEncomenda(id) {
    setEncomendas((e) => {
      const atualizado = e.filter((item) => item.id !== id)
      save(`${condominioId}_encomendas`, atualizado)
      return atualizado
    })
    removerDocumento('encomendas', id)
  }

  // Registra a data/hora em que o aviso da encomenda foi enviado ao morador
  function registrarAvisoEncomenda(id) {
    const avisadoEm = nowISO()
    // Atualiza estado local
    setEncomendas((e) => {
      const encontrado = e.find((item) => item.id === id)
      if (!encontrado) {
        console.warn('[AVISO ENCOMENDA] Encomenda não encontrada:', id)
        return e
      }
      const atualizado = e.map((item) => (item.id === id ? { ...item, avisadoEm } : item))
      // Backup no localStorage (persiste mesmo sem Firebase)
      save(`${condominioId}_encomendas`, atualizado)
      // Atualiza Firestore (sem esperar — fica em background)
      if (firestoreAtivo) {
        updateDoc(doc(db, 'tenants', condominioId, 'encomendas', id), { avisadoEm })
          .then(() => console.log('[AVISO ENCOMENDA] Firestore atualizado para', id))
          .catch((err) => console.error('[AVISO ERRO] Falha ao atualizar Firestore:', err.code, err.message))
      } else {
        console.warn('[AVISO ENCOMENDA] firestoreAtivo=false, salvo apenas no localStorage')
      }
      return atualizado
    })
  }

  // ---- Comunicados ----
  function criarComunicado(dados) {
    const item = { id: uid(), ...dados, criadoEm: nowISO() }
    setComunicados((c) => {
      const atualizado = [item, ...c]
      save(`${condominioId}_comunicados`, atualizado)
      return atualizado
    })
    salvarDocumento('comunicados', item)
  }

  function removerComunicado(id) {
    setComunicados((c) => {
      const atualizado = c.filter((item) => item.id !== id)
      save(`${condominioId}_comunicados`, atualizado)
      return atualizado
    })
    removerDocumento('comunicados', id)
  }

  function alternarFixado(id) {
    const item = comunicados.find((comunicado) => comunicado.id === id)
    if (!item) return
    const dados = { fixado: !item.fixado }
    setComunicados((c) => {
      const atualizado = c.map((atual) => (atual.id === id ? { ...atual, ...dados } : atual))
      save(`${condominioId}_comunicados`, atualizado)
      return atualizado
    })
    atualizarDocumento('comunicados', id, dados)
  }

  // ---- Moradores ----
  function cadastrarMorador(dados) {
    const item = { id: uid(), ...dados, criadoEm: nowISO() }
    setMoradores((m) => {
      const atualizado = [item, ...m]
      save(`${condominioId}_moradores`, atualizado)
      return atualizado
    })
    salvarDocumento('moradores', item)
  }

  function atualizarMorador(id, dados) {
    setMoradores((m) => {
      const atualizado = m.map((item) => (item.id === id ? { ...item, ...dados } : item))
      save(`${condominioId}_moradores`, atualizado)
      return atualizado
    })
    atualizarDocumento('moradores', id, dados)
  }

  function removerMorador(id) {
    setMoradores((m) => {
      const atualizado = m.filter((item) => item.id !== id)
      save(`${condominioId}_moradores`, atualizado)
      return atualizado
    })
    removerDocumento('moradores', id)
  }

  // ---- Despesas ----
  function registrarDespesa(dados) {
    if (!['sindico', 'zelador'].includes(userProfile?.role)) return
    const item = { id: uid(), ...dados, criadoEm: nowISO() }
    setDespesas((d) => {
      const atualizado = [item, ...d]
      save(`${condominioId}_despesas`, atualizado)
      return atualizado
    })
    salvarDocumento('despesas', item)
  }

  function atualizarDespesa(id, dados) {
    if (!['sindico', 'zelador'].includes(userProfile?.role)) return
    setDespesas((d) => {
      const atualizado = d.map((item) => (item.id === id ? { ...item, ...dados } : item))
      save(`${condominioId}_despesas`, atualizado)
      return atualizado
    })
    atualizarDocumento('despesas', id, dados)
  }

  function removerDespesa(id) {
    if (!['sindico', 'zelador'].includes(userProfile?.role)) return
    setDespesas((d) => {
      const atualizado = d.filter((item) => item.id !== id)
      save(`${condominioId}_despesas`, atualizado)
      return atualizado
    })
    removerDocumento('despesas', id)
  }

  // ---- Orçamento anual ----
  function salvarOrcamento(dados) {
    if (!['sindico', 'zelador'].includes(userProfile?.role)) return
    let alterado
    setOrcamentos((itens) => {
      const existe = itens.some((item) => item.ano === dados.ano && item.mes === dados.mes && item.categoria === dados.categoria)
      if (existe) {
        alterado = itens.find((item) => item.ano === dados.ano && item.mes === dados.mes && item.categoria === dados.categoria)
        const atualizados = itens.map((item) => (
          item.ano === dados.ano && item.mes === dados.mes && item.categoria === dados.categoria
            ? { ...item, valor: dados.valor, atualizadoEm: nowISO() }
            : item
        ))
        save(`${condominioId}_orcamentos`, atualizados)
        salvarDocumento('orcamentos', atualizados.find((item) => item.id === alterado.id))
        return atualizados
      }
      const novo = { id: uid(), ...dados, criadoEm: nowISO() }
      const atualizado = [novo, ...itens]
      save(`${condominioId}_orcamentos`, atualizado)
      salvarDocumento('orcamentos', novo)
      return atualizado
    })
  }

  function removerOrcamento(id) {
    if (!['sindico', 'zelador'].includes(userProfile?.role)) return
    setOrcamentos((itens) => {
      const atualizado = itens.filter((item) => item.id !== id)
      save(`${condominioId}_orcamentos`, atualizado)
      return atualizado
    })
    removerDocumento('orcamentos', id)
  }

  function criarAssembleia(dados) {
    if (!['sindico', 'zelador'].includes(userProfile?.role)) return
    const item = { id: uid(), ...dados, criadoEm: nowISO() }
    setAssembleias((lista) => {
      const atualizado = [item, ...lista]
      save(`${condominioId}_assembleias`, atualizado)
      return atualizado
    })
    salvarDocumento('assembleias', item)
  }

  function criarVotacao(dados) {
    if (!['sindico', 'zelador'].includes(userProfile?.role)) return
    const item = { id: uid(), ...dados, criadoEm: nowISO(), encerrada: false }
    setVotacoes((lista) => {
      const atualizado = [item, ...lista]
      save(`${condominioId}_votacoes`, atualizado)
      return atualizado
    })
    salvarDocumento('votacoes', item)
  }

  function encerrarAssembleia(id) {
    if (!['sindico', 'zelador'].includes(userProfile?.role)) return
    const encerradaEm = nowISO()
    setAssembleias((lista) => {
      const atualizado = lista.map((item) => item.id === id ? { ...item, encerrada: true, encerradaEm } : item)
      save(`${condominioId}_assembleias`, atualizado)
      return atualizado
    })
    atualizarDocumento('assembleias', id, { encerrada: true, encerradaEm })
  }

  function encerrarVotacao(id) {
    if (!['sindico', 'zelador'].includes(userProfile?.role)) return
    setVotacoes((lista) => {
      const atualizado = lista.map((item) => item.id === id ? { ...item, encerrada: true } : item)
      save(`${condominioId}_votacoes`, atualizado)
      return atualizado
    })
    atualizarDocumento('votacoes', id, { encerrada: true })
  }

  function votar(votacaoId, opcao) {
    if (!userProfile?.uid) return
    const existente = votos.find((voto) => voto.votacaoId === votacaoId && voto.usuarioId === userProfile.uid)
    if (existente) return
    const item = { id: `${votacaoId}_${userProfile.uid}`, votacaoId, usuarioId: userProfile.uid, usuarioNome: userProfile.nome || userProfile.email, assinatura: userProfile.nome || userProfile.email, opcao, criadoEm: nowISO() }
    setVotos((lista) => {
      const atualizado = [...lista, item]
      save(`${condominioId}_votos`, atualizado)
      return atualizado
    })
    salvarDocumento('votos', item)
  }

  const value = {
    condominioId,
    visitantes, registrarVisitante, registrarSaida, removerVisitante,
    encomendas, registrarEncomenda, confirmarRetirada, removerEncomenda, registrarAvisoEncomenda,
    comunicados, criarComunicado, removerComunicado, alternarFixado,
    moradores, cadastrarMorador, atualizarMorador, removerMorador,
    despesas, registrarDespesa, atualizarDespesa, removerDespesa,
    orcamentos, salvarOrcamento, removerOrcamento,
    usuarios
    , assembleias, votacoes, votos, criarAssembleia, criarVotacao, encerrarAssembleia, encerrarVotacao, votar
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp deve ser usado dentro de AppProvider')
  return ctx
}
