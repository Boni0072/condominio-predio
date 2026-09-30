# Portaria & Mural — PWA para condomínios

Sistema PWA (Progressive Web App) em React para controle de portaria e mural de comunicados de condomínios. Funciona offline, pode ser "instalado" no celular/tablet da portaria e no celular dos moradores. **Multiusuários real com Firebase** — cada condomínio tem seus próprios dados isolados, acessíveis por qualquer dispositivo com login.

## Funcionalidades

**Autenticação multiusuários (Firebase Auth + Firestore)**
- Usuário master cria o condomínio e o síndico (o condomínio recebe um código de 6 letras)
- Moradores criam a própria conta pelo código do condomínio na tela de login
- Zeladores e porteiros são cadastrados pelo síndico em Gestão de usuários
- Login por e-mail e senha
- Dados isolados por condomínio — cada condomínio vê apenas seus próprios registros

**Portaria** (perfis Portaria / Síndico)
- Registro de entrada de visitantes (nome, documento, unidade, autorizado por, motivo, acompanhantes do apartamento)
- Controle de saída, com lista do que está "no condomínio" agora
- Registro e controle de encomendas (chegada / retirada), com foto opcional da encomenda pela câmera e assinatura digital de quem retirou
- Subpáginas com abas na portaria: **Visitantes** e **Encomendas** (`/portaria/visitantes` e `/portaria/encomendas`)

**Painel de controle** (perfis Portaria / Síndico)
- Cartões-resumo clicáveis: visitantes no condomínio, encomendas aguardando retirada, moradores cadastrados e comunicados do mural
- Listas rápidas: registro de saída de visitantes e aviso de encomenda por WhatsApp sem sair do painel
- Atividade recente (entradas, saídas, encomendas, retiradas e comunicados) e últimos comunicados publicados

**Moradores** (perfis Portaria / Síndico)
- Cadastro de moradores por unidade: nome, unidade, WhatsApp, e-mail e vínculo (proprietário/locatário)
- Busca por nome ou unidade, além de edição e remoção do cadastro
- Botão **WhatsApp** em cada morador: abre a conversa (`wa.me`) já com mensagem pronta
- Na portaria, o campo **Unidade/Destinatário** do registro de encomendas é uma lista com as unidades cadastradas em Moradores, e ao selecionar, chips dos moradores permitem preencher rapidamente o destinatário
- Encomendas pendentes ganham o botão **Avisar no WhatsApp** quando a unidade corresponde a um morador cadastrado

**Despesas** (perfil Síndico)
- Cadastro de despesas com materiais ou serviços: descrição, valor, categoria, tipo, data, fornecedor
- 11 categorias: Manutenção, Limpeza, Segurança, Água, Energia, Gás, Jardinagem, Piscina, Elevador, Folha de Pagamento, Outros
- Upload de **comprovante** em imagem (com compressão automática)
- Filtros por texto, categoria e mês
- Resumo com total de despesas filtradas

**Mural de avisos** (todos os perfis; publicação só para Síndico)
- Comunicados por categoria (geral, manutenção, urgente, evento)
- Fixar avisos importantes no topo
- Visualização somente-leitura para moradores

**Visibilidade dos dados (privacidade por usuário)**
- Pagamentos (boletos/cobranças), visitantes e encomendas são individuais: cada usuário vê apenas os **próprios** registros (os da sua unidade ou endereçados ao seu nome)
- Visão total do condomínio é exclusiva dos **gestores: síndico, zelador e portaria** (o master, que administra a plataforma, também vê tudo)
- Morador e conselheiro consultam somente os próprios boletos (`Meus Pagamentos` / `Minhas cobranças`) e só veem visitantes/encomendas da sua unidade — inclusive nos cartões do painel
- Regra centralizada em `src/utils/permissoes.js` (`PERFIS_VISAO_TOTAL`, `registroPertenceAoUsuario`, `filtrarDoUsuario`), aplicada no Painel, na Portaria e em Pagamentos
- **Sem agrupamento por mês para morador e conselheiro**: as listas desses perfis são simples (boleto a boleto / despesa a despesa). O agrupamento por mês (com recolher/expandir, "pagos × não pagos" e grupos de categoria) é exclusivo dos gestores
- O filtro é aplicado na interface; as regras do Firestore (`src/firebase/regras.js`) continuam liberando leitura para os membros do condomínio (necessário para o app funcionar offline)

