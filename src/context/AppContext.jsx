import React, { createContext, useContext, useEffect, useState } from 'react'
import { useAuth } from './AuthContext.jsx'
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, updateDoc, where } from 'firebase/firestore'
import { db } from '../firebase/config.js'
import { load, save, uid, nowISO } from '../utils/storage.js'
import { ACESSOS_POR_PERFIL } from '../utils/permissoes.js'
import { notificarNovaEncomenda, notificarNovoVisitante, solicitarPermissao } from '../utils/notificacao.js'
import { salvarTokenUsuario, notificarEncomendaPush, notificarVisitantePush, ativarListenerFrente, enviarPushTenant } from '../utils/push.js'

const AppContext = createContext(null)

// Componente modal de permissão de notificação
function ModalPermissaoNotificacao({ onAceitar, onFechar }) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'default') return null

  return (
    <div className="permissoes-overlay">
      <div className="permissoes-modal">
        <div className="permissoes-icone">🔔</div>
        <h3>Ativar notificações?</h3>
        <p>
          Para receber avisos de <strong>encomendas</strong> e <strong>visitantes</strong> em
          tempo real, precisamos da sua permissão.
        </p>
        <div className="permissoes-botoes">
          <button type="button" className="btn btn-ghost" onClick={onFechar}>
            Agora não
          </button>
          <button type="button" className="btn btn-brass" onClick={onAceitar}>
            Ativar
          </button>
        </div>
      </div>
    </div>
  )
}

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
  const [mostrarModalNotificacao, setMostrarModalNotificacao] = useState(false)
  const [erroAprovacao, setErroAprovacao] = useState('')

  // Mostra modal de permissão após login (se permissão ainda não foi decidida)
  useEffect(() => {
    if (!firestoreAtivo || !userProfile?.uid) return
    if (typeof Notification === 'undefined') return
    if (Notification.permission === 'default') {
      const jaViu = localStorage.getItem('condo_modal_notif_visto')
      if (!jaViu) {
        setTimeout(() => setMostrarModalNotificacao(true), 800)
      }
    }
  }, [firestoreAtivo, userProfile?.uid])

  // Quando permissão é concedida, salva o token automaticamente (sem precisar
  // clicar em nenhum botão). Antes qualquer erro aqui era engolido em silêncio
  // (.catch(() => {})), por isso parecia que "só funcionava clicando" — na
  // verdade a chamada automática estava falhando sem deixar rastro nenhum.
  useEffect(() => {
    if (!firestoreAtivo || !userProfile?.uid) return
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      console.log('[PUSH] Tentando salvar token automaticamente ao abrir o app...')
      salvarTokenUsuario(userProfile.condominioId, userProfile.uid, {
        dispositivo: navigator.platform || 'desconhecido'
      }).then((token) => {
        if (token) console.log('[PUSH] Token automático salvo com sucesso.')
        else console.warn('[PUSH] Salvamento automático retornou null — veja os avisos [PUSH] acima para o motivo.')
      }).catch((err) => {
        console.error('[PUSH] Falha ao salvar token automaticamente:', err)
      })
      ativarListenerFrente()
    }
  }, [firestoreAtivo, userProfile?.uid, userProfile?.condominioId])

  async function aceitarNotificacoes() {
    setMostrarModalNotificacao(false)
    localStorage.setItem('condo_modal_notif_visto', '1')
    try {
      const permissao = await solicitarPermissao()
      if (permissao === 'granted' && userProfile?.condominioId && userProfile?.uid) {
        await salvarTokenUsuario(userProfile.condominioId, userProfile.uid, {
          dispositivo: navigator.platform || 'desconhecido'
        })
      }
    } catch {
      // silencioso
    }
  }

  function fecharModalNotificacao() {
    setMostrarModalNotificacao(false)
    localStorage.setItem('condo_modal_notif_visto', '1')
  }



  const [visitantes, setVisitantes] = useState(() => load(`${condominioId}_visitantes`, []))
  const [encomendas, setEncomendas] = useState(() => load(`${condominioId}_encomendas`, []))
  const [comunicados, setComunicados] = useState(() => load(`${condominioId}_comunicados`, SEED_COMUNICADOS))
  const [moradores, setMoradores] = useState(() => load(`${condominioId}_moradores`, SEED_MORADORES))
  const [despesas, setDespesas] = useState(() => load(`${condominioId}_despesas`, []))
  const [orcamentos, setOrcamentos] = useState(() => load(`${condominioId}_orcamentos`, []))
  const [aprovacoes, setAprovacoes] = useState(() => load(`${condominioId}_aprovacoes`, []))
  const [usuarios, setUsuarios] = useState([])
  const [assembleias, setAssembleias] = useState([])
  const [votacoes, setVotacoes] = useState([])
  const [votos, setVotos] = useState([])

  // Registra o token FCM apenas quando o usuário solicitar explicitamente
  // (no celular, Notification.requestPermission() exige toque do usuário)
  useEffect(() => {
    if (firestoreAtivo) {
      // Apenas ativa o listener de notificações em primeiro plano
      ativarListenerFrente()
    }
  }, [firestoreAtivo])

  useEffect(() => {
    if (!firestoreAtivo) return undefined
    setVisitantes([])
    setEncomendas([])
    setComunicados([])
    setMoradores([])
    setDespesas([])
    setOrcamentos([])
    setAprovacoes([])
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
      , ['aprovacoes', setAprovacoes]
      , ['assembleias', setAssembleias]
      , ['votacoes', setVotacoes]
      , ['votos', setVotos]
    ]
    const listeners = colecoes.map(([nome, setDados]) => onSnapshot(
      collection(db, 'tenants', condominioId, nome),
      (snapshot) => {
        const remoto = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
        if (nome === 'aprovacoes') {
          // Mescla pendências locais ainda não refletidas no remoto: sem isso,
          // a aprovação feita neste dispositivo some da tela quando o snapshot
          // chega antes do servidor confirmar a nossa gravação.
          let local = null
          try {
            const bruto = localStorage.getItem(`condo_${condominioId}_${nome}`)
            local = bruto ? JSON.parse(bruto) : null
          } catch {
            local = null
          }
          if (Array.isArray(local) && local.length > 0) {
            const idsRemotos = new Set(remoto.map((item) => item.id))
            const pendentes = local.filter(
              (item) => item && item.id && !idsRemotos.has(item.id)
            )
            setDados(pendentes.length > 0 ? [...pendentes, ...remoto] : remoto)
          } else {
            setDados(remoto)
          }
        } else {
          setDados(remoto)
        }
        if (nome === 'aprovacoes') setErroAprovacao('')
      },
      (error) => {
        console.error(`Erro ao sincronizar ${nome}:`, error)
        if (nome === 'aprovacoes' && String(error?.code || '').includes('permission')) {
          setErroAprovacao('Sem permissão para ler as aprovações. Publique as regras atualizadas (Firestore → Rules → Publish) para que as aprovações dos conselheiros apareçam.')
        }
      }
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

  function salvarDocumento(nome, item, onErro) {
    if (!firestoreAtivo) return
    setDoc(doc(db, 'tenants', condominioId, nome, item.id), item).catch((error) => {
      console.error(`Erro ao salvar ${nome}:`, error)
      if (nome === 'aprovacoes') {
        setErroAprovacao(
          String(error?.code || '').includes('permission')
            ? 'A aprovação foi registrada neste dispositivo, mas o Firestore recusou a gravação. Publique as regras atualizadas (Firestore → Rules → Publish) para que os outros usuários vejam a aprovação.'
            : `Falha ao sincronizar a aprovação: ${error?.message || error}`
        )
      }
      if (typeof onErro === 'function') onErro(error)
    })
  }

  function atualizarDocumento(nome, id, dados) {
    if (!firestoreAtivo) return
    updateDoc(doc(db, 'tenants', condominioId, nome, id), dados).catch((error) => {
      console.error(`Erro ao atualizar ${nome}:`, error)
    })
  }

  function removerDocumento(nome, id, onErro) {
    if (!firestoreAtivo) return
    deleteDoc(doc(db, 'tenants', condominioId, nome, id)).catch((error) => {
      console.error(`Erro ao remover ${nome}:`, error)
      if (nome === 'aprovacoes') {
        setErroAprovacao(
          String(error?.code || '').includes('permission')
            ? 'O Firestore recusou a remoção da aprovação. Publique as regras atualizadas (Firestore → Rules → Publish). A lista será restaurada na próxima sincronização.'
            : `Falha ao sincronizar a remoção da aprovação: ${error?.message || error}`
        )
      }
      if (typeof onErro === 'function') onErro(error)
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
    // Notificação local (funciona enquanto o app está aberto/minimizado)
    notificarNovoVisitante(item)
    // Push real para o tenant (funciona mesmo com o app FECHADO no celular)
    if (userProfile?.condominioId) {
      notificarVisitantePush(userProfile.condominioId, item).catch(() => {})
    }
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
    // Notificação local (funciona enquanto o app está aberto/minimizado)
    notificarNovaEncomenda(item)
    // Push real para o tenant (funciona mesmo com o app FECHADO no celular)
    if (userProfile?.condominioId) {
      notificarEncomendaPush(userProfile.condominioId, item).catch(() => {})
    }
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
    // ENVIO PARA TODOS: além de aparecer no mural, o comunicado dispara
    // notificação push automática para TODOS os dispositivos cadastrados do
    // condomínio (via Cloud Function, que envia para cada pushToken do tenant).
    if (userProfile?.condominioId) {
      enviarPushTenant(
        userProfile.condominioId,
        `📢 ${dados.titulo || 'Novo comunicado'}`,
        String(dados.conteudo || '').slice(0, 180) || 'Novo comunicado publicado no mural.',
        '/mural'
      )
        .then((ok) => console.log('[MURAL PUSH] Envio para o condomínio:', ok ? 'OK' : 'sem tokens/sem sucesso'))
        .catch(() => {})
    }
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
            ? { ...item, valor: dados.valor, itens: Array.isArray(dados.itens) ? dados.itens : (item.itens || []), atualizadoEm: nowISO() }
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

  // ---- Aprovação de orçamentos (Conselheiros e convidados) ----
  function podeAprovarOrcamento() {
    const role = userProfile?.role
    if (['sindico', 'zelador', 'conselheiro'].includes(role)) return true
    // Moradores convidados por um conselheiro/síndico também podem aprovar
    if (role === 'morador') {
      if (userProfile?.convidadoParaAprovar === true) return true
      return usuarios.some((u) => (u.uid === userProfile?.uid || u.email === userProfile?.email) && u.convidadoParaAprovar === true)
    }
    return false
  }

  function podeConvidarAprovadores() {
    return ['sindico', 'conselheiro'].includes(userProfile?.role)
  }

  function aprovarOrcamento(decididos, ano, mes, assinatura) {
    if (!podeAprovarOrcamento() || !Array.isArray(decididos) || decididos.length === 0) return
    const chaveUsuario = userProfile?.uid || userProfile?.email || 'local'
    const agora = nowISO()
    const itensNovos = decididos.map((decisao) => {
      const orcamentoId = decisao.orcamentoId || ''
      const itemId = decisao.itemId || 'item'
      return {
        id: `${ano}-${String(mes).padStart(2, '0')}-${orcamentoId}-${itemId}-${chaveUsuario}`,
        orcamentoId,
        itemId,
        itemDescricao: decisao.descricao || '',
        itemValor: Number(decisao.valor) || 0,
        ano: Number(ano),
        mes: Number(mes),
        aprovado: decisao.aprovado !== false,
        usuarioId: userProfile?.uid || null,
        usuarioEmail: userProfile?.email || '',
        usuarioNome: userProfile?.nome || userProfile?.email || 'Usuário',
        usuarioRole: userProfile?.role || '',
        assinatura: assinatura || '',
        criadoEm: agora
      }
    })
    setAprovacoes((lista) => {
      const semAntigos = lista.filter((a) => !itensNovos.some((n) => n.id === a.id))
      const atualizado = [...itensNovos, ...semAntigos]
      save(`${condominioId}_aprovacoes`, atualizado)
      return atualizado
    })
    if (firestoreAtivo) {
      itensNovos.forEach((item) => salvarDocumento('aprovacoes', item))
    }
  }

  function removerAprovacaoOrcamento(orcamentoId, itemId, ano, mes) {
    if (!podeAprovarOrcamento()) return
    const chaveUsuario = userProfile?.uid || userProfile?.email || 'local'
    const chaveItem = itemId || 'item'
    const id = `${ano}-${String(mes).padStart(2, '0')}-${orcamentoId}-${chaveItem}-${chaveUsuario}`
    setAprovacoes((lista) => {
      const atualizado = lista.filter((a) => a.id !== id)
      save(`${condominioId}_aprovacoes`, atualizado)
      return atualizado
    })
    removerDocumento('aprovacoes', id)
  }

  async function alternarConviteAprovacao(usuarioAlvo) {
    if (!podeConvidarAprovadores()) return
    const convidado = !usuarioAlvo.convidadoParaAprovar
    const acessosAtuais = Array.isArray(usuarioAlvo.acessos) ? usuarioAlvo.acessos : (ACESSOS_POR_PERFIL[usuarioAlvo.role] || [])
    const novosAcessos = convidado
      ? (acessosAtuais.includes('orcamento') ? acessosAtuais : [...acessosAtuais, 'orcamento'])
      : acessosAtuais.filter((a) => a !== 'orcamento')
    setUsuarios((lista) => lista.map((u) => (u.id === usuarioAlvo.id ? { ...u, convidadoParaAprovar: convidado, acessos: novosAcessos } : u)))
    if (firestoreAtivo) {
      await updateDoc(doc(db, 'users', usuarioAlvo.id), { convidadoParaAprovar: convidado, acessos: novosAcessos })
    }
    return convidado
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
    if (!['sindico', 'zelador'].includes(userProfile?.role)) return null
    const item = { id: uid(), ...dados, criadoEm: nowISO(), encerrada: false }
    setVotacoes((lista) => {
      const atualizado = [item, ...lista]
      save(`${condominioId}_votacoes`, atualizado)
      return atualizado
    })
    salvarDocumento('votacoes', item)
    // Retorna o id para a tela abrir o card da pesquisa recém-criada.
    return item.id
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
    // Votação encerrada não aceita voto novo nem alteração de voto (a regra do
    // Firestore também bloqueia no servidor; aqui é defesa extra na UI).
    const votacao = votacoes.find((item) => item.id === votacaoId)
    if (votacao?.encerrada) return
    const existente = votos.find((voto) => voto.votacaoId === votacaoId && voto.usuarioId === userProfile.uid)
    if (existente && existente.opcao === opcao) return
    if (existente) {
      // Editar o voto: permitido até a votação ser encerrada. Mantém a data do
      // voto original (criadoEm) e registra quando foi alterado (editadoEm),
      // preservando a auditoria no registro individual. O id determinístico
      // (votacaoId_uid) mantém o mesmo documento no Firestore (updateDoc).
      const editadoEm = nowISO()
      const votoEditado = { ...existente, opcao, editadoEm }
      setVotos((lista) => {
        const atualizado = lista.map((voto) => (voto.id === existente.id ? votoEditado : voto))
        save(`${condominioId}_votos`, atualizado)
        return atualizado
      })
      atualizarDocumento('votos', existente.id, { opcao, editadoEm })
      return
    }
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
    aprovacoes, erroAprovacao, aprovarOrcamento, removerAprovacaoOrcamento, alternarConviteAprovacao, podeAprovarOrcamento, podeConvidarAprovadores,
    usuarios
    , assembleias, votacoes, votos, criarAssembleia, criarVotacao, encerrarAssembleia, encerrarVotacao, votar
  }

  return (
    <AppContext.Provider value={value}>
      {mostrarModalNotificacao && (
        <ModalPermissaoNotificacao
          onAceitar={aceitarNotificacoes}
          onFechar={fecharModalNotificacao}
        />
      )}
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp deve ser usado dentro de AppProvider')
  return ctx
}