import React, { useState } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import { useApp } from '../../context/AppContext.jsx'
import { formatDateTime } from '../../utils/storage.js'

const FORM_ASSEMBLEIA = { titulo: '', data: '', pauta: '', link: '' }

function dataLegivel(valor) {
  if (!valor) return 'Data não definida'
  return new Date(valor).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function PesquisaCard({ pesquisa, votos, usuario, podeAdministrar, reuniaoEncerrada, onVotar, onEncerrar }) {
  const [auditoriaAberta, setAuditoriaAberta] = useState(false)
  const meuVoto = votos.find((voto) => voto.votacaoId === pesquisa.id && voto.usuarioId === usuario?.uid)
  const total = votos.filter((voto) => voto.votacaoId === pesquisa.id).length
  const resultados = pesquisa.opcoes.map((opcao) => ({
    opcao,
    total: votos.filter((voto) => voto.votacaoId === pesquisa.id && voto.opcao === opcao).length
  }))

  return (
    <div className="assembleia-pesquisa">
      <div className="assembleia-pesquisa-header">
        <div><strong>{pesquisa.pergunta}</strong><span>{total} voto(s) · {pesquisa.encerrada ? 'Encerrada' : 'Aberta'}</span></div>
        {podeAdministrar && !pesquisa.encerrada && <button type="button" className="btn btn-small btn-ghost" onClick={() => onEncerrar(pesquisa.id)}>Encerrar votação</button>}
      </div>
      <div className="assembleia-opcoes">
        {pesquisa.opcoes.map((opcao) => {
          const resultado = resultados.find((item) => item.opcao === opcao)
          const percentual = total ? Math.round((resultado.total / total) * 100) : 0
          return (
            <button type="button" className={'assembleia-opcao' + (meuVoto?.opcao === opcao ? ' selecionada' : '')} key={opcao} disabled={Boolean(meuVoto) || pesquisa.encerrada || reuniaoEncerrada} onClick={() => onVotar(pesquisa.id, opcao)}>
              <span>{opcao}</span>
              {(meuVoto || pesquisa.encerrada) && <span className="assembleia-resultado">{resultado.total} ({percentual}%)</span>}
            </button>
          )
        })}
      </div>
      {meuVoto && <small className="field-help">Seu voto foi registrado.</small>}
      {(pesquisa.encerrada || podeAdministrar) && (
        <div className="assembleia-votos-auditoria">
          <button type="button" className="assembleia-auditoria-toggle" onClick={() => setAuditoriaAberta((aberta) => !aberta)} aria-expanded={auditoriaAberta}>
            <strong>Registro dos votos</strong><span>{auditoriaAberta ? 'Recolher' : 'Mostrar votos'}</span>
          </button>
          {auditoriaAberta && (votos.filter((voto) => voto.votacaoId === pesquisa.id).length === 0 ? <span>Nenhum voto registrado.</span> : votos.filter((voto) => voto.votacaoId === pesquisa.id).map((voto) => (
            <div className="assembleia-voto-registro" key={voto.id}>
              <span>{voto.usuarioNome}</span><span>{voto.opcao}</span><small>{voto.assinatura || voto.usuarioNome} · {formatDateTime(voto.criadoEm)}</small>
            </div>
          )))}
        </div>
      )}
    </div>
  )
}

export default function Assembleias() {
  const { userProfile } = useAuth()
  const { assembleias, votacoes, votos, criarAssembleia, criarVotacao, encerrarAssembleia, encerrarVotacao, votar } = useApp()
  const podeAdministrar = ['sindico', 'zelador'].includes(userProfile?.role)
  const [assembleiaSelecionada, setAssembleiaSelecionada] = useState(null)
  const [form, setForm] = useState(FORM_ASSEMBLEIA)
  const [pesquisa, setPesquisa] = useState({ assembleiaId: '', pergunta: '', opcoes: 'Sim\nNão' })
  const [mostrarForm, setMostrarForm] = useState(false)

  const reunioes = [...assembleias].sort((a, b) => new Date(a.data) - new Date(b.data))
  const atual = assembleiaSelecionada ? assembleias.find((item) => item.id === assembleiaSelecionada) : null
  const pesquisasDaReuniao = votacoes.filter((item) => item.assembleiaId === assembleiaSelecionada)

  function salvarReuniao(event) {
    event.preventDefault()
    if (!form.titulo.trim() || !form.data) return
    criarAssembleia(form)
    setForm(FORM_ASSEMBLEIA)
    setMostrarForm(false)
  }

  function salvarPesquisa(event) {
    event.preventDefault()
    const opcoes = pesquisa.opcoes.split('\n').map((item) => item.trim()).filter(Boolean)
    if (!pesquisa.assembleiaId || !pesquisa.pergunta.trim() || opcoes.length < 2) return
    criarVotacao({ assembleiaId: pesquisa.assembleiaId, pergunta: pesquisa.pergunta.trim(), opcoes })
    setPesquisa({ assembleiaId: pesquisa.assembleiaId, pergunta: '', opcoes: 'Sim\nNão' })
  }

  return (
    <div className="page">
      <div className="page-header">
        <div><h2>Assembleias e reuniões</h2><p className="sub">Reuniões do condomínio, pautas e votações online.</p></div>
        {podeAdministrar && <button type="button" className="btn btn-brass" onClick={() => setMostrarForm((aberto) => !aberto)}>{mostrarForm ? 'Fechar' : 'Nova reunião'}</button>}
      </div>

      {mostrarForm && <form className="card assembleia-form" onSubmit={salvarReuniao}>
        <h3>Agendar reunião</h3>
        <div className="form-grid">
          <div className="field"><label>Título</label><input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="Assembleia geral ordinária" required /></div>
          <div className="field"><label>Data e hora</label><input type="datetime-local" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} required /></div>
          <div className="field"><label>Link da reunião online</label><input type="url" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="Cole o link do Teams ou Google Meet" /></div>
        </div>
        <div className="field"><label>Pauta</label><textarea rows="3" value={form.pauta} onChange={(e) => setForm({ ...form, pauta: e.target.value })} placeholder="Assuntos que serão discutidos" /></div>
        <button className="btn btn-brass" type="submit">Agendar reunião</button>
      </form>}

      <div className="assembleia-layout">
        <section className="card assembleia-reunioes">
          <div className="panel-header"><h3>Reuniões</h3><span className="field-help">{reunioes.length} cadastrada(s)</span></div>
          {reunioes.length === 0 ? <p className="empty">Nenhuma reunião agendada.</p> : reunioes.map((reuniao) => (
            <button type="button" className={'assembleia-reuniao' + (reuniao.id === assembleiaSelecionada ? ' ativa' : '')} key={reuniao.id} onClick={() => { setAssembleiaSelecionada(reuniao.id); setPesquisa({ ...pesquisa, assembleiaId: reuniao.id }) }}>
              <strong>{reuniao.titulo}</strong><span>{dataLegivel(reuniao.data)}</span>
            </button>
          ))}
        </section>

        <section className="card assembleia-detalhe">
          {!atual ? <div className="assembleia-vazio"><h3>Selecione uma reunião</h3><p>Escolha uma reunião para ver a pauta e participar das votações.</p></div> : <>
            <div className="panel-header"><div><h3>{atual.titulo}</h3><p className="field-help">{dataLegivel(atual.data)} · {atual.encerrada ? 'Encerrada' : 'Aberta'}</p></div><div className="assembleia-acoes"><button type="button" className="btn btn-small btn-ghost" onClick={() => setAssembleiaSelecionada(null)}>Voltar para reuniões</button>{atual.link && !atual.encerrada ? <a className="btn btn-brass btn-small" href={atual.link} target="_blank" rel="noreferrer">Entrar na reunião online</a> : !atual.encerrada && <span className="field-help">Link online não informado</span>}{podeAdministrar && !atual.encerrada && <button type="button" className="btn btn-small btn-danger" onClick={() => encerrarAssembleia(atual.id)}>Encerrar assembleia</button>}</div></div>
            {atual.pauta && <div className="assembleia-pauta"><strong>Pauta</strong><p>{atual.pauta}</p></div>}
            {podeAdministrar && <form className="assembleia-votacao-form" onSubmit={salvarPesquisa}><h4>Criar pesquisa de votos</h4><input type="hidden" value={pesquisa.assembleiaId} /><div className="field"><label>Pergunta</label><input value={pesquisa.pergunta} onChange={(e) => setPesquisa({ ...pesquisa, pergunta: e.target.value, assembleiaId: atual.id })} placeholder="Aprovar a reforma da fachada?" required /></div><div className="field"><label>Opções (uma por linha)</label><textarea rows="3" value={pesquisa.opcoes} onChange={(e) => setPesquisa({ ...pesquisa, opcoes: e.target.value })} /></div><button className="btn btn-ghost" type="submit">Publicar pesquisa</button></form>}
            <div className="assembleia-pesquisas"><h4>Votações</h4>{pesquisasDaReuniao.length === 0 ? <p className="empty">Nenhuma pesquisa criada.</p> : pesquisasDaReuniao.map((item) => <PesquisaCard key={item.id} pesquisa={item} votos={votos} usuario={userProfile} podeAdministrar={podeAdministrar} reuniaoEncerrada={atual.encerrada} onVotar={votar} onEncerrar={encerrarVotacao} />)}</div>
          </>}
        </section>
      </div>
    </div>
  )
}
