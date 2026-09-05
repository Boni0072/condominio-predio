// Helpers de imagem: captura de foto (câmera/seletor de arquivos) e compressão para o localStorage

// Lê o arquivo de imagem, redimensiona para no máximo `maxLado` px no maior lado
// e devolve um data URL JPEG comprimido (economiza espaço no localStorage).
export function arquivoParaDataUrl(arquivo, maxLado = 800, qualidade = 0.7) {
  return new Promise((resolve, reject) => {
    if (!arquivo || !String(arquivo.type || '').startsWith('image/')) {
      reject(new Error('Arquivo não é uma imagem'))
      return
    }

    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Não foi possível carregar a imagem'))
      img.onload = () => {
        const escala = Math.min(1, maxLado / Math.max(img.width, img.height))
        const largura = Math.max(1, Math.round(img.width * escala))
        const altura = Math.max(1, Math.round(img.height * escala))

        const canvas = document.createElement('canvas')
        canvas.width = largura
        canvas.height = altura
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, largura, altura)
        resolve(canvas.toDataURL('image/jpeg', qualidade))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(arquivo)
  })
}
