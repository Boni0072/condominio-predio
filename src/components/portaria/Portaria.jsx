import React, { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useApp } from '../../context/AppContext.jsx'
import { formatDateTime } from '../../utils/storage.js'
import { arquivoParaDataUrl } from '../../utils/imagem.js'
import AssinaturaRetiradaModal from './AssinaturaRetiradaModal.jsx'
import { AvisoEncomendaWhatsApp, AvisoVisitanteWhatsApp, moradorDaUnidade } from '../shared/AvisoEncomendaWhatsApp.jsx'

function VisitanteForm() {
  const { registrarVisitante, moradores } = useApp()
  const [form, setForm] = useState({
    nome: '',
    documento: '',
    unidade: '',
    autorizadoPor: '',
    motivo: 'visita',
    acompanhantes: []
  })

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  const unidadeMoradores = moradoresDaUnidade(moradores, form.unidade)

  function toggleAcompanhante(nome) {
    setForm((f) => {
      const tem = f.acompanhantes.includes(nome)
      return {
        ...f,
        acompanhantes: tem
          ? f.acompanhantes.filter((n) => n !== nome)
          : [...f.acompanhantes, nome]
      }
    })
  }

  function onSubmit(e) {
    e.preventDefault()
    if (!form.nome.trim() || !form.unidade.trim()) return
    registrarVisitante(form)
    setForm({ nome: '', documento: '', unidade: '', autorizadoPor: '', motivo: 'visita', acompanhantes: [] })
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="v-nome">Nome do visitante</label>
        <input
          id="v-nome"
          value={form.nome}
          onChange={(e) => set('nome', e.target.value)}
          placeholder="Ex.: João da Silva"
          required
        />
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="v-doc">Documento</label>
          <input
            id="v-doc"
            value={form.documento}
            onChange={(e) => set('documento', e.target.value)}
            placeholder="RG ou CPF"
          />
        </div>
        <div className="field">
          <label htmlFor="v-unidade">Unidade</label>
          <input
            id="v-unidade"
            value={form.unidade}
            onChange={(e) => set('unidade', e.target.value)}
            placeholder="Bloco A, apto 12"
            required
          />
        </div>
      </div>

      {unidadeMoradores.length > 0 && (
        <div className="field">
          <label>Moradores da unidade</label>
          <div className="acompanhantes-lista">
            {unidadeMoradores.map((m) => (
              <button
                type="button"
                key={m.id}
                className={'chip' + (form.acompanhantes.includes(m.nome) ? ' chip-ativo' : '')}
                onClick={() => toggleAcompanhante(m.nome)}
              >
                {m.nome}
              </button>
            ))}
          </div>
          <p className="field-hint">Toque para incluir como acompanhantes do visitante</p>
        </div>
      )}

      <div className="field-row">
        <div className="field">
          <label htmlFor="v-autorizado">Autorizado por</label>
          <input
            id="v-autorizado"
            value={form.autorizadoPor}
            onChange={(e) => set('autorizadoPor', e.target.value)}
            placeholder="Nome do morador"
          />
        </div>
        <div className="field">
          <label htmlFor="v-motivo">Motivo</label>
          <select id="v-motivo" value={form.motivo} onChange={(e) => set('motivo', e.target.value)}>
            <option value="visita">Visita</option>
            <option value="prestador">Prestador de serviço</option>
            <option value="entrega">Entrega / delivery</option>
            <option value="outro">Outro</option>
          </select>
        </div>
      </div>

      <button type="submit" className="btn btn-brass btn-block">
        Registrar entrada
      </button>
    </form>
  )
}

function moradoresDaUnidade(moradores, unidade) {
  const alvo = String(unidade || '').trim().toLowerCase()
  if (!alvo) return []
  return moradores.filter((m) => String(m.unidade || '').trim().toLowerCase() === alvo)
}

