// Script de migração: copia todos os dados da coleção 'condominios' para 'tenants'
// (preserva os dados originais — NÃO apaga nada).
//
// Como usar:
//   1. Instale o SDK:        npm install firebase-admin
//   2. Crie uma conta de serviço no Firebase:
//      Console Firebase -> Configurações do projeto -> Contas de serviço
//      -> Gerar nova chave privada (baixa um JSON)
//   3. Salve o JSON como 'serviceAccountKey.json' na raiz deste projeto
//   4. Execute:              node migracao-condominios.mjs

import admin from 'firebase-admin'
import { createRequire } from 'module'
import fs from 'fs'

const require = createRequire(import.meta.url)

if (!fs.existsSync('./serviceAccountKey.json')) {
  console.error('❌ Falta o arquivo serviceAccountKey.json na raiz do projeto (veja instruções no topo do script).')
  process.exit(1)
}

const serviceAccount = require('./serviceAccountKey.json')

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
})

const db = admin.firestore()

// Subcoleções que existem dentro de cada condomínio/tenant
const SUBCOLLECTIONS = [
  'moradores',
  'visitantes',
  'encomendas',
  'comunicados',
  'despesas',
  'orcamentos',
  'assembleias',
  'votacoes',
  'votos',
  'users'
]

async function copiarSubcolecoes(origem, destino) {
  let total = 0
  for (const nome of SUBCOLLECTIONS) {
    const snap = await origem.collection(nome).get()
    if (snap.empty) continue
    await Promise.all(
      snap.docs.map((doc) => destino.collection(nome).doc(doc.id).set(doc.data(), { merge: true }))
    )
    total += snap.size
    console.log(`   • ${nome}: ${snap.size} documento(s) copiado(s)`)
  }
  return total
}

async function migrar() {
  console.log('🔍 Lendo condomínios antigos (coleção condominios)...\n')

  const snapshot = await db.collection('condominios').get()
  if (snapshot.empty) {
    console.log('ℹ️  Nenhum documento em condominios. Nada para migrar.')
    process.exit(0)
  }

  const totalDocs = snapshot.size
  let totalSub = 0

  for (const doc of snapshot.docs) {
    const id = doc.id
    const dados = doc.data()
    console.log(`📦 Condomínio: ${dados.nome || id} (${id})`)

    // Copia o documento raiz
    await db.collection('tenants').doc(id).set({ ...dados, migradoEm: admin.firestore.FieldValue.serverTimestamp() })
    console.log(`   • documento raiz copiado para tenants/${id}`)

    // Copia todas as subcoleções
    totalSub += await copiarSubcolecoes(doc.ref, db.collection('tenants').doc(id))
  }

  console.log(`\n✅ Migração concluída!`)
  console.log(`   Condomínios: ${totalDocs}`)
  console.log(`   Subdocumentos copiados: ${totalSub}`)
  console.log(`\nℹ️  Os dados originais em 'condominios' foram PRESERVADOS.`)
  console.log(`   Se tudo estiver correto, você pode excluir a coleção antiga manualmente no console do Firebase.`)
}

migrar().catch((err) => {
  console.error('❌ Erro na migração:', err.message || err)
  process.exit(1)
})