## Pagamentos: mensalidade, boleto e PIX

- O síndico cadastra a **chave PIX** e os **dados bancários do boleto** (banco, agência, conta, carteira/convênio) em **Pagamentos › Configurar Contas** — tudo no mesmo documento `tenants/{condominioId}/config_pix/principal`
- As mensalidades são geradas em massa em **Configurações › Cobrança mensal** (`GerarCotas.jsx`), gravando em `tenants/{condominioId}/boletos`
- Na aba **Meus Pagamentos**, o morador vê as mensalidades em aberto (`gerado`/`vencido`) e abre a cobrança com **Ver / pagar boleto** (quando o boleto já foi registrado pela administração): linha digitável de 47 dígitos, código de barras, copiar e baixar/imprimir. Se ainda não foi registrado, o modal mostra o boleto de demonstração + o aviso de "aguarde o registro" e o PIX. Quem registra é só a administração
- O boleto é calculado **inteiramente no navegador** (`src/components/pagamentos/boletoUtils.js` + `BoletoGerado.jsx`): o morador **não** grava nada em `boletos` no Firestore — as regras de segurança continuam permitindo que só síndico/zelador/portaria escrevam. É um boleto de demonstração, sem registro em banco, identificado a partir da cobrança
- Sem os dados bancários cadastrados, a tela avisa de forma amigável ("Boleto bancário ainda não configurado pelo síndico — pague por PIX") e o fluxo de **PIX Copia e Cola/QR Code** continua funcionando normalmente
- A emissão manual (`EmissaoBoleto.jsx`) segue disponível em **Pagamentos › Emitir Boletos**, visível apenas para síndico/zelador/portaria, para cobranças avulsas (multa, serviço extra, evento), edição e baixa
- Conferência manual dos números do boleto (44 dígitos do código de barras e 47 da linha digitável, inclusive valor quebrado e campos ausentes): `node scripts/verificar-boleto.mjs`

### Boleto REGISTRADO no Mercado Pago (código de barras oficial)

O sistema gera dois tipos de boleto: o **de demonstração** (calculado no navegador, sem registro em banco — útil quando o condomínio não tem convênio) e o **registrado**, cujo código de barras/linha digitável vêm do próprio banco através da API do Mercado Pago.

**Fluxo combinado:** o **síndico/zelador/portaria gera as cobranças e registra os boletos**; o **morador acessa o boleto já registrado e paga** (linha digitável, código de barras, boleto oficial ou PIX). Registrar boleto não é ação do morador — nem no app nem na Cloud Function.

1. O **síndico** cadastra o **Access Token de produção** do Mercado Pago em **Pagamentos › Configurar Contas › Boleto registrado (Mercado Pago)** (o token está no painel *Mercado Pago › Developers › Credenciais de produção*)
2. Em **Pagamentos › Emitir Boletos** (ou no modal do boleto, em *Meus Pagamentos*, pelo gestor) use **Registrar no Mercado Pago**: informe nome completo, CPF/CNPJ, e-mail e o **endereço do pagador** (CEP, rua, número, bairro, cidade e UF — o botão **Buscar CEP** completa o endereço pelo ViaCEP, é só conferir o número)
3. A cobrança passa a exibir o **código de barras de 44 dígitos**, a **linha digitável de 47 dígitos** e o **link do boleto oficial** para imprimir/pagar; o botão **Conferir pagamento** consulta o status e dá baixa automática quando aprovado
4. **O morador só paga — ele não registra nada**: em **Meus Pagamentos** ele abre a cobrança (botão *Ver / pagar boleto* quando já registrada) e encontra o **código de barras de 44 dígitos**, a **linha digitável de 47** (com *copiar*), o **boleto oficial** do Mercado Pago para imprimir/pagar e o **PIX** da mesma cobrança. Se a administração ainda não registrou, o modal avisa e orienta a usar o PIX — a Cloud Function recusa chamada de morador com `permission-denied`

