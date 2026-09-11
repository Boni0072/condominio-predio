export const REGRAS_FIRESTORE = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function autenticado() {
      return request.auth != null;
    }

    function eMaster() {
      return autenticado() && request.auth.token.email.lower() == 'ander.fj@hotmail.com';
    }

    function perfilAtual() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
    }

    function eSindicoDoCondominio(tenantId) {
      return autenticado()
        && exists(/databases/$(database)/documents/users/$(request.auth.uid))
        && perfilAtual().role == 'sindico'
        && perfilAtual().condominioId == tenantId;
    }

    function pertenceAoCondominio(tenantId) {
      return eMaster()
        || (autenticado()
          && exists(/databases/$(database)/documents/users/$(request.auth.uid))
          && perfilAtual().condominioId == tenantId);
    }

    function podeEscreverNoCondominio(tenantId) {
      return eMaster()
        || eSindicoDoCondominio(tenantId)
        || (pertenceAoCondominio(tenantId)
          && (perfilAtual().role == 'zelador' || perfilAtual().role == 'portaria'
            || perfilAtual().role == 'conselheiro'));
    }

    match /users/{userId} {
      // O usuário pode ler o próprio perfil mesmo que ele ainda não exista
      // (necessário durante o cadastro do morador, antes da gravação do perfil).
      // Conselheiro e zelador precisam ler a lista do condomínio para aprovar
      // orçamentos / convidar moradores — sem isso "Firmar e guardar aprovação"
      // e "Convidar moradores" ficam vazios ou falham.
      allow read: if eMaster()
        || (autenticado() && request.auth.uid == userId)
        || (autenticado()
          && exists(/databases/$(database)/documents/users/$(request.auth.uid))
          && (resource.data.condominioId == perfilAtual().condominioId
            || perfilAtual().role == 'sindico'
            || perfilAtual().role == 'conselheiro'
            || perfilAtual().role == 'zelador'));
      allow create: if eMaster()
        || (autenticado() && (request.auth.uid == userId
          || eSindicoDoCondominio(request.resource.data.condominioId)));
      // Síndico edita qualquer usuário do condomínio; conselheiro pode marcar
      // ou desmarcar convidados para aprovação (campo convidadoParaAprovar +
      // acessos) sem poder alterar nome, perfil ou outros dados.
      allow update, delete: if eMaster() || (autenticado()
        && (request.auth.uid == userId
          || eSindicoDoCondominio(resource.data.condominioId)
          || (pertenceAoCondominio(resource.data.condominioId)
            && perfilAtual().role == 'conselheiro'
            && request.resource.data.diff(resource.data).affectedKeys()
              .hasOnly(['convidadoParaAprovar', 'acessos']))));
    }

    match /tenants/{tenantId} {
      // Leitura liberada para qualquer usuário autenticado: é o que permite
      // localizar o tenant pelo código de acesso no cadastro do morador.
      allow read: if autenticado();
      allow create: if eMaster();
      allow update, delete: if eMaster() || eSindicoDoCondominio(tenantId);
    }

    // Tokens de push dos dispositivos — usuário lê/escreve apenas do próprio tenant
    match /tenants/{tenantId}/pushTokens/{uid} {
      allow read, create, update: if pertenceAoCondominio(tenantId);
      allow delete: if eMaster() || pertenceAoCondominio(tenantId);
    }

    match /tenants/{tenantId}/votos/{votoId} {
      allow read: if pertenceAoCondominio(tenantId);
      allow create: if pertenceAoCondominio(tenantId)
        && request.resource.data.usuarioId == request.auth.uid
        && request.resource.data.id == votoId;
      allow update, delete: if eMaster();
    }

    // Sala de vídeo das assembleias (WebRTC mesh com o Firestore como
    // sinalização). Presença: cada participante grava o próprio documento;
    // qualquer membro pode ler a lista da sala e apagar presenças "fantasmas"
    // (aba fechada sem clicar em "Sair", sem batimento recente).
    match /tenants/{tenantId}/salasVideo/{salaId}/participantes/{uid} {
      allow read, delete: if pertenceAoCondominio(tenantId);
      allow create, update: if pertenceAoCondominio(tenantId)
        && request.auth.uid == uid;
    }

    // Sinalização WebRTC: documentos de offer/answer/candidatos ICE. Somente
    // o autor cria (de == uid); autor ou destinatário apaga após processar.
    // Sem update: mensagens são imutáveis.
    match /tenants/{tenantId}/salasVideo/{salaId}/sinais/{sinalId} {
      allow read: if pertenceAoCondominio(tenantId);
      allow create: if pertenceAoCondominio(tenantId)
        && request.resource.data.de == request.auth.uid;
      allow delete: if pertenceAoCondominio(tenantId)
        && (resource.data.de == request.auth.uid || resource.data.para == request.auth.uid);
    }

    // Chat coletivo da assembleia: mensagens persistidas (não são apagadas
    // após processadas, como os sinais). Qualquer membro do condomínio pode
    // ler o histórico e enviar mensagens. Sem update/delete: uma mensagem
    // enviada não é editada nem removida por outros (exceto administração
    // do Firebase, se necessário).
    match /tenants/{tenantId}/salasVideo/{salaId}/mensagens/{mensagemId} {
      allow read: if pertenceAoCondominio(tenantId);
      allow create: if pertenceAoCondominio(tenantId)
        && request.resource.data.uid == request.auth.uid;
    }

    // Gravações de vídeo da reunião: leitura por qualquer membro; criação
    // apenas pelo participante que gravou (por == uid). Sem update/delete:
    // gravações são imutáveis.
    match /tenants/{tenantId}/salasVideo/{salaId}/gravacoes/{gravacaoId} {
      allow read: if pertenceAoCondominio(tenantId);
      allow create: if pertenceAoCondominio(tenantId)
        && request.resource.data.por == request.auth.uid;
      allow update, delete: if false;
    }

    match /tenants/{tenantId}/{documento=**} {
      // Leitura: qualquer membro do condomínio (inclui conselheiro, que precisa
      // ver orçamentos/despesas para votar e "Firmar e guardar aprovação").
      allow read: if pertenceAoCondominio(tenantId);
      // Escrita: síndico, zelador, portaria e conselheiro (este último assina as
      // aprovações de orçamento e convida moradores — demais telas bloqueiam
      // edição para ele no próprio código).
      allow write: if podeEscreverNoCondominio(tenantId);
    }
  }
}`