function VisitantesList() {
  const { visitantes, registrarSaida, removerVisitante } = useApp()

  if (visitantes.length === 0) {
    return <div className="empty-state">Nenhum visitante registrado ainda hoje.</div>
  }

  return (
    <div>
      {visitantes.map((v, i) => (
        <div className="log-item" key={v.id}>
          <div className="log-tag">#{String(visitantes.length - i).padStart(3, '0')}</div>
          <div className="log-main">
            <div className="log-name">{v.nome}</div>
            <div className="log-meta">
              <span>{v.unidade}</span>
              {v.autorizadoPor && <span>· autorizado por {v.autorizadoPor}</span>}
              <span>· entrada {formatDateTime(v.entrada)}</span>
              {v.saida && <span>· saída {formatDateTime(v.saida)}</span>}
            </div>
            {v.acompanhantes && v.acompanhantes.length > 0 && (
              <div className="acompanhantes-tags">
                <span className="acompanhantes-label">Acompanhantes:</span>
                {v.acompanhantes.map((nome) => (
                  <span key={nome} className="acompanhante-tag">{nome}</span>
                ))}
              </div>
            )}
          </div>
          <div className="log-actions">
            {v.saida ? (
              <span className="badge badge-blue">Saiu</span>
            ) : (
              <>
                <span className="badge badge-green">No condomínio</span>
                <AvisoVisitanteWhatsApp visitante={v} />
                <button className="btn btn-ghost btn-small" onClick={() => registrarSaida(v.id)}>
                  Registrar saída
                </button>
              </>
            )}
            <button className="btn btn-ghost btn-small" onClick={() => removerVisitante(v.id)}>
              Remover
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

// Lista de unidades cadastradas na página de Moradores, sem duplicatas e em ordem alfabética
function unidadesDosMoradores(moradores) {
  const mapa = new Map()
  moradores.forEach((m) => {
    const chave = String(m.unidade || '').trim().toLowerCase()
    if (!chave) return
    if (!mapa.has(chave)) {
      mapa.set(chave, { unidade: String(m.unidade).trim(), nomes: [] })
    }
    const nome = String(m.nome || '').trim()
    if (nome) mapa.get(chave).nomes.push(nome)
  })
  return Array.from(mapa.values()).sort((a, b) => a.unidade.localeCompare(b.unidade, 'pt-BR'))
}

function unidadesDosUsuarios(usuarios) {
  const mapa = new Map()
  usuarios.forEach((usuario) => {
    const unidade = String(usuario.unidade || '').trim()
    if (!unidade) return
    const chave = unidade.toLowerCase()
    if (!mapa.has(chave)) mapa.set(chave, { unidade, nomes: [] })
    if (usuario.nome) mapa.get(chave).nomes.push(usuario.nome)
  })
  return Array.from(mapa.values()).sort((a, b) => a.unidade.localeCompare(b.unidade, 'pt-BR'))
}

function EncomendaForm() {
  const { registrarEncomenda, moradores, usuarios } = useApp()
  const [form, setForm] = useState({ destinatario: '', unidade: '', transportadora: '' })
  const [foto, setFoto] = useState('')
  const [fotoCarregando, setFotoCarregando] = useState(false)
  const [fotoErro, setFotoErro] = useState('')
  const unidades = unidadesDosUsuarios(usuarios)
  const unidadeMoradores = moradoresDaUnidade(moradores, form.unidade)
  const usuariosDaUnidade = usuarios.filter((usuario) => (
    String(usuario.unidade || '').trim().toLowerCase() === form.unidade.trim().toLowerCase()
  ))

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  function selecionarDestinatario(nome) {
    set('destinatario', nome)
  }

  function limparFoto() {
    setFoto('')
    setFotoErro('')
  }

  async function onFotoChange(e) {
    const arquivo = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!arquivo) return
    setFotoErro('')
    setFotoCarregando(true)
    try {
      setFoto(await arquivoParaDataUrl(arquivo))
    } catch {
      setFotoErro('Não foi possível carregar a foto. Tente outra imagem.')
    } finally {
      setFotoCarregando(false)
    }
  }

  function onSubmit(e) {
    e.preventDefault()
    if (!form.unidade.trim() || fotoCarregando) return
    registrarEncomenda({
      unidade: form.unidade.trim(),
      destinatario: form.destinatario.trim(),
      transportadora: form.transportadora,
      foto: foto || null
    })
    setForm({ destinatario: '', unidade: '', transportadora: '' })
    limparFoto()
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="e-unidade">Unidade/Destinatário</label>
        {unidades.length > 0 ? (
          <select
            id="e-unidade"
            value={form.unidade}
            onChange={(e) => setForm((atual) => ({ ...atual, unidade: e.target.value, destinatario: '' }))}
            required
          >
            <option value="">Selecione a unidade do destinatário</option>
            {unidades.map((u) => (
              <option key={u.unidade.toLowerCase()} value={u.unidade}>
                {u.unidade} — {u.nomes.join(' e ')}
              </option>
            ))}
          </select>
        ) : (
          <input
            id="e-unidade"
            value={form.unidade}
            onChange={(e) => setForm((atual) => ({ ...atual, unidade: e.target.value, destinatario: '' }))}
            placeholder="Bloco A, apto 12"
            required
          />
        )}
      </div>
      <div className="field">
        <label htmlFor="e-destinatario">Destinatário</label>
        {usuariosDaUnidade.length > 0 ? (
          <select
            id="e-destinatario"
            value={form.destinatario}
            onChange={(e) => selecionarDestinatario(e.target.value)}
          >
            <option value="">Selecione o destinatário</option>
            {usuariosDaUnidade.map((usuario) => (
              <option key={usuario.id} value={usuario.nome}>{usuario.nome}</option>
            ))}
          </select>
        ) : (
          <input
            id="e-destinatario"
            value={form.destinatario}
            onChange={(e) => set('destinatario', e.target.value)}
            placeholder="Nome do destinatário"
          />
        )}
        {usuariosDaUnidade.length === 0 && unidadeMoradores.length > 0 && (
          <div className="acompanhantes-lista">
            {unidadeMoradores.map((m) => (
              <button
                type="button"
                key={m.id}
                className={'chip' + (form.destinatario === m.nome ? ' chip-ativo' : '')}
                onClick={() => selecionarDestinatario(m.nome)}
              >
                {m.nome}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="field">
        <label htmlFor="e-transp">Transportadora / origem</label>
        <input
          id="e-transp"
          value={form.transportadora}
          onChange={(e) => set('transportadora', e.target.value)}
          placeholder="Ex.: Correios, iFood, Mercado Livre"
        />
      </div>
      <div className="field">
        <label htmlFor="e-foto">Foto da encomenda (opcional)</label>
        <input
          id="e-foto"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onFotoChange}
        />
      </div>
      {fotoCarregando && <p className="foto-status">Processando foto...</p>}
      {fotoErro && <p className="form-erro">{fotoErro}</p>}
      {foto && (
        <div className="foto-preview">
          <img src={foto} alt="Prévia da foto da encomenda" />
          <button type="button" className="btn btn-ghost btn-small" onClick={limparFoto}>
            Remover foto
          </button>
        </div>
      )}

      <button type="submit" className="btn btn-brass btn-block" disabled={fotoCarregando}>
        Registrar encomenda
      </button>
    </form>
  )
}

function EncomendasList() {
  const { encomendas, confirmarRetirada, removerEncomenda, moradores, registrarAvisoEncomenda } = useApp()
  const [retiradaModal, setRetiradaModal] = useState(null)
  const [busca, setBusca] = useState('')

  if (encomendas.length === 0) {
    return <div className="empty-state">Nenhuma encomenda registrada.</div>
  }

  const termo = busca.trim().toLowerCase()
  const filtradas = termo
    ? encomendas.filter((e) => {
        const morador = moradorDaUnidade(moradores, e.unidade)
        const nomeMorador = (morador?.nome || '').toLowerCase()
        return (
          (e.destinatario || '').toLowerCase().includes(termo) ||
          nomeMorador.includes(termo) ||
          (e.unidade || '').toLowerCase().includes(termo) ||
          (e.transportadora || '').toLowerCase().includes(termo)
        )
      })
    : encomendas

  return (
    <div>
      <div className="field filtro-encomendas">
        <input
          type="text"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por destinatário, morador, unidade ou transportadora..."
          className="input-busca"
        />
      </div>
      {filtradas.length === 0 ? (
        <div className="empty-state">Nenhuma encomenda encontrada para &quot;{busca}&quot;.</div>
      ) : (
        filtradas.map((e) => {
        const morador = moradorDaUnidade(moradores, e.unidade)
        const titulo = e.destinatario || (morador && morador.nome) || e.unidade
        return (
          <div className="log-item" key={e.id}>
            {e.foto && (
              <a
                className="encomenda-foto-link"
                href={e.foto}
                target="_blank"
                rel="noreferrer"
                title="Ver foto da encomenda"
              >
                <img className="encomenda-foto" src={e.foto} alt={`Foto — ${titulo}`} />
              </a>
            )}
            <div className="log-main">
              <div className="log-name">{titulo}</div>
              <div className="log-meta">
                <span>{e.unidade}</span>
                {e.transportadora && <span>· {e.transportadora}</span>}
                <span>· chegou {formatDateTime(e.chegadaEm)}</span>
                {e.avisadoEm && <span className="encomenda-avisado">· 📢 avisado {formatDateTime(e.avisadoEm)}</span>}
                {e.retiradaEm && <span>· retirada {formatDateTime(e.retiradaEm)}</span>}
              </div>
            </div>
            <div className="log-actions">
              {e.retiradaEm ? (
                <>
                  {e.assinatura && (
                    <a
                      className="assinatura-thumb-link"
                      href={e.assinatura}
                      target="_blank"
                      rel="noreferrer"
                      title="Ver assinatura de quem retirou"
                    >
                      <img
                        className="assinatura-thumb"
                        src={e.assinatura}
                        alt="Assinatura de quem retirou"
                      />
                    </a>
                  )}
                  <span className="badge badge-blue">Retirada</span>
                </>
              ) : (
                <>
                  <span className="badge badge-brick">Aguardando retirada</span>
                  <AvisoEncomendaWhatsApp encomenda={e} onAviso={() => registrarAvisoEncomenda(e.id)} />
                  <button className="btn btn-ghost btn-small" onClick={() => setRetiradaModal(e)}>
                    Marcar retirada
                  </button>
                </>
              )}
              <button className="btn btn-ghost btn-small" onClick={() => removerEncomenda(e.id)}>
                Remover
              </button>
            </div>
          </div>
        )
      }))}

      {retiradaModal && (
        <AssinaturaRetiradaModal
          encomenda={retiradaModal}
          titulo={
            retiradaModal.destinatario ||
            (moradorDaUnidade(moradores, retiradaModal.unidade) || {}).nome ||
            retiradaModal.unidade
          }
          onConfirmar={(assinatura) => {
            confirmarRetirada(retiradaModal.id, assinatura)
            setRetiradaModal(null)
          }}
          onCancelar={() => setRetiradaModal(null)}
        />
      )}
    </div>
  )
}

export default function Portaria() {
  const { visitantes, encomendas } = useApp()
  const noCondominio = visitantes.filter((v) => !v.saida).length
  const aguardando = encomendas.filter((e) => !e.retiradaEm).length

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Portaria</h1>
          <p className="sub">
            {noCondominio} visitante{noCondominio !== 1 ? 's' : ''} no condomínio · {aguardando}{' '}
            encomenda{aguardando !== 1 ? 's' : ''} aguardando retirada
          </p>
        </div>
      </div>

      <nav className="subnav" aria-label="Seções da portaria">
        <NavLink to="visitantes" className={({ isActive }) => (isActive ? 'active' : '')}>
          Visitantes
        </NavLink>
        <NavLink to="encomendas" className={({ isActive }) => (isActive ? 'active' : '')}>
          Encomendas
        </NavLink>
      </nav>

      <Outlet />
    </div>
  )
}

export function PortariaVisitantes() {
  const [expandido, setExpandido] = useState(false)

  return (
    <div className="grid-2">
      <div className="panel">
        <div className="panel-header">
          <h2>Registrar visitante</h2>
          <button
            type="button"
            className="btn btn-ghost btn-small panel-toggle"
            onClick={() => setExpandido((v) => !v)}
            aria-expanded={expandido}
          >
            {expandido ? '▾ Recolher' : '▸ Expandir'}
          </button>
        </div>
        {expandido && (
          <div className="panel-body">
            <VisitanteForm />
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>Movimento de visitantes</h2>
        </div>
        <VisitantesList />
      </div>
    </div>
  )
}

export function PortariaEncomendas() {
  const [expandido, setExpandido] = useState(false)

  return (
    <div className="grid-2">
      <div className="panel">
        <div className="panel-header">
          <h2>Registrar encomenda</h2>
          <button
            type="button"
            className="btn btn-ghost btn-small panel-toggle"
            onClick={() => setExpandido((v) => !v)}
            aria-expanded={expandido}
          >
            {expandido ? '▾ Recolher' : '▸ Expandir'}
          </button>
        </div>
        {expandido && (
          <div className="panel-body">
            <EncomendaForm />
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>Encomendas</h2>
        </div>
        <EncomendasList />
      </div>
    </div>
  )
}