Detalhes de implementação e segurança:

- O Access Token **nunca chega ao navegador**: a chamada à API é feita pelas Cloud Functions `gerarBoletoMercadoPago` e `sincronizarBoletoMercadoPago` (`functions/index.js`), e o token fica no documento privado `config_privada/{condominioId}` — lido apenas pelo síndico e pelo master (ver `firestore.rules`)
- **Endereço do pagador é obrigatório**: desde 30/09/2024 o Mercado Pago (exigência do BACEN) recusa a emissão do boleto sem rua, número, bairro, CEP, cidade e UF do pagador (HTTP 400 → nenhum código de barras é gerado). As telas coletam e validam esses campos e gravam tudo na cobrança (`pagadorLogradouro`, `pagadorNumero`, `pagadorBairro`, `pagadorCidade`, `pagadorUf`), reaproveitando na 2ª via. Número em branco vira `S/N`
- As funções gravam os números oficiais na própria cobrança (`codigoBarras`, `linhaDigitavel`, `urlBoleto`, `mercadoPagoId`, `mercadoPagoStatus`) usando o Admin SDK — o morador continua **sem** permissão de escrita em `tenants/{condominioId}/boletos`
- O Access Token pode também vir da variável de ambiente `MERCADO_PAGO_ACCESS_TOKEN` (útil quando definido no deploy)
- O vencimento enviado é limitado à janela aceita pelo Mercado Pago (1 a 30 dias a partir da emissão) — a tela avisa quando o vencimento da cobrança precisou ser ajustado
- A requisição usa `X-Idempotency-Key` derivada do id da cobrança, evitando boleto duplicado em clique duplo/repetição
- **Baixa automática via Webhook**: o endpoint público HTTP `webhookMercadoPago` (`functions/index.js`) recebe os avisos instantâneos do Mercado Pago quando o boleto é pago, consulta o status e dá baixa imediata na cobrança (`status = 'pago'`), sem que o gestor precise clicar em "Conferir pagamento". Novos boletos já registram a URL automaticamente via `notification_url`.
- As validações e o payload vivem em `functions/mercadopagoBoleto.js` (módulo puro), reaproveitado pelo app: o que a tela valida é exatamente o que o servidor envia
- **Pagador já sai preenchido (para quem registra)**: `completarPagador()` (módulo puro, usado pelas telas **e** pela Cloud Function) monta o pagador na ordem *digitado agora → ficha da cobrança (`pagador*`/`morador*` de um registro anterior) → endereço do condomínio* (é lá que o devedor mora). Faltando dado, a função devolve `failed-precondition` com `details.faltamDadosPagador` e a lista exata dos campos que faltam
- **Quem registra é só a administração**: `gerarBoletoMercadoPago` passa por `contextoGestorPagamento` (síndico/zelador/portaria/master); morador recebe `permission-denied` com a orientação de esperar o boleto. Os dados **pessoais** de quem clica nunca entram no boleto do vizinho (`usarCadastro: false`): o CPF/endereço do síndico não viram os do devedor. O morador continua vendo apenas as próprias cobranças (a mesma regra `cobrancaPertenceAoUsuario` da tela vale no servidor, via `cobrancaDoMorador`) e pode acompanhar/conferir a própria cota
- Nada é gravado no perfil de quem registra: os dados do pagador ficam na **própria cobrança** (campos `pagador*`) e são reaproveitados na 2ª via e em re-registros — o morador segue **sem** escrita em `boletos` e sem acesso ao token
- Conferência manual das regras do boleto registrado (CPF/CNPJ, vencimento, payload, webhook, leitura da resposta e coerência entre código de barras e linha digitável): `node scripts/verificar-mercadopago.mjs`

