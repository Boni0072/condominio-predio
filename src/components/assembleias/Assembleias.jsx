import React, { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import { useApp } from '../../context/AppContext.jsx'
import { formatDateTime } from '../../utils/storage.js'
import SalaVideo from './SalaVideo.jsx'

const FORM_ASSEMBLEIA = { titulo: '', data: '', pauta: '', link: '' }

function dataLegivel(valor) {
  if (!valor) return 'Data não definida'
  return new Date(valor).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function PesquisaCard({ pesquisa, votos, usuario, podeAdministrar, reuniaoEncerrada, onVotar, onEncerrar, abertoPorPadrao }) {
  // Card da votação: inicia recolhido (exceto a recém-publicada, que abre
  // automaticamente via abertoPorPadrao). O cabeçalho segue visível mesmo
  // recolhido, com pergunta, total de votos e status.
  const [cardAberto, setCardAberto] = useState(Boolean(abertoPorPadrao))
  const [resumoAberto, setResumoAberto] = useState(false) // resumo inicia recolhido
  const [auditoriaAberta, setAuditoriaAberta] = useState(false)
  const votosDaPesquisa = votos.filter((voto) => voto.votacaoId === pesquisa.id)
  const meuVoto = votosDaPesquisa.find((voto) => voto.usuarioId === usuario?.uid)
  const total = votosDaPesquisa.length
  // Resumo por opção: total, percentual e NOMES de quem votou em cada uma.
  // O nome vem de voto.usuarioNome (gravado junto com o voto em votar(),
  // no AppContext); o fallback evita linha vazia em registros antigos.
  const resultados = pesquisa.opcoes.map((opcao) => {
    const daOpcao = votosDaPesquisa.filter((voto) => voto.opcao === opcao)
    return {
      opcao,
      total: daOpcao.length,
      nomes: daOpcao.map((voto) => voto.usuarioNome || voto.usuarioId || 'Anônimo')
    }
  })
  // Resumo com nomes segue a mesma regra da auditoria: fica visível quando a
  // votação é encerrada ou para a administração (síndico/zelador) — enquanto
  // aberta, os moradores veem apenas os totais.
  const mostraResumo = pesquisa.encerrada || podeAdministrar
  // Vencedor(es): opção(ões) com mais votos. A faixa aparece quando a votação
  // é encerrada (para todos) e ao vivo para a administração (rótulo
  // "Liderando"); empates listam todas as opções empatadas.
  const maiorTotal = total > 0 ? Math.max(...resultados.map((resultado) => resultado.total)) : 0
  const vencedores = total > 0 ? resultados.filter((resultado) => resultado.total === maiorTotal) : []
  const empate = vencedores.length > 1
  const mostraVencedor = (pesquisa.encerrada || podeAdministrar) && vencedores.length > 0
  const rotuloVencedor = empate ? 'Empate' : (pesquisa.encerrada ? 'Vencedor' : 'Liderando')
  const nomesVencedores = vencedores.map((resultado) => resultado.opcao).join(' · ')
  const percentualVencedor = total ? Math.round((maiorTotal / total) * 100) : 0

  return (
    <div className="assembleia-pesquisa">
      <div className="assembleia-pesquisa-header">
        <div><strong>{pesquisa.pergunta}</strong><span>{total} voto(s) · {pesquisa.encerrada ? 'Encerrada' : 'Aberta'}</span></div>
        <div className="assembleia-pesquisa-acoes">
          {podeAdministrar && !pesquisa.encerrada && <button type="button" className="btn btn-small btn-ghost" onClick={() => onEncerrar(pesquisa.id)}>Encerrar votação</button>}
          <button type="button" className="btn btn-small btn-ghost" onClick={() => setCardAberto((aberto) => !aberto)} aria-expanded={cardAberto}>
            {cardAberto ? 'Recolher' : 'Mostrar'}
          </button>
        </div>
      </div>
      {mostraVencedor && (
        <div className="assembleia-vencedor">
          <span className="assembleia-vencedor-rotulo">{rotuloVencedor}</span>
          <strong className="assembleia-vencedor-opcao">{nomesVencedores}</strong>
          <span className="assembleia-vencedor-detalhe">{maiorTotal} voto(s) · {percentualVencedor}%{empate ? ' cada' : ''}</span>
        </div>
      )}
      {cardAberto && (
        <>
        <div className="assembleia-opcoes">
          {pesquisa.opcoes.map((opcao) => {
            const resultado = resultados.find((item) => item.opcao === opcao)
            const percentual = total ? Math.round((resultado.total / total) * 100) : 0
            return (
              <button type="button" className={'assembleia-opcao' + (meuVoto?.opcao === opcao ? ' selecionada' : '') + (mostraVencedor && vencedores.some((resultado) => resultado.opcao === opcao) ? ' vencedora' : '')} key={opcao} disabled={pesquisa.encerrada || reuniaoEncerrada} onClick={() => onVotar(pesquisa.id, opcao)}>
                <span>{opcao}</span>
                {(meuVoto || pesquisa.encerrada) && <span className="assembleia-resultado">{resultado.total} ({percentual}%)</span>}
              </button>
            )
          })}
        </div>
        {meuVoto && <small className="field-help">{pesquisa.encerrada ? 'Seu voto foi registrado.' : 'Seu voto foi registrado. Você pode alterá-lo clicando em outra opção, até a votação ser encerrada.'}</small>}
        {mostraResumo && (
          <div className="assembleia-resumo">
            {/* Inicia recolhido: o botão abre o resumo; mesmo fechado, o total
                de votos continua visível na própria linha do toggle. */}
            <button type="button" className="assembleia-resumo-toggle" onClick={() => setResumoAberto((aberto) => !aberto)} aria-expanded={resumoAberto}>
              <strong>Resumo da votação</strong>
              <span>{total} voto(s) · {resumoAberto ? 'Recolher' : 'Mostrar resumo'}</span>
            </button>
            {resumoAberto && (total === 0 ? (
              <span className="assembleia-resumo-vazio">Nenhum voto registrado até agora.</span>
            ) : (
              <div className="assembleia-resumo-opcoes">
                {resultados.map((resultado) => {
                  const percentual = total ? Math.round((resultado.total / total) * 100) : 0
                  return (
                    <div className={'assembleia-resumo-opcao' + (mostraVencedor && vencedores.some((vencedora) => vencedora.opcao === resultado.opcao) ? ' vencedora' : '')} key={resultado.opcao}>
                      <div className="assembleia-resumo-opcao-topo">
                        <strong>{resultado.opcao}</strong>
                        <span>{resultado.total} voto(s) · {percentual}%</span>
                      </div>
                      {resultado.nomes.length > 0 ? (
                        <div className="assembleia-resumo-nomes">
                          {resultado.nomes.map((nome, indice) => (
                            <span className="assembleia-resumo-nome" key={`${resultado.opcao}-${indice}`}>{nome}</span>
                          ))}
                        </div>
                      ) : (
                        <small className="assembleia-resumo-sem-votos">Ninguém votou nesta opção.</small>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}
        {mostraResumo && (
          <div className="assembleia-votos-auditoria">
            <button type="button" className="assembleia-auditoria-toggle" onClick={() => setAuditoriaAberta((aberta) => !aberta)} aria-expanded={auditoriaAberta}>
              <strong>Registro individual dos votos</strong><span>{auditoriaAberta ? 'Recolher' : 'Mostrar registros'}</span>
            </button>
            {auditoriaAberta && (total === 0 ? <span>Nenhum voto registrado.</span> : votosDaPesquisa.map((voto) => (
              <div className="assembleia-voto-registro" key={voto.id}>
                <span>{voto.usuarioNome}</span><span>{voto.opcao}</span><small>{voto.assinatura || voto.usuarioNome} · {formatDateTime(voto.criadoEm)}{voto.editadoEm ? ` · alterado em ${formatDateTime(voto.editadoEm)}` : ''}</small>
              </div>
            )))}
          </div>
        )}
        </>
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
  // Seção "Votações" inicia recolhida. Regras: abre sozinha quando uma nova
  // pesquisa é publicada (o total aumenta em relação ao render anterior) e
  // volta a recolher ao trocar de reunião selecionada.
  const [votacoesAbertas, setVotacoesAbertas] = useState(false)
  // Formulário "Criar pesquisa de votos" também inicia recolhido e volta a
  // recolher ao trocar de reunião.
  const [formPesquisaAberto, setFormPesquisaAberto] = useState(false)
  // Id da pesquisa recém-publicada: o card correspondente abre expandido.
  const [pesquisaRecemCriada, setPesquisaRecemCriada] = useState(null)
  const quantidadePesquisasRef = useRef(pesquisasDaReuniao.length)
  useEffect(() => {
    if (pesquisasDaReuniao.length > quantidadePesquisasRef.current) setVotacoesAbertas(true)
    quantidadePesquisasRef.current = pesquisasDaReuniao.length
  }, [pesquisasDaReuniao.length])
  useEffect(() => {
    setVotacoesAbertas(false)
    setFormPesquisaAberto(false)
    quantidadePesquisasRef.current = pesquisasDaReuniao.length
  }, [assembleiaSelecionada])

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
    const novaId = criarVotacao({ assembleiaId: pesquisa.assembleiaId, pergunta: pesquisa.pergunta.trim(), opcoes })
    if (novaId) setPesquisaRecemCriada(novaId)
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
          <div className="field"><label>Link da reunião online (opcional)</label><input type="url" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="Alternativa à sala de vídeo: cole o link do Teams ou Google Meet" /></div>
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
            <div className="panel-header"><div><h3>{atual.titulo}</h3><p className="field-help">{dataLegivel(atual.data)} · {atual.encerrada ? 'Encerrada' : 'Aberta'}</p></div><div className="assembleia-acoes"><button type="button" className="btn btn-small btn-ghost" onClick={() => setAssembleiaSelecionada(null)}>Voltar para reuniões</button>{podeAdministrar && !atual.encerrada && <button type="button" className="btn btn-small btn-danger" onClick={() => encerrarAssembleia(atual.id)}>Encerrar assembleia</button>}</div></div>
            <SalaVideo assembleiaId={atual.id} usuario={userProfile} ativo={!atual.encerrada} linkExterno={atual.link} />
            {atual.pauta && <div className="assembleia-pauta"><strong>Pauta</strong><p>{atual.pauta}</p></div>}
            {podeAdministrar && (
              <form className="assembleia-votacao-form" onSubmit={salvarPesquisa}>
                <div className="assembleia-votacao-form-topo">
                  <h4>Criar pesquisa de votos</h4>
                  <button type="button" className="btn btn-small btn-ghost" onClick={() => setFormPesquisaAberto((aberto) => !aberto)} aria-expanded={formPesquisaAberto}>
                    {formPesquisaAberto ? 'Recolher' : 'Mostrar'}
                  </button>
                </div>
                {formPesquisaAberto && (
                  <>
                    <input type="hidden" value={pesquisa.assembleiaId} />
                    <div className="field"><label>Pergunta</label><input value={pesquisa.pergunta} onChange={(e) => setPesquisa({ ...pesquisa, pergunta: e.target.value, assembleiaId: atual.id })} placeholder="Aprovar a reforma da fachada?" required /></div>
                    <div className="field"><label>Opções (uma por linha)</label><textarea rows="3" value={pesquisa.opcoes} onChange={(e) => setPesquisa({ ...pesquisa, opcoes: e.target.value })} /></div>
                    <button className="btn btn-ghost" type="submit">Publicar pesquisa</button>
                  </>
                )}
              </form>
            )}
            <div className="assembleia-pesquisas">
              <div className="assembleia-pesquisas-topo">
                <h4>Votações</h4>
                <div className="assembleia-pesquisas-acoes">
                  <span className="field-help">{pesquisasDaReuniao.length} pesquisa(s)</span>
                  <button type="button" className="btn btn-small btn-ghost" onClick={() => setVotacoesAbertas((aberta) => !aberta)} aria-expanded={votacoesAbertas}>
                    {votacoesAbertas ? 'Recolher' : 'Mostrar'}
                  </button>
                </div>
              </div>
              {votacoesAbertas && (pesquisasDaReuniao.length === 0 ? <p className="empty">Nenhuma pesquisa criada.</p> : pesquisasDaReuniao.map((item) => <PesquisaCard key={item.id} pesquisa={item} votos={votos} usuario={userProfile} podeAdministrar={podeAdministrar} reuniaoEncerrada={atual.encerrada} onVotar={votar} onEncerrar={encerrarVotacao} abertoPorPadrao={item.id === pesquisaRecemCriada} />))}
            </div>
          </>}
        </section>
      </div>
    </div>
  )
}
