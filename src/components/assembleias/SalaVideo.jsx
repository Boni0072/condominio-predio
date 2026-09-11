import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where
} from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../../firebase/config.js'

// ---------------------------------------------------------------------------
// Sala de vídeo das assembleias — WebRTC em mesh (ponto a ponto entre todos
// os participantes) com o Firestore como canal de sinalização (troca de
// offer/answer/ICE por documentos, apagados após processados). Toda a lógica
// de conexão vive neste componente, para facilitar uma futura troca por um
// SFU externo (Daily.co, LiveKit Cloud, Twilio Video) se a chamada crescer
// muito: mesh cresce O(n²) e funciona bem até ~6-8 participantes com vídeo.
// ---------------------------------------------------------------------------

// Servidores ICE: STUN público do Google. Em redes com NAT restritivo
// (CGNAT residencial/móvel, comum no Brasil) a conexão direta pode falhar —
// para produção, contrate/configure um TURN (coturn, Xirsys, Twilio NTS) e
// acrescente-o à lista abaixo. Sem TURN a sala continua funcionando entre
// participantes na mesma rede ou com NAT amigável.
const SERVIDORES_ICE = [
  { urls: 'stun:stun.l.google.com:19302' }
  // Exemplo de TURN (descomente e preencha com suas credenciais):
  // , { urls: 'turn:turn.seudominio.com.br:3478', username: 'condominio', credential: 'senha' }
  // , { urls: 'turns:turn.seudominio.com.br:5349', username: 'condominio', credential: 'senha' }
]

// Presença: cada cliente publica um "batimento" (heartbeat) no próprio
// documento; quem ficar sem batimento por mais de LIMITE_FANTASMA_MS é
// removido da sala por qualquer outro cliente (limpeza de fantasmas quando
// a aba é fechada sem clicar em "Sair").
const INTERVALO_BATIMENTO_MS = 15000
const INTERVALO_VASSOURA_MS = 20000
const LIMITE_FANTASMA_MS = 60000
// Limite de mensagens carregadas no chat: histórico suficiente para o
// contexto da assembleia sem pesar em reuniões muito longas.
const LIMITE_MENSAGENS_CHAT = 200
// Gravação: tipo de vídeo preferido para compatibilidade entre navegadores.
const TIPO_GRAVACAO = 'video/webm;codecs=vp9,opus'
const EXTENSAO_GRAVACAO = 'webm'

const ROTULOS_PERFIL = {
  master: 'Master',
  sindico: 'Síndico',
  zelador: 'Zelador',
  portaria: 'Portaria',
  conselheiro: 'Conselheiro',
  morador: 'Morador'
}

function iniciaisDoNome(nome) {
  const iniciais = String(nome || '?').trim().split(/\s+/).slice(0, 2).map((parte) => parte[0]?.toUpperCase() || '').join('')
  return iniciais || '?'
}

function mensagemErroMidia(erro) {
  const codigo = erro?.name || ''
  if (codigo === 'NotAllowedError' || codigo === 'SecurityError') return 'Permissão negada. Autorize a câmera e o microfone do navegador para entrar na sala.'
  if (codigo === 'NotFoundError' || codigo === 'DevicesNotFoundError') return 'Nenhuma câmera ou microfone encontrado neste dispositivo.'
  if (codigo === 'NotReadableError' || codigo === 'TrackStartError') return 'A câmera ou o microfone está em uso por outro aplicativo. Feche-o e tente novamente.'
  return 'Não foi possível acessar a câmera e o microfone. Verifique as permissões do navegador e tente novamente.'
}

// Apaga todos os sinais pendentes de/para o participante (lixo de sessões
// anteriores, por exemplo quando a aba foi fechada sem processar tudo).
function apagarSinaisDoParticipante(tenantId, salaId, uidLocal) {
  const colecaoSinais = collection(db, 'tenants', tenantId, 'salasVideo', salaId, 'sinais')
  const apagarPor = async (campo) => {
    try {
      const foto = await getDocs(query(colecaoSinais, where(campo, '==', uidLocal)))
      await Promise.all(foto.docs.map((documento) => deleteDoc(documento.ref).catch(() => {})))
    } catch (erro) {
      console.warn(`[SalaVideo] Falha ao limpar sinais por ${campo}:`, erro)
    }
  }
  return Promise.all([apagarPor('para'), apagarPor('de')])
}

function VideoItem({ stream, nome, papel, unidade, proprio, microfone, camera, temVideo }) {
  const videoRef = useRef(null)

  useEffect(() => {
    const elemento = videoRef.current
    if (!elemento) return
    if (elemento.srcObject !== (stream || null)) elemento.srcObject = stream || null
    if (proprio) elemento.muted = true
  }, [stream, proprio])

  const mostraVideo = Boolean(stream) && temVideo !== false && camera !== false

  return (
    <div className={'assembleia-video-item' + (mostraVideo ? '' : ' sem-camera')}>
      {mostraVideo
        ? <video ref={videoRef} autoPlay playsInline />
        : <div className="assembleia-video-avatar">{iniciaisDoNome(nome)}</div>}
      <div className="assembleia-video-info">
        <span className="assembleia-video-nome">{nome}{proprio ? ' (você)' : ''}</span>
        <small className="assembleia-video-papel">{papel}{unidade ? ` · ${unidade}` : ''}</small>
      </div>
      {microfone === false && <span className="assembleia-video-estado">Microfone desativado</span>}
      {camera === false && <span className="assembleia-video-estado assembleia-video-estado-camera">Câmera desligada</span>}
    </div>
  )
}

