const http = require('http');
const fs = require('fs');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');

const MEU_NUMERO = '5531986775326';
let statusAtual = 'Iniciando...';
let codigoPareamento = '';

const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
  if (req.url === '/reset') {
    fs.rmSync('sessao_whatsapp', { recursive: true, force: true });
    codigoPareamento = '';
    statusAtual = 'Reiniciando sessao...';
    res.writeHead(302, { Location: '/' });
    res.end();
    process.exit(0);
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="refresh" content="5">
    <body style="font-family:sans-serif;text-align:center;padding:30px">
      <h2>Status: ${statusAtual}</h2>
      ${codigoPareamento ? `<p>Digite no WhatsApp:</p><h1 style="font-size:36px;letter-spacing:4px;background:#eee;padding:15px">${codigoPareamento}</h1>` : ''}
      <br><a href="/reset" style="padding:10px 20px;background:#d9534f;color:#fff;text-decoration:none;border-radius:5px">Gerar Novo Código</a>
    </body>
  `);
}).listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));

async function iniciarBot() {
  const { state, saveCreds } = await useMultiFileAuthState('sessao_whatsapp');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    browser: Browsers.macOS('Desktop'),
    printQRInTerminal: false
  });

  sock.ev.on('creds.update', saveCreds);

  if (!sock.authState.creds.registered && !codigoPareamento) {
    setTimeout(async () => {
      try {
        const codigo = await sock.requestPairingCode(MEU_NUMERO);
        codigoPareamento = codigo;
        statusAtual = 'Aguardando digitar o código no WhatsApp';
        console.log(`SEU CODIGO DE PAREAMENTO: ${codigo}`);
      } catch (err) {
        statusAtual = 'Erro ao gerar código. Toque em Gerar Novo Código.';
      }
    }, 3000);
  }

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const motivo = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (motivo === DisconnectReason.loggedOut) {
        fs.rmSync('sessao_whatsapp', { recursive: true, force: true });
        codigoPareamento = '';
        statusAtual = 'Desconectado. Gerando novo código...';
      }
      setTimeout(iniciarBot, 3000);
    } else if (connection === 'open') {
      codigoPareamento = '';
      statusAtual = '✅ WhatsApp Conectado!';
      console.log('WhatsApp conectado com sucesso!');
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
