import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import { db } from '../../firebase/config.js'
import { collection, doc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore'
import { nowISO } from '../../utils/storage.js'
import {
  COLECAO_BOLETOS,
  COLECAO_COBRANCAS_LEGADAS,
  idBoletoMigrado,
  mesmoDestinatario,
  mesclarCobrancas,
  normalizarStatusCobranca,
  salvarCobrancasLocais,
  carregarCobrancasLocais
} from './cobrancas.js'
import { PERFIS_GESTORES_PAGAMENTO } from './tipos.js'

function documentos(snapshot) {
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
}

// Fonte única de cobranças para Configurações e Pagamentos. A coleção antiga
// continua sendo lida e é importada uma única vez para "boletos"; ninguém apaga
// o histórico em "cobrancas".
export function useCobrancas({ ativo = true } = {}) {
  const { userProfile, firebaseOK } = useAuth()
  const condominioId = userProfile?.condominioId
  const firestoreAtivo = Boolean(ativo && firebaseOK && condominioId)
  const [cobrancas, setCobrancas] = useState(() => ativo ? carregarCobrancasLocais(condominioId) : [])
  const [carregando, setCarregando] = useState(Boolean(firestoreAtivo))
  const [erroSincronizacao, setErroSincronizacao] = useState('')
  const migracoesTentadasRef = useRef(new Set())

  const atualizarLocal = useCallback((atualizador) => {
    setCobrancas((atuais) => {
      const proximas = typeof atualizador === 'function' ? atualizador(atuais) : atualizador
      salvarCobrancasLocais(condominioId, proximas || [])
      return proximas || []
    })
  }, [condominioId])

  useEffect(() => {
    migracoesTentadasRef.current = new Set()
    setErroSincronizacao('')
    if (!ativo) {
      setCobrancas([])
      setCarregando(false)
      return undefined
    }
    if (!firestoreAtivo) {
      setCobrancas(carregarCobrancasLocais(condominioId))
      setCarregando(false)
      return undefined
    }

    if (firestoreAtivo) {
      // Evita exibir por um instante as cobranças do condomínio anterior
      // enquanto o snapshot do novo tenant ainda está carregando.
      setCobrancas(carregarCobrancasLocais(condominioId))
    }
    setCarregando(true)
    let principais = []
    let legadas = []
    let encerrado = false
    const publicar = () => {
      if (encerrado) return
      const lista = mesclarCobrancas(principais, legadas)
      setCobrancas(lista)
      salvarCobrancasLocais(condominioId, lista)
    }
    const migrarAntigas = async (listaAntiga) => {
      if (!PERFIS_GESTORES_PAGAMENTO.includes(userProfile?.role)) return
      const idsDestinoExistentes = new Set(principais.map((item) => item.id))
      for (const antiga of listaAntiga) {
        const idDestino = idBoletoMigrado(antiga)
        if (!idDestino || idsDestinoExistentes.has(idDestino) || antiga.migradoComoBoleto === idDestino) continue
        if (migracoesTentadasRef.current.has(idDestino)) continue
        migracoesTentadasRef.current.add(idDestino)
        const { id, ...dados } = antiga
        try {
          const equivalente = principais.find((item) => item.cotaRef === antiga.cotaRef && mesmoDestinatario(item, antiga))
          if (equivalente) {
            await updateDoc(doc(db, 'tenants', condominioId, COLECAO_COBRANCAS_LEGADAS, id), {
              migradoComoBoleto: equivalente.id,
              migradoEm: nowISO()
            })
            continue
          }
          const registro = {
            ...dados,
            id: idDestino,
            status: normalizarStatusCobranca(antiga.status),
            tipo: antiga.tipo || 'mensalidade',
            nossoNumero: antiga.nossoNumero || '',
            pagoEm: antiga.pagoEm || antiga.pagaEm || '',
            cobrancaOrigemId: id,
            migradoEm: nowISO(),
            condominioId,
            removido: Boolean(antiga.removido)
          }
          await setDoc(doc(db, 'tenants', condominioId, COLECAO_BOLETOS, idDestino), registro, { merge: true })
          idsDestinoExistentes.add(idDestino)
          await updateDoc(doc(db, 'tenants', condominioId, COLECAO_COBRANCAS_LEGADAS, id), {
            migradoComoBoleto: idDestino,
            migradoEm: nowISO()
          })
        } catch (erro) {
          migracoesTentadasRef.current.delete(idDestino)
          console.error('Erro ao migrar cobrança antiga para Pagamentos:', erro)
          setErroSincronizacao('Uma cobrança antiga não pôde ser sincronizada. Abra a tela novamente após restaurar a conexão.')
        }
      }
    }

    const unsubBoletos = onSnapshot(
      collection(db, 'tenants', condominioId, COLECAO_BOLETOS),
      (snapshot) => {
        principais = documentos(snapshot)
        publicar()
        migrarAntigas(legadas)
        setCarregando(false)
      },
      (erro) => {
        console.error('Erro ao sincronizar cobranças:', erro)
        setErroSincronizacao('Não foi possível sincronizar as cobranças com o banco.')
        setCarregando(false)
      }
    )
    const unsubLegadas = onSnapshot(
      collection(db, 'tenants', condominioId, COLECAO_COBRANCAS_LEGADAS),
      (snapshot) => {
        legadas = documentos(snapshot)
        publicar()
        migrarAntigas(legadas)
      },
      (erro) => {
        console.warn('Cobranças legadas não puderam ser lidas:', erro)
        setErroSincronizacao('Não foi possível consultar as cobranças antigas. As cobranças atuais continuam disponíveis.')
      }
    )
    return () => {
      encerrado = true
      unsubBoletos()
      unsubLegadas()
    }
  }, [condominioId, firestoreAtivo, userProfile?.role, ativo])

  return { cobrancas, atualizarLocal, carregando, erroSincronizacao, firestoreAtivo, condominioId }
}
