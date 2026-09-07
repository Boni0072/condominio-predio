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
          && (perfilAtual().role == 'zelador' || perfilAtual().role == 'portaria'));
    }

    match /users/{userId} {
      // O usuário pode ler o próprio perfil mesmo que ele ainda não exista
      // (necessário durante o cadastro do morador, antes da gravação do perfil).
      allow read: if eMaster()
        || (autenticado() && request.auth.uid == userId)
        || (autenticado()
          && exists(/databases/$(database)/documents/users/$(request.auth.uid))
          && resource.data.condominioId == perfilAtual().condominioId);
      allow create: if eMaster()
        || (autenticado() && (request.auth.uid == userId
          || eSindicoDoCondominio(request.resource.data.condominioId)));
      allow update, delete: if eMaster() || (autenticado()
        && (request.auth.uid == userId
          || eSindicoDoCondominio(resource.data.condominioId)));
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

    match /tenants/{tenantId}/{documento=**} {
      allow read: if pertenceAoCondominio(tenantId);
      allow write: if podeEscreverNoCondominio(tenantId);
    }
  }
}`