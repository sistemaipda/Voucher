const http = require('http');
const fs = require('fs');
const url = require('url');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');

let statusAtual = 'Aguardando número para gerar código...';
let codigoPareamento = '';
let sockAtual = null;

const PORT = process.env.PORT || 10000;
http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);

  if (parsed.pathname === '/gerar' && parsed.query.num) {
    const numeroLimpo = parsed.query.num.replace(/\D/g, '');
    if (sockAtual && !sockAtual.authState.creds.registered) {
      try {
        codigoPareamento = await sockAtual.requestPairingCode(numeroLimpo);
        statusAtual = `Código gerado para ${numeroLimpo}`;
      } catch (e) {
        statusAtual = 'Erro ao gerar. Toque em Limpar Sessão e tente de novo.';
      }
    }
    res.writeHead(302, { Location: '/' });
    res.end();
    return;
  }

  if (parsed.pathname === '/reset') {
    fs.rmSync('sessao_whatsapp', { recursive: true, force: true });
    codigoPareamento = '';
    statusAtual = 'Reiniciando...';
    res.writeHead(302, { Location: '/' });
    res.end();
    process.exit(0);
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`
    <meta name="viewport" content="width=device-width, initial-scale=1">
    ${codigoPareamento ? '<meta http-equiv="refresh" content="5">' : ''}
    <body style="font-family:sans-serif;text-align:center;padding:25px">
      <h3>Status: ${statusAtual}</h3>
      ${codigoPareamento ? `
        <p>Digite no WhatsApp agora:</p>
        <h1 style="font-size:34px;letter-spacing:4px;background:#eee;padding:15px">${codigoPareamento}</h1>
      ` : `
        <form action="/gerar" method="get" style="margin:20px 0">
          <p>Escolha o formato do número:</p>
          <button name="num" value="553186775326" style="padding:12px 20px;font-size:16px;background:#25D366;color:#fff;border:none;border-radius:5px;margin:5px">1º Teste: SEM o 9 (553186775326)</button><br>
          <button name="num" value="5531986775326" style="padding:12px 20px;font-size:16px;background:#128C7E;color:#fff;border:none;border-radius:5px;margin:5px">2º Teste: COM o 9 (5531986775326)</button>
        </form>
      `}
      <br><a href="/reset" style="padding:10px 18px;background:#d9534f;color:#fff;text-decoration:none;border-radius:5px">Limpar Sessão</a>
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

  sockAtual = sock;
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const motivo = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (motivo === DisconnectReason.loggedOut) {
        fs.rmSync('sessao_whatsapp', { recursive: true, force: true });
        codigoPareamento = '';
        statusAtual = 'Desconectado.';
      }
      setTimeout(iniciarBot, 3000);
    } else if (connection === 'open') {
      codigoPareamento = '';
      statusAtual = '✅ WhatsApp Conectado!';
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


iniciarBot();