**Deploy necessário após atualizar:** `firebase deploy --only functions,firestore:rules,hosting`

> As funções `gerarBoletoMercadoPago`, `sincronizarBoletoMercadoPago` e `webhookMercadoPago` **precisam estar publicadas** — sem o deploy o app responde "A função de boleto do Mercado Pago não está publicada no Firebase" e nenhum código real é gerado (foi exatamente o que aconteceu até 30/09/2026).

> Pendência conhecida: a geração em massa (`GerarCotas.jsx`) cria as mensalidades **sem** registrar os boletos no Mercado Pago — e o cadastro dos moradores (`users/{uid}`) não guarda CPF nem endereço, então ainda não dá para registrar tudo de uma vez. Hoje o síndico registra cobrança a cobrança (em **Emitir Boletos** ou no modal, em *Meus Pagamentos*): o formulário já sai preenchido com o que a cobrança sabe + o endereço do condomínio, e o **Buscar CEP** completa rua/bairro/cidade/UF. O que for confirmado fica gravado na cobrança (`pagador*`) e é reaproveitado na 2ª via. Caminho para registrar em massa: guardar CPF/endereço uma vez por unidade (no cadastro) e reaproveitar a ficha do morador nas cotas seguintes.

## Rodando localmente

Requer Node.js 18+.

```bash
npm install
npm run dev       # ambiente de desenvolvimento, http://localhost:5173
```

## Configurando o Firebase

