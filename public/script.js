let currentPaymentId = null;
let paymentCheckInterval = null;
let countdownInterval = null;
let paymentExpiresAt = null;
let currentOrderId = null; // Para armazenar o ID do pedido

// Função para obter parâmetros da URL
function getUrlParameter(name) {
    name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
    var regex = new RegExp('[\\?&]' + name + '=([^&#]*)');
    var results = regex.exec(location.search);
    return results === null ? '' : decodeURIComponent(results[1].replace(/\+/g, ' '));
}

// Inicializa a página de pagamento Pix
document.addEventListener('DOMContentLoaded', () => {
    // Pega os dados do QR Code e do pagamento da URL
    const qrCodeBase64 = getUrlParameter('qr_base64');
    const qrCodeText = getUrlParameter('qr_code');
    const paymentId = getUrlParameter('payment_id');
    const expiresAt = parseInt(getUrlParameter('expires_at'));
    const orderId = getUrlParameter('order_id');

    if (qrCodeBase64 && qrCodeText && paymentId && !isNaN(expiresAt) && orderId) {
        currentPaymentId = paymentId;
        paymentExpiresAt = expiresAt;
        currentOrderId = orderId;

        document.getElementById('qr-code-img').src = `data:image/png;base64,${qrCodeBase64}`;
        document.getElementById('pix-copy-code').value = qrCodeText;
        document.getElementById('current-order-id-display').innerText = orderId; // Exibe o ID do pedido
        
        startCountdownTimer(); // Inicia o timer
        document.getElementById('payment-status-message').innerHTML = '<p>QR Code gerado! Você tem 7 minutos para pagar.</p>';

        // Adiciona listeners aos botões
        document.getElementById('check-payment-btn').addEventListener('click', checkPaymentStatus);
        document.getElementById('generate-new-qr-btn').addEventListener('click', () => {
            // Redireciona para a página principal para gerar um novo QR
            window.location.href = '/'; // Ou para a página de geração de Pix se for separada
        });

        // Esconde o botão de gerar novo QR inicialmente
        document.getElementById('generate-new-qr-btn').style.display = 'none';

    } else {
        document.getElementById('payment-area').innerHTML = '<p style="color: red;">Erro: Dados de pagamento não encontrados. Volte para o carrinho e tente novamente.</p>';
        document.getElementById('check-payment-btn').style.display = 'none';
        document.getElementById('generate-new-qr-btn').style.display = 'block'; // Permite gerar novo
    }
});

function startCountdownTimer() {
  if (countdownInterval) clearInterval(countdownInterval);

  const timerDisplay = document.getElementById('timer-display');
  
  countdownInterval = setInterval(() => {
    const now = Date.now();
    const timeLeft = paymentExpiresAt - now;

    if (timeLeft <= 0) {
      clearInterval(countdownInterval);
      if (paymentCheckInterval) clearInterval(paymentCheckInterval);
      timerDisplay.innerHTML = '<p style="color: red; font-weight: bold;">❌ Pix Expirado! Por favor, gere um novo QR Code.</p>';
      document.getElementById('check-payment-btn').style.display = 'none';
      document.getElementById('generate-new-qr-btn').style.display = 'block';
      document.getElementById('payment-status-message').innerHTML = '';
      currentPaymentId = null;
      paymentExpiresAt = null;
      return;
    }

    const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);

    timerDisplay.innerHTML = `<p style="color: purple;">Tempo restante para pagar: ${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}</p>`;
  }, 1000);
}

async function checkPaymentStatus() {
  if (!currentPaymentId) {
    alert('Nenhum pagamento ativo para verificar. Gere um novo QR Code.');
    return;
  }

  const statusMessageDiv = document.getElementById('payment-status-message');
  statusMessageDiv.innerHTML = '<p style="color: blue;">Verificando status do pagamento...</p>';
  document.getElementById('check-payment-btn').disabled = true;

  let retries = 0;
  const maxRetries = 15; // Tenta verificar por até 45 segundos (15 * 3s)
  const intervalTime = 3000; // A cada 3 segundos

  if (paymentCheckInterval) clearInterval(paymentCheckInterval);

  paymentCheckInterval = setInterval(async () => {
    if (retries >= maxRetries) {
      clearInterval(paymentCheckInterval);
      statusMessageDiv.innerHTML = '<p style="color: orange;">Não foi possível confirmar o pagamento automaticamente. Verifique seu extrato e o status do pedido na sua conta.</p>';
      document.getElementById('check-payment-btn').disabled = false;
      document.getElementById('generate-new-qr-btn').style.display = 'block';
      return;
    }

    try {
      const resposta = await fetch(`/check-payment-status/${currentPaymentId}`);
      const dados = await resposta.json();

      if (dados.status === 'approved') {
        clearInterval(paymentCheckInterval);
        if (countdownInterval) clearInterval(countdownInterval);
        statusMessageDiv.innerHTML = '<p style="color: green; font-weight: bold;">✅ Pagamento Aprovado! Redirecionando para Meus Pedidos...</p>';
        document.getElementById('check-payment-btn').style.display = 'none';
        document.getElementById('generate-new-qr-btn').style.display = 'none';
        
        setTimeout(() => {
          // Redireciona para a página de sucesso do pagamento
          window.location.href = `/pix-payment-success.html?order_id=${currentOrderId}`;
        }, 2000);
      } else if (dados.status === 'pending') {
        statusMessageDiv.innerHTML = `<p style="color: blue;">Aguardando confirmação do pagamento... Tentativas: ${retries + 1}/${maxRetries}</p>`;
      } else if (dados.status === 'rejected' || dados.status === 'cancelled') {
        clearInterval(paymentCheckInterval);
        if (countdownInterval) clearInterval(countdownInterval);
        statusMessageDiv.innerHTML = `<p style="color: red; font-weight: bold;">❌ Ops! Seu pagamento foi ${dados.status}. Por favor, gere um novo QR Code.</p>`;
        document.getElementById('check-payment-btn').disabled = false;
        document.getElementById('generate-new-qr-btn').style.display = 'block';
      } else if (dados.status === 'expired') {
        clearInterval(paymentCheckInterval);
        if (countdownInterval) clearInterval(countdownInterval);
        statusMessageDiv.innerHTML = '<p style="color: red; font-weight: bold;">❌ O tempo para pagar o Pix expirou. Por favor, gere um novo QR Code.</p>';
        document.getElementById('check-payment-btn').style.display = 'none';
        document.getElementById('generate-new-qr-btn').style.display = 'block';
        currentPaymentId = null;
      } else {
        statusMessageDiv.innerHTML = `<p style="color: orange;">Status desconhecido ou erro na verificação. Tentativas: ${retries + 1}/${maxRetries}</p>`;
      }
    } catch (error) {
      console.error('Erro ao verificar status do pagamento:', error);
      statusMessageDiv.innerHTML = `<p style="color: red;">Erro na verificação do pagamento. Tentativas: ${retries + 1}/${maxRetries}</p>`;
    }
    retries++;
  }, intervalTime);
}