export default function SalaVideo({ assembleiaId, usuario, ativo, linkExterno }) {
  const [fase, setFase] = useState('fora') // 'fora' | 'conectando' | 'dentro'
  const [erro, setErro] = useState('')
  const [participantes, setParticipantes] = useState([])
  const [remotos, setRemotos] = useState({}) // uid -> MediaStream
  const [streamLocal, setStreamLocal] = useState(null)
  const [micAtivo, setMicAtivo] = useState(true)
  const [cameraAtiva, setCameraAtiva] = useState(true)
  const [temCamera, setTemCamera] = useState(true)
  const [mensagens, setMensagens] = useState([])
  const [novaMensagem, setNovaMensagem] = useState('')
  const [gravacoes, setGravacoes] = useState([])
  const [gravando, setGravando] = useState(false)

  const gravadorRef = useRef(null)
  const chunksGravacaoRef = useRef([])
  const gravacaoIniciadaRef = useRef(false)
  const contextoGravacaoRef = useRef(null)
  const [erroGravacao, setErroGravacao] = useState('')

  // Gravação: usa o stream local diretamente (mais estável que mixagem).
  // Inicia automaticamente ao entrar na sala e salva ao sair/encerrar.
  function iniciarGravacao() {
    if (gravacaoIniciadaRef.current) return
    const stream = streamLocalRef.current
    if (!stream || !window.MediaRecorder) return

    // Salva snapshot do contexto E do id da sala: quando o onstop disparar
    // (evento assíncrono), desconectarTudo() já limpou contextoSalaRef e
    // salaAtivaRef — nada dos refs vivos pode ser lido nesse momento. Só o
    // snapshot capturado aqui sobrevive até o onstop.
    const contextoAtual = contextoSalaRef.current
    const salaAtual = salaAtivaRef.current
    if (!contextoAtual || !salaAtual) return
    contextoGravacaoRef.current = { ...contextoAtual, salaId: salaAtual }

    let mimeType = 'video/webm'
    if (MediaRecorder.isTypeSupported(TIPO_GRAVACAO)) mimeType = TIPO_GRAVACAO
    else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')) mimeType = 'video/webm;codecs=vp8,opus'

    try {
      const gravador = new MediaRecorder(stream, { mimeType })
      chunksGravacaoRef.current = []

      gravador.ondataavailable = (evento) => {
        if (evento.data && evento.data.size > 0) chunksGravacaoRef.current.push(evento.data)
      }

      gravador.onstop = async () => {
        // Tudo vem do snapshot capturado em iniciarGravacao: os refs vivos
        // (contextoSalaRef/salaAtivaRef) já foram limpos pelo
        // desconectarTudo quando este evento dispara.
        const snapshot = contextoGravacaoRef.current
        contextoGravacaoRef.current = null
        gravacaoIniciadaRef.current = false
        setGravando(false)

        const chunks = chunksGravacaoRef.current.splice(0)
        const contexto = snapshot ? { condominioId: snapshot.condominioId, uid: snapshot.uid } : null
        const salaId = snapshot ? snapshot.salaId : null
        if (!contexto || !salaId || chunks.length === 0) return

        const blob = new Blob(chunks, { type: 'video/webm' })
        if (blob.size < 1000) return

        const nomeArquivo = `assembleia-${salaId}-${Date.now()}.${EXTENSAO_GRAVACAO}`
        const caminho = `tenants/${contexto.condominioId}/salasVideo/${salaId}/gravacoes/${nomeArquivo}`
        try {
          const refArquivo = storageRef(storage, caminho)
          await uploadBytes(refArquivo, blob)
          const url = await getDownloadURL(refArquivo)
          await addDoc(collection(db, 'tenants', contexto.condominioId, 'salasVideo', salaId, 'gravacoes'), {
            url,
            caminho,
            tamanho: blob.size,
            criadoEm: serverTimestamp(),
            por: contexto.uid
          })
        } catch (erro) {
          console.warn('[SalaVideo] Falha ao salvar gravação:', erro)
        }
      }

      gravador.start(1000)
      gravadorRef.current = gravador
      gravacaoIniciadaRef.current = true
      setGravando(true)
    } catch (erro) {
      console.warn('[SalaVideo] Falha ao iniciar gravação:', erro)
      contextoGravacaoRef.current = null
      setErroGravacao('Não foi possível gravar a reunião.')
    }
  }

  async function pararGravacao() {
    const gravador = gravadorRef.current
    if (!gravador || gravador.state === 'inactive') {
      gravacaoIniciadaRef.current = false
      contextoGravacaoRef.current = null
      setGravando(false)
      return
    }
    gravador.stop() // onstop disparará e salvará
  }

  const pararGravacoesRef = useRef(null)

  const mensagensRef = useRef([])
  const rolamentoRef = useRef(null)
  const rolamentoNoFimRef = useRef(true)

  const ehAdministrador = ['sindico', 'zelador', 'master'].includes(usuario?.role)

  function formatarHora(criadoEm) {
    try {
      if (!criadoEm) return ''
      const data = criadoEm.toDate?.()
      if (!(data instanceof Date) || isNaN(data.getTime())) return ''
      return data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    } catch {
      return ''
    }
  }

  // Derivados do estado de fase — declarados aqui (antes dos efeitos) para
  // poderem ser referenciados pelo useEffect de gravação sem "Cannot access
  // before initialization".
  const naSala = fase === 'dentro'
  const conectando = fase === 'conectando'

  const meuUid = usuario?.uid || null
  // Padrão do projeto: quando o perfil não tem condomínio formal (ex.:
  // master), usa-se o próprio uid como identificador do tenant.
  const condominioId = usuario?.condominioId || usuario?.uid || null
  const temContexto = Boolean(assembleiaId && meuUid && condominioId)

  // Refs: a conexão vive fora do ciclo de renderização (callbacks do WebRTC e
  // do Firestore), por isso o estado vivo da sala fica em refs.
  const naSalaRef = useRef(false)
  const salaAtivaRef = useRef(null) // id da assembleia em que estou na sala
  const contextoSalaRef = useRef(null) // { condominioId, uid } de quem entrou
  const streamLocalRef = useRef(null)
  const conexoesRef = useRef(new Map()) // uid -> { pc, pendentes, reinicios }
  const participantesRef = useRef([])
  const pararListenersRef = useRef([])
  const intervalosRef = useRef([])
  const aoDescarregarRef = useRef(null)
  const micRef = useRef(true)
  const camRef = useRef(true)

  // Sai da sala: para faixas de mídia, fecha conexões, remove listeners e
  // limpa presença/sinais no Firestore (melhor esforço, sem bloquear a UI).
  // IMPORTANTE: a gravação deve ser finalizada ANTES de limpar o contexto,
  // senão o arquivo não consegue ser salvo (perde a referência da sala).
  const desconectarTudo = useCallback(async () => {
    naSalaRef.current = false

    // 1. Para a gravação PRIMEIRO (antes de limpar qualquer referência)
    if (gravacaoIniciadaRef.current) {
      await pararGravacao()
    }

    // 2. Agora sim, limpa listeners, conexões e mídia
    pararListenersRef.current.forEach((parar) => { try { parar() } catch { /* ignora */ } })
    pararListenersRef.current = []
    intervalosRef.current.forEach((intervalo) => clearInterval(intervalo))
    intervalosRef.current = []
    if (aoDescarregarRef.current) {
      window.removeEventListener('pagehide', aoDescarregarRef.current)
      window.removeEventListener('beforeunload', aoDescarregarRef.current)
      aoDescarregarRef.current = null
    }
    conexoesRef.current.forEach((conexao) => { try { conexao.pc.close() } catch { /* ignora */ } })
    conexoesRef.current = new Map()
    if (streamLocalRef.current) {
      streamLocalRef.current.getTracks().forEach((faixa) => { try { faixa.stop() } catch { /* ignora */ } })
      streamLocalRef.current = null
    }

    // 3. Limpa presença e sinais no Firestore
    const contexto = contextoSalaRef.current
    const sala = salaAtivaRef.current
    contextoSalaRef.current = null
    salaAtivaRef.current = null
    if (contexto && sala) {
      deleteDoc(doc(db, 'tenants', contexto.condominioId, 'salasVideo', sala, 'participantes', contexto.uid)).catch(() => {})
      apagarSinaisDoParticipante(contexto.condominioId, sala, contexto.uid)
    }

    // 4. Atualiza estado da UI
    participantesRef.current = []
    setParticipantes([])
    setRemotos({})
    setStreamLocal(null)
    micRef.current = true
    camRef.current = true
    setMicAtivo(true)
    setCameraAtiva(true)
    setTemCamera(true)
    setFase('fora')
    setErro('')
  }, [])

  // Trocar de assembleia selecionada (ou desmontar a página) encerra a sala.
  useEffect(() => () => desconectarTudo(), [assembleiaId, desconectarTudo])

  // Assembleia encerrada enquanto a sala está aberta: sai imediatamente.
  useEffect(() => {
    if (!ativo && naSalaRef.current) desconectarTudo()
  }, [ativo, desconectarTudo])

  // Chat: o listener começa assim que há contexto (antes mesmo de entrar na
  // chamada de vídeo) e encerra ao desmontar ou trocar de assembleia. Assim,
  // quem está só acompanhando por texto também participa.
  const pararChatRef = useRef(null)
  useEffect(() => {
    if (!temContexto) return undefined
    if (pararChatRef.current) pararChatRef.current()
    pararChatRef.current = iniciarChat()
    return () => {
      if (pararChatRef.current) {
        pararChatRef.current()
        pararChatRef.current = null
      }
    }
  }, [assembleiaId, condominioId, meuUid, temContexto, iniciarChat])

  // Rolagem automática para a mensagem mais recente, mas apenas quando o
  // usuário já está no fundo da lista (evita puxar o scroll enquanto a pessoa
  // lê o histórico mais acima).
  useEffect(() => {
    if (rolamentoNoFimRef.current) rolarParaFim()
  }, [mensagens])

  // Lista de gravações: visível antes e durante a chamada, para que o
  // histórico de vídeos fique acessível mesmo após encerrar a assembleia.
  useEffect(() => {
    if (!temContexto) return undefined
    if (pararGravacoesRef.current) pararGravacoesRef.current()
    pararGravacoesRef.current = iniciarListagemGravacoes()
    return () => {
      if (pararGravacoesRef.current) {
        pararGravacoesRef.current()
        pararGravacoesRef.current = null
      }
    }
  }, [assembleiaId, condominioId, meuUid, temContexto, iniciarListagemGravacoes])

  // Gravação automática: inicia ao entrar na sala (se o navegador suporta
  // MediaRecorder) e para + salva ao sair ou ao encerrar a assembleia.
  useEffect(() => {
    console.log('[SalaVideo] useEffect gravação:', { naSala, naSalaRef: naSalaRef.current, fase, streamLocal: !!streamLocalRef.current, MediaRecorder: !!window.MediaRecorder })
    if (!naSala || !naSalaRef.current) {
      // Saiu da sala: para a gravação se ainda estiver ativa
      if (gravacaoIniciadaRef.current) {
        console.log('[SalaVideo] Parando gravação ao sair da sala...')
        pararGravacao()
      }
      return undefined
    }
    // Entrou na sala: inicia a gravação
    if (window.MediaRecorder) {
      iniciarGravacao()
    } else {
      console.warn('[SalaVideo] MediaRecorder não suportado neste navegador')
    }
    return () => {
      if (gravacaoIniciadaRef.current) {
        console.log('[SalaVideo] Parando gravação (cleanup do useEffect)...')
        pararGravacao()
      }
    }
  }, [naSala])

  function enviarSinal(paraUid, tipo, conteudo) {
    const contexto = contextoSalaRef.current
    const sala = salaAtivaRef.current
    if (!contexto || !sala || !naSalaRef.current) return
    addDoc(collection(db, 'tenants', contexto.condominioId, 'salasVideo', sala, 'sinais'), {
      de: contexto.uid,
      para: paraUid,
      tipo,
      conteudo,
      criadoEm: serverTimestamp()
    }).catch((erroSinal) => console.warn('[SalaVideo] Falha ao enviar sinal:', erroSinal))
  }

  function esvaziarPendentes(conexao) {
    const pendentes = conexao.pendentes.splice(0)
    for (const candidato of pendentes) {
      conexao.pc.addIceCandidate(candidato).catch((erroCandidato) => console.warn('[SalaVideo] Falha ao aplicar candidato ICE:', erroCandidato))
    }
  }

  function fecharConexao(outroUid) {
    const conexao = conexoesRef.current.get(outroUid)
    if (!conexao) return
    try {
      conexao.pc.onicecandidate = null
      conexao.pc.ontrack = null
      conexao.pc.onnegotiationneeded = null
      conexao.pc.oniceconnectionstatechange = null
      conexao.pc.close()
    } catch { /* ignora */ }
    conexoesRef.current.delete(outroUid)
  }

  function criarConexao(outroUid) {
    const existente = conexoesRef.current.get(outroUid)
    if (existente) return existente
    const stream = streamLocalRef.current
    if (!stream || !naSalaRef.current) return null

    const pc = new RTCPeerConnection({ iceServers: SERVIDORES_ICE })
    const conexao = { pc, pendentes: [], reinicios: 0 }
    conexoesRef.current.set(outroUid, conexao)

    stream.getTracks().forEach((faixa) => { try { pc.addTrack(faixa, stream) } catch { /* ignora */ } })

    pc.onicecandidate = (evento) => {
      if (evento.candidate) enviarSinal(outroUid, 'candidato', JSON.stringify(evento.candidate.toJSON()))
    }
    pc.ontrack = (evento) => {
      const streamRemoto = evento.streams[0]
      if (!streamRemoto) return
      remotosRef.current[outroUid] = streamRemoto
      setRemotos((atual) => (atual[outroUid] === streamRemoto ? atual : { ...atual, [outroUid]: streamRemoto }))
    }
    pc.onnegotiationneeded = async () => {
      // Mesh sem colisão de ofertas ("glare"): em cada par, apenas o
      // participante com o uid lexicograficamente MENOR cria a oferta;
      // o outro apenas responde.
      if (meuUid >= outroUid) return
      try {
        const oferta = await pc.createOffer()
        await pc.setLocalDescription(oferta)
        enviarSinal(outroUid, 'oferta', JSON.stringify(pc.localDescription))
      } catch (erroOferta) {
        console.warn('[SalaVideo] Falha ao criar oferta:', erroOferta)
      }
    }
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState !== 'failed' || !naSalaRef.current) return
      // Sem TURN, pares atrás de NAT restritivo podem falhar. O iniciador
      // reinicia o ICE (nova oferta pela mesma conexão); quem responde aguarda
      // a nova oferta do par. Limita as tentativas para não entrar em loop.
      if (meuUid >= outroUid || conexao.reinicios >= 3) return
      conexao.reinicios += 1
      try { pc.restartIce?.() } catch { /* ignora */ }
    }
    return conexao
  }

  function verificarConexoes(lista) {
    if (!naSalaRef.current) return
    const conectados = new Set(lista.filter((participante) => participante.id !== meuUid).map((participante) => participante.id))
    for (const [outroUid] of conexoesRef.current) {
      if (!conectados.has(outroUid)) {
        fecharConexao(outroUid)
        setRemotos((atual) => {
          if (!(outroUid in atual)) return atual
          const novo = { ...atual }
          delete novo[outroUid]
          return novo
        })
      }
    }
    conectados.forEach((outroUid) => {
      if (!conexoesRef.current.has(outroUid)) criarConexao(outroUid)
    })
  }

  function processarSinal(documentoSinal) {
    const sinal = documentoSinal.data() || {}
    const origem = sinal.de
    const conexao = (!origem || origem === meuUid || !naSalaRef.current) ? null : criarConexao(origem)
    if (!conexao) {
      deleteDoc(documentoSinal.ref).catch(() => {})
      return
    }
    const { pc } = conexao
    const executar = async () => {
      try {
        if (sinal.tipo === 'oferta') {
          await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(sinal.conteudo)))
          const resposta = await pc.createAnswer()
          await pc.setLocalDescription(resposta)
          enviarSinal(origem, 'resposta', JSON.stringify(pc.localDescription))
          esvaziarPendentes(conexao)
        } else if (sinal.tipo === 'resposta') {
          if (pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(sinal.conteudo)))
            esvaziarPendentes(conexao)
          }
        } else if (sinal.tipo === 'candidato') {
          const candidato = new RTCIceCandidate(JSON.parse(sinal.conteudo))
          // Candidatos podem chegar antes da descrição remota: guarda e aplica
          // depois, na ordem.
          if (pc.remoteDescription) await pc.addIceCandidate(candidato)
          else conexao.pendentes.push(candidato)
        }
      } catch (erroSinal) {
        console.warn('[SalaVideo] Falha ao processar sinal:', erroSinal)
      } finally {
        // Documentos de sinal são apagados após processados (não acumulam lixo).
        deleteDoc(documentoSinal.ref).catch(() => {})
      }
    }
    executar()
  }

  function removerFantasmas(lista) {
    const contexto = contextoSalaRef.current
    const sala = salaAtivaRef.current
    if (!contexto || !sala || !naSalaRef.current) return
    lista.forEach((participante) => {
      const batimentoMs = participante.atualizadoEm?.toMillis?.()
      if (typeof batimentoMs === 'number' && Date.now() - batimentoMs > LIMITE_FANTASMA_MS) {
        deleteDoc(doc(db, 'tenants', contexto.condominioId, 'salasVideo', sala, 'participantes', participante.id)).catch(() => {})
      }
    })
  }

  function bater() {
    const contexto = contextoSalaRef.current
    const sala = salaAtivaRef.current
    if (!contexto || !sala || !naSalaRef.current) return
    // setDoc com merge: recria o documento se outro cliente o removeu por
    // considerar este participante um fantasma (aba suspensa por muito tempo).
    setDoc(doc(db, 'tenants', contexto.condominioId, 'salasVideo', sala, 'participantes', contexto.uid), {
      atualizadoEm: serverTimestamp(),
      microfone: micRef.current,
      camera: camRef.current
    }, { merge: true }).catch(() => {})
  }

  // Gravação da reunião: mixa o áudio local com os streams remotos para um
  // único arquivo. Usa MediaRecorder sobre um stream composto (Web Audio API
  // + Canvas para composição visual, ou apenas áudio mixado quando não há
  // canvas). Salva no Firebase Storage ao encerrar.
  function criarStreamMixado() {
    const streamLocal = streamLocalRef.current
    // Usa o estado atual dos streams remotos (atualizado pelo React).
    const streamsRemotos = Object.values(remotos).filter(Boolean)
    const todosStreams = [streamLocal, ...streamsRemotos].filter(Boolean)
    console.log('[SalaVideo] criarStreamMixado:', { temLocal: !!streamLocal, remotos: streamsRemotos.length, total: todosStreams.length })
    if (!todosStreams.length) return null

    // Mixagem de áudio via Web Audio API (funciona mesmo sem câmera).
    const contextoAudio = new (window.AudioContext || window.webkitAudioContext)()
    const destino = contextoAudio.createMediaStreamDestination()
    todosStreams.forEach((stream) => {
      try {
        const fonte = contextoAudio.createMediaStreamSource(stream)
        fonte.connect(destino)
      } catch { /* stream sem áudio é ignorado */ }
    })

    // Para vídeo, usamos o stream local como base (quando disponível);
    // caso contrário, apenas áudio é gravado.
    const faixasVideo = streamLocal?.getVideoTracks() || []
    const streamFinal = new MediaStream()
    faixasVideo.forEach((faixa) => streamFinal.addTrack(faixa))
    destino.stream.getAudioTracks().forEach((faixa) => streamFinal.addTrack(faixa))
    return streamFinal
  }

  function iniciarChat() {
    const contexto = contextoSalaRef.current || (temContexto ? { condominioId, uid: meuUid } : null)
    const sala = salaAtivaRef.current || assembleiaId
    if (!contexto || !sala) return () => {}

    // Histórico persistido (diferente da sinalização, as mensagens não são
    // apagadas): últimas LIMITE_MENSAGENS_CHAT, ordenadas do mais antigo ao
    // mais recente. onSnapshot mantém em tempo real.
    const parar = onSnapshot(
      query(
        collection(db, 'tenants', contexto.condominioId, 'salasVideo', sala, 'mensagens'),
        orderBy('criadoEm', 'asc'),
        limit(LIMITE_MENSAGENS_CHAT)
      ),
      (foto) => {
        const lista = foto.docs.map((documento) => ({ id: documento.id, ...documento.data() }))
        mensagensRef.current = lista
        setMensagens(lista)
      },
      (erroChat) => console.warn('[SalaVideo] Falha no listener do chat:', erroChat)
    )
    return parar
  }

  function iniciarListagemGravacoes() {
    const contexto = contextoSalaRef.current || (temContexto ? { condominioId, uid: meuUid } : null)
    const sala = salaAtivaRef.current || assembleiaId
    if (!contexto || !sala) return () => {}

    const parar = onSnapshot(
      query(
        collection(db, 'tenants', contexto.condominioId, 'salasVideo', sala, 'gravacoes'),
        orderBy('criadoEm', 'desc'),
        limit(50)
      ),
      (foto) => {
        const lista = foto.docs.map((documento) => ({ id: documento.id, ...documento.data() }))
        setGravacoes(lista)
      },
      (erroGravacoes) => console.warn('[SalaVideo] Falha no listener de gravações:', erroGravacoes)
    )
    return parar
  }

  function formatarTamanho(tamanho) {
    if (!tamanho) return '0 B'
    if (tamanho < 1024) return `${tamanho} B`
    if (tamanho < 1024 * 1024) return `${(tamanho / 1024).toFixed(1)} KB`
    return `${(tamanho / (1024 * 1024)).toFixed(1)} MB`
  }

  function formatarDataGravacao(criadoEm) {
    try {
      if (!criadoEm) return ''
      const data = criadoEm.toDate?.()
      if (!(data instanceof Date) || isNaN(data.getTime())) return ''
      return data.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    } catch {
      return ''
    }
  }

  async function enviarMensagem(evento) {
    if (evento?.preventDefault) evento.preventDefault()
    const texto = novaMensagem.trim()
    if (!texto) return
    const contexto = contextoSalaRef.current || (temContexto ? { condominioId, uid: meuUid } : null)
    const sala = salaAtivaRef.current || assembleiaId
    if (!contexto || !sala) return

    setNovaMensagem('')
    try {
      await addDoc(collection(db, 'tenants', contexto.condominioId, 'salasVideo', sala, 'mensagens'), {
        uid: contexto.uid,
        nome: usuario?.nome || 'Participante',
        role: usuario?.role || '',
        texto,
        criadoEm: serverTimestamp()
      })
    } catch (erroEnvio) {
      console.warn('[SalaVideo] Falha ao enviar mensagem:', erroEnvio)
      setNovaMensagem(texto)
    }
  }

  function aoRolarChat() {
    const elemento = rolamentoRef.current
    if (!elemento) return
    // Distância do fundo menor que 80px => "no fim" (tolerância para zoom/DPI).
    rolamentoNoFimRef.current = elemento.scrollHeight - elemento.scrollTop - elemento.clientHeight < 80
  }

  function rolarParaFim() {
    const elemento = rolamentoRef.current
    if (!elemento) return
    elemento.scrollTop = elemento.scrollHeight
  }

  function finalizarComErro(mensagem) {
    desconectarTudo()
    setErro(mensagem)
  }

  async function entrar() {
    if (!temContexto || fase !== 'fora' || naSalaRef.current) return
    setErro('')
    setFase('conectando')
    naSalaRef.current = true
    salaAtivaRef.current = assembleiaId
    contextoSalaRef.current = { condominioId, uid: meuUid }

    if (!navigator.mediaDevices?.getUserMedia) {
      finalizarComErro('Seu navegador não suporta captura de câmera/microfone. Acesse o sistema por HTTPS em um navegador atualizado.')
      return
    }

    // A permissão de câmera/microfone é pedida somente aqui, ao clicar em
    // "Entrar" — nunca automaticamente ao abrir a página.
    let stream = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    } catch (erroVideo) {
      try {
        // Sem câmera disponível (bloqueada ou inexistente): entra só com áudio.
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch (erroAudio) {
        finalizarComErro(mensagemErroMidia(erroAudio))
        return
      }
    }

    if (!naSalaRef.current || salaAtivaRef.current !== assembleiaId) {
      stream.getTracks().forEach((faixa) => faixa.stop())
      return
    }

    streamLocalRef.current = stream
    setStreamLocal(stream)
    micRef.current = stream.getAudioTracks().length > 0
    camRef.current = stream.getVideoTracks().length > 0
    setMicAtivo(micRef.current)
    setCameraAtiva(camRef.current)
    setTemCamera(camRef.current)

    try {
      // Limpa sinais antigos endereçados a mim antes de anunciar presença,
      // para não processar ofertas de sessões anteriores.
      await apagarSinaisDoParticipante(condominioId, assembleiaId, meuUid)
      if (!naSalaRef.current || salaAtivaRef.current !== assembleiaId) { desconectarTudo(); return }

      await setDoc(doc(db, 'tenants', condominioId, 'salasVideo', assembleiaId, 'participantes', meuUid), {
        uid: meuUid,
        nome: usuario?.nome || 'Participante',
        papel: ROTULOS_PERFIL[usuario?.role] || 'Morador',
        unidade: usuario?.unidade || '',
        entrouEm: Date.now(),
        microfone: micRef.current,
        camera: camRef.current,
        atualizadoEm: serverTimestamp()
      })
      if (!naSalaRef.current || salaAtivaRef.current !== assembleiaId) { desconectarTudo(); return }

      const pararParticipantes = onSnapshot(
        collection(db, 'tenants', condominioId, 'salasVideo', assembleiaId, 'participantes'),
        (foto) => {
          const lista = foto.docs.map((documento) => ({ id: documento.id, ...documento.data() }))
          participantesRef.current = lista
          setParticipantes(lista)
          verificarConexoes(lista)
          removerFantasmas(lista)
        },
        (erroLista) => console.warn('[SalaVideo] Falha no listener de participantes:', erroLista)
      )

      const pararSinais = onSnapshot(
        query(collection(db, 'tenants', condominioId, 'salasVideo', assembleiaId, 'sinais'), where('para', '==', meuUid)),
        (foto) => {
          foto.docChanges().forEach((mudanca) => {
            if (mudanca.type === 'added') processarSinal(mudanca.doc)
          })
        },
        (erroSinais) => console.warn('[SalaVideo] Falha no listener de sinais:', erroSinais)
      )
      pararListenersRef.current = [pararParticipantes, pararSinais]

      intervalosRef.current = [
        setInterval(bater, INTERVALO_BATIMENTO_MS),
        setInterval(() => removerFantasmas(participantesRef.current), INTERVALO_VASSOURA_MS)
      ]

      // Melhor esforço ao fechar a aba sem clicar em "Sair"; o heartbeat com a
      // vassoura de fantasmas garante a remoção caso o evento não dispare.
      const aoDescarregar = () => {
        const contexto = contextoSalaRef.current
        const sala = salaAtivaRef.current
        if (!contexto || !sala) return
        deleteDoc(doc(db, 'tenants', contexto.condominioId, 'salasVideo', sala, 'participantes', contexto.uid)).catch(() => {})
      }
      aoDescarregarRef.current = aoDescarregar
      window.addEventListener('pagehide', aoDescarregar)
      window.addEventListener('beforeunload', aoDescarregar)

      setFase('dentro')
    } catch (erroEntrada) {
      console.error('[SalaVideo] Erro ao entrar na sala:', erroEntrada)
      finalizarComErro('Não foi possível entrar na sala. Verifique sua conexão e tente novamente.')
    }
  }

  function atualizarPresenca(extra) {
    const contexto = contextoSalaRef.current
    const sala = salaAtivaRef.current
    if (!contexto || !sala || !naSalaRef.current) return
    setDoc(doc(db, 'tenants', contexto.condominioId, 'salasVideo', sala, 'participantes', contexto.uid), {
      ...extra,
      atualizadoEm: serverTimestamp()
    }, { merge: true }).catch(() => {})
  }

  function alternarMicrofone() {
    const faixas = streamLocalRef.current?.getAudioTracks() || []
    if (!faixas.length) return
    const ativar = !micRef.current
    faixas.forEach((faixa) => { faixa.enabled = ativar })
    micRef.current = ativar
    setMicAtivo(ativar)
    // Aviso os outros participantes para exibirem o selo "microfone desativado".
    atualizarPresenca({ microfone: ativar })
  }

  function alternarCamera() {
    const faixas = streamLocalRef.current?.getVideoTracks() || []
    if (!faixas.length) return
    const ativar = !camRef.current
    faixas.forEach((faixa) => { faixa.enabled = ativar })
    camRef.current = ativar
    setCameraAtiva(ativar)
    atualizarPresenca({ camera: ativar })
  }

  function sair() {
    desconectarTudo()
  }

  // ---------------------------------------------------------------------------
  // Renderização
  // ---------------------------------------------------------------------------
  if (!temContexto) return null

  const outros = participantes.filter((participante) => participante.id !== meuUid)
  const rotuloSala = ativo ? (naSala ? `${participantes.length} na sala` : `${outros.length} na sala`) : 'Sala indisponível'

  return (
    <div className="assembleia-sala">
      <div className="assembleia-sala-header">
        <h4>Sala de vídeo da assembleia</h4>
        <span className={'assembleia-sala-badge' + (ativo ? '' : ' assembleia-sala-badge-fora')}>{rotuloSala}</span>
      </div>

      {!ativo ? (
        <div className="assembleia-sala-encerrada">
          <p className="assembleia-sala-aviso">A assembleia foi encerrada. A sala de vídeo não está mais disponível, mas você pode ver o histórico de mensagens e gravações abaixo.</p>
          <div>
            <button type="button" className="btn btn-brass btn-sala-entrar" disabled>
              Entrar na sala de vídeo
            </button>
          </div>
        </div>
      ) : !naSala ? (
        <div className="assembleia-sala-cta">
          <p>Reunião pela própria plataforma: entre com câmera e microfone e participe da assembleia com os demais moradores. Se preferir, acompanhe pelo chat abaixo.</p>
          <div>
            <button type="button" className="btn btn-brass btn-sala-entrar" onClick={entrar} disabled={conectando}>
              {conectando ? 'Entrando na sala...' : 'Entrar na sala de vídeo'}
            </button>
          </div>
          {erro && <p className="assembleia-sala-erro">{erro}</p>}
          {erroGravacao && <p className="assembleia-sala-erro">{erroGravacao}</p>}
        </div>
      ) : (
        <>
          {gravando && (
            <div className="assembleia-sala-gravando">
              <span className="assembleia-sala-gravando-ponto" /> Gravação em andamento — a reunião será salva ao encerrar.
            </div>
          )}
          <div className="assembleia-video-grid">
            <VideoItem
              stream={streamLocal}
              nome={usuario?.nome || 'Você'}
              papel={ROTULOS_PERFIL[usuario?.role] || 'Morador'}
              unidade={usuario?.unidade}
              proprio
              microfone={micAtivo}
              camera={cameraAtiva}
              temVideo={temCamera}
            />
            {outros.map((participante) => (
              <VideoItem
                key={participante.id}
                stream={remotos[participante.id]}
                nome={participante.nome || 'Participante'}
                papel={participante.papel || ''}
                unidade={participante.unidade || ''}
                microfone={participante.microfone}
                camera={participante.camera}
              />
            ))}
          </div>
          <div className="assembleia-acoes">
            <button type="button" className="btn btn-small" onClick={alternarMicrofone}>
              {micAtivo ? 'Silenciar microfone' : 'Ativar microfone'}
            </button>
            {temCamera && (
              <button type="button" className="btn btn-small" onClick={alternarCamera}>
                {cameraAtiva ? 'Desligar câmera' : 'Ativar câmera'}
              </button>
            )}
            <button type="button" className="btn btn-small btn-danger" onClick={sair}>Sair da sala</button>
          </div>
        </>
      )}

      {/* Chat: visível enquanto a assembleia está aberta E quando encerrada (para ver histórico). */}
      {temContexto && (
        <div className="assembleia-chat">
          <div className="assembleia-chat-header">
            <h4>Chat da assembleia</h4>
            <span className="field-help">{mensagens.length} mensagen(s)</span>
          </div>
          <div className="assembleia-chat-mensagens" ref={rolamentoRef} onScroll={aoRolarChat}>
            {mensagens.length === 0 ? (
              <p className="assembleia-chat-vazio">Nenhuma mensagem ainda. Diga "olá" para começar.</p>
            ) : mensagens.map((mensagem) => {
              const mensagemAdmin = ['sindico', 'zelador', 'master'].includes(mensagem.role)
              const ehMinha = mensagem.uid === meuUid
              return (
                <div key={mensagem.id} className={'assembleia-mensagem' + (ehMinha ? ' assembleia-mensagem-propria' : '')}>
                  <div className="assembleia-mensagem-topo">
                    <span className={'assembleia-mensagem-autor' + (mensagemAdmin ? ' assembleia-mensagem-autor-admin' : '')}>
                      {mensagem.nome || 'Participante'}
                    </span>
                    {mensagemAdmin && <span className="assembleia-mensagem-selo">Administração</span>}
                    <span className="assembleia-mensagem-hora">{formatarHora(mensagem.criadoEm)}</span>
                  </div>
                  <p className="assembleia-mensagem-texto">{mensagem.texto}</p>
                </div>
              )
            })}
          </div>
          {ativo && (
            <form className="assembleia-chat-envio" onSubmit={enviarMensagem}>
              <input
                type="text"
                placeholder={ehAdministrador ? 'Mensagem como administrador...' : 'Escreva uma mensagem...'}
                value={novaMensagem}
                onChange={(e) => setNovaMensagem(e.target.value)}
                maxLength={500}
              />
              <button type="submit" className="btn btn-small btn-brass" disabled={!novaMensagem.trim()}>Enviar</button>
            </form>
          )}
        </div>
      )}

      {/* Gravações: visível sempre que há contexto, para ver o histórico de vídeos. */}
      {temContexto && gravacoes.length > 0 && (
        <div className="assembleia-gravacoes">
          <div className="assembleia-chat-header">
            <h4>Gravações da assembleia</h4>
            <span className="field-help">{gravacoes.length} vídeo(s)</span>
          </div>
          <div className="assembleia-gravacoes-lista">
            {gravacoes.map((gravacao) => (
              <a key={gravacao.id} href={gravacao.url} target="_blank" rel="noreferrer" className="assembleia-gravacao-item">
                <span className="assembleia-gravacao-icone">▶</span>
                <span className="assembleia-gravacao-info">
                  <span className="assembleia-gravacao-nome">Gravação de {formatarDataGravacao(gravacao.criadoEm)}</span>
                  <span className="assembleia-gravacao-detalhes">{formatarTamanho(gravacao.tamanho)}</span>
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {ativo && linkExterno && (
        <p className="assembleia-sala-link">
          Alternativa externa: <a href={linkExterno} target="_blank" rel="noreferrer">abrir a reunião no link externo</a> (Meet/Teams).
        </p>
      )}
    </div>
  )
}