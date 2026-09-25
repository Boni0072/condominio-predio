// Harness temporário de teste: monta o BoletoGerado e registra os eventos
// disparados pelos botões (fechar/copiar/pix) para o teste com navegador.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import BoletoGerado from '../src/components/pagamentos/BoletoGerado.jsx'

const boleto = {
  id: 'cota1',
  moradorNome: 'Maria Souza',
  moradorUnidade: 'Apto 12',
  descricao: 'Cota condominial Setembro/2026',
  valor: 1234.56,
  dataVencimento: '2026-10-10',
  nossoNumero: '0000123-4'
}

const dadosBancarios = { banco: '001', agencia: '1234', conta: '12345678', carteira: '017', convenio: '' }

// ?sem-config → simula o condomínio que ainda não cadastrou banco/agência/conta.
const semConfig = new URLSearchParams(window.location.search).has('sem-config')

function Harness({ estatico = false }) {
  const [aberto, setAberto] = useState(true)
  const [eventos, setEventos] = useState([])
  window.__eventos = eventos

  const registrar = (evento) => {
    if (estatico) return
    setEventos((atuais) => [...atuais, evento])
  }

  return (
    <div>
      {aberto || estatico ? (
        <BoletoGerado
          boleto={boleto}
          dadosBancarios={semConfig ? { banco: '', agencia: '', conta: '', carteira: '', convenio: '' } : dadosBancarios}
          beneficiario='Condomínio Teste'
          onFechar={() => { registrar('fechar'); setAberto(false) }}
          onCopiar={(texto, rotulo) => registrar(`copiar:${rotulo}:${String(texto).length}`)}
          onPix={() => registrar('pix')}
        />
      ) : (
        <div id='fechado'>Fechado</div>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')).render(<Harness />)
