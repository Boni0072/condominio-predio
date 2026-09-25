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
- Na aba **Meus Pagamentos**, o morador vê as mensalidades em aberto (`gerado`/`vencido`) e usa **Gerar boleto** para montar o boleto daquela cobrança (linha digitável de 47 dígitos, código de barras, copiar e baixar/imprimir)
- O boleto é calculado **inteiramente no navegador** (`src/components/pagamentos/boletoUtils.js` + `BoletoGerado.jsx`): o morador **não** grava nada em `boletos` no Firestore — as regras de segurança continuam permitindo que só síndico/zelador/portaria escrevam. É um boleto de demonstração, sem registro em banco, identificado a partir da cobrança
- Sem os dados bancários cadastrados, a tela avisa de forma amigável ("Boleto bancário ainda não configurado pelo síndico — pague por PIX") e o fluxo de **PIX Copia e Cola/QR Code** continua funcionando normalmente
- A emissão manual (`EmissaoBoleto.jsx`) segue disponível em **Pagamentos › Emitir Boletos**, visível apenas para síndico/zelador/portaria, para cobranças avulsas (multa, serviço extra, evento), edição e baixa
- Conferência manual dos números do boleto (44 dígitos do código de barras e 47 da linha digitável, inclusive valor quebrado e campos ausentes): `node scripts/verificar-boleto.mjs`

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
