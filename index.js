const http = require('http');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');

const MEU_NUMERO = '5531986775326';

// Servidor HTTP exigido pela nuvem (Koyeb) para manter o robô ligado
const PORT = process.env.PORT || 8000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Robo WhatsApp Online!\n');
}).listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

async function iniciarBot() {
  const { state, saveCreds } = await useMultiFileAuthState('sessao_whatsapp');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false
  });

  sock.ev.on('creds.update', saveCreds);

  if (!sock.authState.creds.registered) {
    setTimeout(async () => {
      try {
        const codigo = await sock.requestPairingCode(MEU_NUMERO);
        console.log(`\n========================================`);
        console.log(`SEU CODIGO DE PAREAMENTO: ${codigo}`);
        console.log(`========================================\n`);
      } catch (err) {
        console.error('Erro ao gerar codigo:', err);
      }
    }, 4000);
  }

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const motivo = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (motivo !== DisconnectReason.loggedOut) {
        console.log('Reconectando...');
        iniciarBot();
      }
    } else if (connection === 'open') {
      console.log('✅ WhatsApp conectado com sucesso na nuvem!');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (msg.key.fromMe || msg.key.remoteJid.endsWith('@g.us')) continue;

      const numeroCliente = msg.key.remoteJid;
      const texto = (
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        ''
      ).trim().toLowerCase();

      if (!texto) continue;

      if (texto === 'oi' || texto === 'olá' || texto === 'ola' || texto === 'menu') {
        await sock.sendMessage(numeroCliente, {
          text: 'Olá! Bem-vindo ao nosso atendimento automático.\n\nEscolha uma opção:\n*1* - Horário de funcionamento\n*2* - Falar com um atendente'
        });
      } else if (texto === '1') {
        await sock.sendMessage(numeroCliente, {
          text: 'Nosso horário de atendimento é de segunda a sexta, das 08h às 18h.'
        });
      } else if (texto === '2') {
        await sock.sendMessage(numeroCliente, {
          text: 'Certo! Já notifiquei nossa equipe. Em instantes responderemos por aqui.'
        });
      }
    }
  });
}

iniciarBot();
