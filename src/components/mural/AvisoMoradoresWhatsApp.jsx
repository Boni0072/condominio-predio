import React, { useMemo, useState } from 'react'
import { useApp } from '../../context/AppContext.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { whatsappUrlSemDestinatario, formatarWhatsApp, normalizarWhatsApp } from '../../utils/whatsapp.js'

// Monta a mensagem do comunicado com título em destaque, conteúdo e assinatura
function montarMensagemComunicado(item, nomeCondominio) {
  const partes = [`📢 *${item.titulo}*`, '', item.conteudo]
  if (item.autor) partes.push('', `— ${item.autor}`)
  if (nomeCondominio) partes.push('', `Mensagem enviada pelo condomínio ${nomeCondominio}.`)
  return partes.join('\n')
}

// Página "Avisar moradores via WhatsApp": prepara a mensagem (comunicado do
// mural ou texto livre) e abre UNA pestaña do WhatsApp com o texto já escrito
// e o campo de busca/destinatário pronto — o usuário escolge manualmente a
// quem enviar dentro do próprio WhatsApp.
export default function AvisoMoradoresWhatsApp({ comunicados, comunicadoId, onEscolherComunicado }) {
  const { moradores, usuarios } = useApp()
  const { condominio } = useAuth()

  const [modo, setModo] = useState(comunicadoId ? 'comunicado' : 'livre')
  const [textoLivre, setTextoLivre] = useState('')
  const [copiado, setCopiado] = useState(false)
  // Lista de usuários com WhatsApp: recolhível e inicia recolhida (cerrada)
  const [listaUsuariosAberta, setListaUsuariosAberta] = useState(false)

  // Destinatários com WhatsApp válido (usuários do app + moradores do cadastro,
  // sem duplicar número) — usados apenas como referência visual.
  const contatos = useMemo(() => {
    const lista = []
    const vistos = new Set()
    const adicionar = (pessoa, origem) => {
      const numero = normalizarWhatsApp(pessoa?.whatsapp)
      if (!numero || vistos.has(numero)) return
      vistos.add(numero)
      lista.push({
        nome: pessoa.nome?.trim() || 'Sem nome',
        unidade: pessoa.unidade || '',
        whatsapp: pessoa.whatsapp,
        origem
      })
    }
    usuarios.forEach((u) => adicionar(u, 'usuário'))
    moradores.forEach((m) => adicionar(m, 'morador'))
    return lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt'))
  }, [moradores, usuarios])

  const comunicadoSelecionado = comunicados.find((c) => c.id === comunicadoId) || null
  const mensagem =
    modo === 'comunicado' && comunicadoSelecionado
      ? montarMensagemComunicado(comunicadoSelecionado, condominio?.nome)
      : textoLivre.trim()
  const semMensagem = !mensagem

  // Abre UNA pestaña do WhatsApp com a mensagem já escrita e o campo para
  // escolher manualmente o destinatário (https://wa.me/?text=...).
  function abrirWhatsApp() {
    if (semMensagem) return
    const url = whatsappUrlSemDestinatario(mensagem)
    if (!url) return
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  async function copiarMensagem() {
    try {
      await navigator.clipboard.writeText(mensagem)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      /* área de transferência indisponible */
    }
  }

  return (
    <div className="panel-body">
      <p className="field-help">
        Prepara a mensagem e abre <strong>uma janela do WhatsApp</strong> com o texto já escrito e o campo
        para <strong>escolher o destinatário</strong>. Escolha o morador na lista de contactos de WhatsApp e
        envie — repita para avisar a todos os que faltem.
      </p>

      <div className="field-row">
        <div className="field">
          <label htmlFor="wa-modo">Conteúdo da mensagem</label>
          <select id="wa-modo" value={modo} onChange={(e) => setModo(e.target.value)}>
            <option value="comunicado">Comunicado do mural</option>
            <option value="livre">Mensagem livre</option>
          </select>
        </div>
        {modo === 'comunicado' && (
          <div className="field">
            <label htmlFor="wa-comunicado">Comunicado</label>
            <select
              id="wa-comunicado"
              value={comunicadoId || ''}
              onChange={(e) => onEscolherComunicado?.(e.target.value)}
            >
              <option value="">— escolha o comunicado —</option>
              {comunicados.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.titulo}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {modo === 'livre' && (
        <div className="field">
          <label htmlFor="wa-texto">Mensagem</label>
          <textarea
            id="wa-texto"
            value={textoLivre}
            onChange={(e) => setTextoLivre(e.target.value)}
            placeholder="Ex.: A água será cortada amanhã das 8h às 12h para manutenção."
            rows={4}
          />
        </div>
      )}

      <div className="wa-preview">
        <span className="wa-preview-label">Prévia da mensagem</span>
        {semMensagem ? (
          <span className="wa-preview-vazio">
            {modo === 'comunicado' && comunicados.length === 0
              ? 'Nenhum comunicado publicado ainda — use "Mensagem livre".'
              : modo === 'comunicado'
                ? 'Escolha um comunicado acima.'
                : 'Escreva a mensagem acima.'}
          </span>
        ) : (
          <pre className="wa-preview-texto">{mensagem}</pre>
        )}
        {!semMensagem && (
          <button type="button" className="btn btn-ghost btn-small" onClick={copiarMensagem}>
            {copiado ? '✓ Copiada' : 'Copiar mensagem'}
          </button>
        )}
      </div>

      <div className="field">
        <div className="wa-usuarios-header">
          <label>Usuários registrados com WhatsApp — {contatos.length}</label>
          <button
            type="button"
            className="btn btn-ghost btn-small panel-toggle"
            onClick={() => setListaUsuariosAberta((v) => !v)}
            aria-expanded={listaUsuariosAberta}
          >
            {listaUsuariosAberta ? '▾ Recolher' : '▸ Expandir'}
          </button>
        </div>

        {listaUsuariosAberta && (contatos.length === 0 ? (
          <div className="empty-state">
            Nenhum usuário com WhatsApp registrado. Cadastre moradores na página Moradores ou peça aos
            usuários que atualizem seu WhatsApp nas Configurações.
          </div>
        ) : (
          <div className="wa-lista">
            {contatos.map((c) => (
              <div key={`${c.origem}-${c.whatsapp}`} className="wa-item">
                <span className="wa-item-nome">
                  {c.nome}
                  {c.unidade && <small> · {c.unidade}</small>}
                </span>
                <small className="wa-item-origen">{c.origem}</small>
                <small className="wa-item-fone">{formatarWhatsApp(c.whatsapp)}</small>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="wa-enviar">
        {semMensagem ? (
          <p className="wa-progresso">Escolha um comunicado ou escreva uma mensagem para habilitar o envio.</p>
        ) : (
          <p className="wa-progresso">
            Ao tocar "Abrir WhatsApp" se abre o WhatsApp com o texto pronto e o campo de pesquisa para
            escolher o destinatário. Repita para avisar a cada morador.
          </p>
        )}
        <button
          type="button"
          className="btn btn-whatsapp btn-block"
          onClick={abrirWhatsApp}
          disabled={semMensagem}
        >
          {semMensagem ? '✉️ Escolha a mensagem' : '📲 Abrir WhatsApp'}
        </button>
      </div>
    </div>
  )
}