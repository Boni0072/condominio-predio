// Diagnóstico de login — verifica de forma definitiva por que o acesso falha.
// Uso:
//   node diagnostico-login.mjs <email> [senha]
//
// O que ele faz:
//   1. Verifica se o e-mail EXISTE no Firebase Authentication (teste seguro:
//      se não existir, cria uma conta temporária e apaga em seguida)
//   2. Testa o login com a senha informada e mostra o código exato do erro
//   3. Se o login funcionar, consulta o Firestore e mostra:
//      - o perfil do usuário (role, condominioId) ou avisa se não existe
//      - todos os condomínios com os códigos de acesso cadastrados
//
// Nenhum dado é alterado no banco (apenas leitura + conta temporária removida).

const API_KEY = 'AIzaSyCNmyvumG0-8Vgdg5nQb-hRT6U5ZbHv9IA'
const PROJECT_ID = 'portaria-condominio-8fbc9'
const BASE = 'https://identitytoolkit.googleapis.com/v1'
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`

const email = (process.argv[2] || '').trim().toLowerCase()
const senha = process.argv[3]

if (!email) {
  console.log('\nUso: node diagnostico-login.mjs <email> [senha]\n')
  console.log('Exemplos:')
  console.log('  node diagnostico-login.mjs maria@email.com')
  console.log('  node diagnostico-login.mjs maria@email.com senha123\n')
  process.exit(1)
}

function linha(t = '-') {
  console.log(t.repeat(60))
}

async function identityToolkit(endpoint, body) {
  const res = await fetch(`${BASE}/${endpoint}?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  let data = {}
  try { data = await res.json() } catch { /* resposta vazia */ }
  return { ok: res.ok, data }
}

async function firestoreGet(path, idToken) {
  const res = await fetch(`${FS}/${path}`, {
    headers: { Authorization: `Bearer ${idToken}` }
  })
  let data = {}
  try { data = await res.json() } catch { /* resposta vazia */ }
  return { ok: res.ok, status: res.status, data }
}

function campo(doc, nome) {
  const f = doc?.fields?.[nome]
  if (!f) return '(vazio)'
  if (f.stringValue !== undefined) return f.stringValue
  if (f.integerValue !== undefined) return f.integerValue
  if (f.timestampValue !== undefined) return f.timestampValue
  return JSON.stringify(f)
}

linha('=')
console.log(`DIAGNÓSTICO DE LOGIN — ${email}`)
linha('=')

// ---------- 1. A conta existe no Authentication? ----------
console.log('\n[1] Verificando se a conta existe no Firebase Authentication...')
const probe = await identityToolkit('accounts:signUp', {
  email,
  password: 'probe-' + Math.random().toString(36).slice(2, 12),
  returnSecureToken: true
})

let contaExiste
if (probe.ok) {
  // Não existia: foi criada só para o teste — apagar agora.
  contaExiste = false
  const del = await identityToolkit('accounts:delete', { idToken: probe.data.idToken })
  console.log(`    => A conta NÃO EXISTE no Authentication (conta temporária de teste ${del.ok ? 'removida' : 'NÃO consegui remover — apague manualmente no console'}).`)
} else if (probe.data?.error?.message === 'EMAIL_EXISTS') {
  contaExiste = true
  console.log('    => A conta EXISTE no Firebase Authentication.')
} else {
  console.log(`    => Não deu para verificar: ${probe.data?.error?.message}`)
  contaExiste = null
}

// ---------- 2. Teste de login com a senha informada ----------
let idToken = null
let uid = null

if (senha) {
  console.log('\n[2] Testando login com a senha informada...')
  const login = await identityToolkit('accounts:signInWithPassword', { email, password: senha, returnSecureToken: true })
  if (login.ok) {
    idToken = login.data.idToken
    uid = login.data.localId
    console.log(`    => LOGIN FUNCIONOU! Senha correta. (uid: ${uid})`)
  } else {
    const msg = login.data?.error?.message || 'erro desconhecido'
    console.log(`    => LOGIN FALHOU. Código do Firebase: ${msg}`)
    if (msg.includes('INVALID_LOGIN_CREDENTIALS') || msg.includes('INVALID_PASSWORD') || msg.includes('EMAIL_NOT_FOUND')) {
      if (contaExiste === true) console.log('       A conta existe, mas a SENHA está errada. Use "Esqueci minha senha" no app ou redefina no console.')
      else if (contaExiste === false) console.log('       A conta NÃO existe — por isso o login falha. O cadastro foi desfeito em algum momento.')
      else console.log('       Confira também a senha e o e-mail digitados.')
    }
  }
} else {
  console.log('\n[2] Teste de senha pulado (nenhuma senha informada).')
}

// ---------- 3. Perfil e condomínios no Firestore ----------
if (idToken) {
  console.log('\n[3] Consultando o Firestore com a sessão do usuário...')

  const perfil = await firestoreGet(`users/${uid}`, idToken)
  if (perfil.ok) {
    console.log(`    Perfil do usuário (users/${uid}):`)
    console.log(`       nome         = ${campo(perfil.data, 'nome')}`)
    console.log(`       email        = ${campo(perfil.data, 'email')}`)
    console.log(`       role         = ${campo(perfil.data, 'role')}`)
    console.log(`       condominioId = ${campo(perfil.data, 'condominioId')}`)
    console.log(`       status       = ${campo(perfil.data, 'status')}`)
  } else if (perfil.status === 404) {
    console.log('    => PERFIL NÃO EXISTE no Firestore (users/...). O cadastro não foi concluído.')
  } else {
    console.log(`    => Erro ao ler o perfil: HTTP ${perfil.status} — ${perfil.data?.error?.message || ''}`)
    console.log('       Se for PERMISSION_DENIED, as regras do Firestore não estão publicadas/atualizadas no console.')
  }

  const condos = await firestoreGet('condominios?pageSize=50', idToken)
  if (condos.ok) {
    const docs = condos.data.documents || []
    if (docs.length === 0) {
      console.log('    Nenhum condomínio cadastrado na coleção "condominios".')
    } else {
      console.log(`    Condomínios encontrados (${docs.length}):`)
      docs.forEach((d) => {
        const id = d.name.split('/').pop()
        console.log(`       id=${id}`)
        console.log(`          nome   = ${campo(d, 'nome')}`)
        console.log(`          codigo = ${campo(d, 'codigo')}`)
      })
    }
  } else {
    console.log(`    => Erro ao listar condomínios: HTTP ${condos.status} — ${condos.data?.error?.message || ''}`)
    console.log('       Se for PERMISSION_DENIED: publique as regras do arquivo firestore.rules no console (Firestore → Rules → Publish).')
    console.log('       O cadastro de morador pelo código PRECISA ler a coleção "condominios".')
  }
}

linha('=')
console.log('Resumo das causas mais comuns:')
console.log('  1. Conta não existe no Authentication  -> o cadastro foi desfeito (código errado ou regras do Firestore bloqueando a consulta "condominios").')
console.log('  2. Conta existe + senha errada         -> use "Esqueci minha senha" no app.')
console.log('  3. Regras do Firestore desatualizadas  -> Firestore Database -> Rules -> cole o conteúdo de firestore.rules -> Publish.')
console.log('  4. Condomínio sem campo "codigo"       -> condomínios antigos: recrie pelo painel master ou edite o documento no console.')
linha('=')
