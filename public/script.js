async function gerarPagamento() {
  const valor = parseFloat(document.getElementById('valor').value);
  if (isNaN(valor) || valor <= 0) {
    alert('Digite um valor válido');
    return;
  }

  const resposta = await fetch('/criar-pagamento', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ valor })
  });

  const dados = await resposta.json();

  if (dados.qr_code_base64) {
    document.getElementById('qrcode').innerHTML = `
      <h3>Escaneie com o app do banco:</h3>
      <img src="data:image/png;base64,${dados.qr_code_base64}" />
      <p>Código copia e cola:</p>
      <textarea readonly>${dados.qr_code}</textarea>
    `;
  } else {
    alert('Erro ao gerar pagamento');
  }
}