1. Acesse o [Console do Firebase](https://console.firebase.google.com/) e crie um projeto
2. No menu **Authentication** → **Sign-in method**, habilite **E-mail/senha**
3. No menu **Firestore Database**, crie o banco de dados (modo produção ou teste)
4. Copie as credenciais do seu projeto e substitua em `src/firebase/config.js`
5. O Firestore criará automaticamente as coleções conforme o sistema é usado

### Estrutura do banco de dados (Firestore)

```
tenants/{tenantId}                    → dados do condomínio (nome, código, endereço)
tenants/{tenantId}/moradores/{id}
tenants/{tenantId}/visitantes/{id}
tenants/{tenantId}/encomendas/{id}
tenants/{tenantId}/comunicados/{id}
tenants/{tenantId}/despesas/{id}
tenants/{tenantId}/orcamentos/{id}
tenants/{tenantId}/assembleias/{id}
tenants/{tenantId}/votacoes/{id}
tenants/{tenantId}/votos/{id}
tenants/{tenantId}/boletos/{id}          → cobranças (mensalidade, multa, evento...)
tenants/{tenantId}/config_pix/principal  → chave PIX, dados bancários e flag do Mercado Pago
config_privada/{tenantId}                → Access Token do Mercado Pago (só síndico/master leem)
users/{uid}                           → perfil global do usuário + condominioId
```

Cada condominio é um `tenant`. Os dados de cada condominio estão isolados sob seu próprio `tenantId`.

## Gerando a versão de produção (PWA instalável)

```bash
npm run build      # gera a pasta dist/ com o service worker e o manifest
npm run preview    # serve dist/ localmente para testar o "instalar app"
```

Para instalar de verdade como app (ícone na tela inicial, funcionamento offline), publique o conteúdo de `dist/` em um servidor **HTTPS** (Vercel, Netlify, Cloudflare Pages, etc. — PWAs exigem HTTPS, exceto em localhost).

## Instalando como aplicativo nas máquinas

Com o sistema publicado em **HTTPS**, ele pode ser instalado como aplicativo — abre em janela própria, ganha ícone no menu iniciar/área de trabalho, entra nos atalhos rápidos (**Portaria** e **Mural**) e continua funcionando offline:

**Windows / Linux / macOS (Chrome ou Edge)**
1. Abra o endereço do sistema e faça login.
2. No menu lateral, clique em **⬇ Instalar aplicativo** (ou use o ícone de instalação na barra de endereço / menu ⋮ → *Instalar Portaria & Mural*).
3. Confirme: o sistema abre em janela própria, como um programa comum.

**iPhone/iPad (Safari)**
1. Toque no botão **Compartilhar** e depois em **Adicionar à Tela de Início**.

**Android (Chrome)**
1. Toque em **⬇ Instalar aplicativo** no menu lateral e confirme.

> O botão de instalação só aparece quando o navegador suporta e o app ainda não está instalado. Em `npm run preview` (localhost) também é possível testar a instalação.

## Estrutura do projeto

```
src/
  firebase/config.js              # configuração do Firebase
  context/
    AuthContext.jsx               # autenticação (Firebase Auth + perfis)
    AppContext.jsx                # estado global + dados (Firestore)
  components/
    Login.jsx                     # login / criar condomínio / entrar com código
    Layout.jsx                    # navegação lateral + info do usuário
    painel/Painel.jsx             # painel de controle (visão geral)
    shared/AvisoEncomendaWhatsApp.jsx  # botão de aviso por WhatsApp reutilizável
    portaria/Portaria.jsx         # subpáginas de visitantes e encomendas
    portaria/AssinaturaRetiradaModal.jsx  # assinatura na retirada de encomendas
    moradores/Moradores.jsx       # cadastro de moradores + WhatsApp
    mural/Mural.jsx               # comunicados
    despesas/Despesas.jsx         # controle de despesas + comprovantes
    pagamentos/
      Pagamentos.jsx              # abas Consultar/Meus Pagamentos e Emitir Boletos
      ConfigurarContas.jsx        # chave PIX, dados bancários e credenciais do Mercado Pago
      EmissaoBoleto.jsx           # emissão/edição de cobranças (+ registro no Mercado Pago)
      ConsultarPagamentos.jsx     # lista de boletos, PIX Copia e Cola/QR e modal do boleto
      BoletoGerado.jsx            # modal do boleto (demonstração ou registrado) + ações
      boletoUtils.js              # cálculo local do boleto e PIX (BR Code)
      mercadoPago.js              # credenciais + chamadas às Cloud Functions do boleto registrado
      cobrancas.js / useCobrancas.js  # coleção de cobranças (boletos) + migração
functions/
  index.js                        # notificações push + gerarBoletoMercadoPago/sincronizarBoletoMercadoPago
  mercadopagoBoleto.js            # validações e payload do boleto registrado (módulo puro)
scripts/
  verificar-boleto.mjs            # conferência manual dos números do boleto local
  verificar-mercadopago.mjs       # conferência manual das regras do boleto registrado
  utils/storage.js                # helpers de datas (formatadores)
  utils/permissoes.js             # acessos por perfil + visibilidade dos dados (privacidade)
  utils/whatsapp.js               # helpers de telefone e links wa.me
  utils/imagem.js                 # captura e compressão de fotos da câmera
public/
  icons/                          # ícones do manifest (192x192, 512x512)
vite.config.js                    # configuração do vite-plugin-pwa (manifest + service worker)
```

## Próximos passos sugeridos

- **Notificações push** (PWA suporta) para avisar o morador quando uma encomenda chega ou um visitante é liberado.
- **Registro de múltiplos usuários síndico** (hoje apenas o criador do condomínio é síndico; pode-se promover outros via Firestore).
- **Fotos**: capturar foto do visitante/documento pela câmera do tablet da portaria.
- **App nativo**: o PWA já funciona como app; se desejado, encapsular em Capacitor/React Native para lojas.
- **Firebase Storage** para armazenar fotos das encomendas (hoje salvas como data URL no Firestore, funciona para volumes pequenos).
