const express = require('express');
const cors = require('cors');
require('dotenv').config();

console.log('🧪 Verificando token do Mercado Pago...');
if (!process.env.MP_ACCESS_TOKEN) {
  console.error('❌ ERRO: Token do Mercado Pago não encontrado no .env!');
  process.exit(1); // Encerra a aplicação se o token não for encontrado
} else {
  console.log('✅ Token carregado com sucesso!');
}

const { MercadoPagoConfig, Payment } = require('mercadopago');
const app = express();

// Configurações de CORS (ajuste em produção para domínios específicos)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Middleware para parsing de JSON
app.use(express.json());

// Servir arquivos estáticos da pasta 'public'
app.use(express.static('public'));

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN
});

const paymentClient = new Payment(client);

// Armazena o status dos pagamentos e seus order_ids.
// EM PRODUÇÃO, ISSO DEVE SER UM BANCO DE DADOS PERSISTENTE!
const paymentStatuses = {}; // paymentId: { status: 'pending', orderId: '...', createdAt: Date }

app.post('/criar-pagamento', async (req, res) => {
  try {
    const valor = parseFloat(req.body.valor);
    const orderId = req.body.order_id; // Recebe o ID do pedido do frontend

    if (!valor || valor <= 0) {
      return res.status(400).json({ erro: 'Valor inválido' });
    }
    if (!orderId) {
      return res.status(400).json({ erro: 'ID do pedido é obrigatório' });
    }

    // Calcula a data de expiração para 7 minutos a partir de agora
    const expirationDate = new Date();
    expirationDate.setMinutes(expirationDate.getMinutes() + 7);
    const dateOfExpirationISO = expirationDate.toISOString().slice(0, -5) + '-03:00'; // Formato ISO 8601 com offset de BRT

    const response = await paymentClient.create({
      body: {
        transaction_amount: valor,
        description: `Pagamento do Pedido ${orderId} via Pix`,
        payment_method_id: 'pix',
        payer: {
          email: 'teste@email.com', // Substitua pelo email real do pagador em produção
          first_name: 'Fulano',
          last_name: 'da Silva'
        },
        // Configura o tempo de expiração do QR Code Pix
        date_of_expiration: dateOfExpirationISO,
        // notification_url: 'SUA_URL_DO_WEBHOOK/webhook' // Em produção, configure isso com sua URL pública
      }
    });

    const qrData = response.point_of_interaction.transaction_data;
    const paymentId = response.id; // ID do pagamento do Mercado Pago

    // Inicializa o status do pagamento como pendente, associado ao orderId
    paymentStatuses[paymentId] = {
      status: 'pending',
      orderId: orderId,
      createdAt: Date.now()
    };
    console.log(`Pagamento ${paymentId} para Pedido ${orderId} criado. Status inicial: ${paymentStatuses[paymentId].status}`);

    return res.json({
      qr_code_base64: qrData.qr_code_base64,
      qr_code: qrData.qr_code,
      payment_id: paymentId, // Retorna o ID do pagamento para o frontend
      expires_at: expirationDate.getTime() // Retorna timestamp de expiração para o frontend
    });

  } catch (error) {
    console.error('Erro ao criar pagamento:', error);
    res.status(500).json({ erro: 'Erro ao criar pagamento', detalhes: error.message });
  }
});

// Endpoint para receber webhooks do Mercado Pago
app.post('/webhook', async (req, res) => {
  console.log('Webhook recebido:', req.body);

  if (req.body.type === 'payment' && req.body.data && req.body.data.id) {
    const paymentId = req.body.data.id;
    console.log(`Recebido webhook para Payment ID: ${paymentId}`);

    try {
      const paymentDetails = await paymentClient.get({ id: paymentId });
      console.log(`Detalhes do pagamento ${paymentId}:`, paymentDetails.status);

      if (paymentStatuses[paymentId]) { // Garante que o pagamento existe em memória
        if (paymentDetails.status === 'approved') {
          paymentStatuses[paymentId].status = 'approved';
          console.log(`Pagamento ${paymentId} APROVADO! (Pedido: ${paymentStatuses[paymentId].orderId})`);
          // **** AQUI VOCÊ ATUALIZARIA O STATUS DO PEDIDO NO SEU BANCO DE DADOS PERSISTENTE ****
          // Ex: updateOrderStatusInDB(paymentStatuses[paymentId].orderId, 'approved');
        } else if (paymentDetails.status === 'rejected' || paymentDetails.status === 'cancelled') {
          paymentStatuses[paymentId].status = paymentDetails.status;
          console.log(`Pagamento ${paymentId} ${paymentDetails.status.toUpperCase()}! (Pedido: ${paymentStatuses[paymentId].orderId})`);
          // Ex: updateOrderStatusInDB(paymentStatuses[paymentId].orderId, paymentDetails.status);
        } else {
          // Para outros status intermediários, mantemos como pendente ou similar
          paymentStatuses[paymentId].status = 'pending';
          console.log(`Pagamento ${paymentId} ainda PENDENTE ou outro status: ${paymentDetails.status}`);
        }
      } else {
        console.warn(`Webhook para Payment ID ${paymentId} recebido, mas não encontrado em paymentStatuses.`);
      }
    } catch (error) {
      console.error(`Erro ao buscar detalhes do pagamento ${paymentId}:`, error);
      // Se houver erro ao buscar detalhes, mantenha o status anterior ou trate o erro
    }
  }
  res.status(200).send('Webhook recebido e processado');
});

// Endpoint para o frontend verificar o status do pagamento
app.get('/check-payment-status/:paymentId', (req, res) => {
  const paymentId = req.params.paymentId;
  const statusInfo = paymentStatuses[paymentId];

  if (!statusInfo) {
    return res.json({ status: 'not_found' });
  }

  // Verificar se o Pix expirou (considerando o timer local do frontend, mas a validade real é do MP)
  const isExpired = Date.now() > (statusInfo.createdAt + 7 * 60 * 1000) && statusInfo.status === 'pending';

  if (isExpired) {
    // Se o backend detecta que expirou e ainda está pendente, marca como expirado localmente
    statusInfo.status = 'expired';
    console.log(`Pagamento ${paymentId} expirado (detectado pelo backend).`);
  }

  console.log(`Consulta de status para Payment ID ${paymentId}: ${statusInfo.status}`);
  res.json({ status: statusInfo.status, order_id: statusInfo.orderId });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
  // Em produção no Vercel, a URL pública será gerada automaticamente
  console.log(`❗ Lembre-se de configurar seu webhook do Mercado Pago para: SUA_URL_PUBLICA_DO_VERCEL/webhook`);
});