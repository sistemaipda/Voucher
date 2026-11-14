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

let statusAtual = 'Gerando QR Code...';
let qrAtual = '';

// Guarda em qual etapa da conversa cada pessoa está
// Estados possíveis: 'MENU', 'AGUARDANDO_COMPROVANTE', 'ALGO_MAIS'
const estadoUsuarios = {};

const TEXTO_MENU = `A paz do Senhor Jesus! 🙌
A *IPDA Setorial Contagem* agradece o seu contato.

Em que podemos ajudar? Digite o número da opção desejada:

1️⃣ Enviar Comprovante do Pix;
2️⃣ Chave Pix;
3️⃣ Horários dos Cultos;
4️⃣ Ofertar e/ou dizimar;
5️⃣ Contatos / Redes Sociais.`;

const TEXTO_ALGO_MAIS = `\n\n━━━━━━━━━━━━━━━\nTe ajudo em algo mais?\n\n*1* - Sim, voltar ao menu\n*2* - Não, encerrar atendimento`;

const TEXTO_DESPEDIDA = `A *IPDA Setorial Contagem* agradece o seu contato. 🙏🌈
Qualquer outra necessidade, estamos à disposição.

Que Deus abençoe sua vida! ✨`;

const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
  if (req.url === '/reset') {
    fs.rmSync('sessao_whatsapp', { recursive: true, force: true });
    qrAtual = '';
    statusAtual = 'Reiniciando...';
    res.writeHead(302, { Location: '/' });
    res.end();
    process.exit(0);
    return;
  }

  const qrImgUrl = qrAtual
    ? `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(qrAtual)}`
    : '';

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="refresh" content="8">
    <body style="font-family:sans-serif;text-align:center;padding:20px">
      <h3>Status: ${statusAtual}</h3>
      ${qrImgUrl ? `<p>Escaneie este QR Code no WhatsApp:</p><img src="${qrImgUrl}" style="border:10px solid #fff;box-shadow:0 0 10px rgba(0,0,0,0.2)">` : ''}
      <br><br><a href="/reset" style="padding:10px 18px;background:#d9534f;color:#fff;text-decoration:none;border-radius:5px">Reiniciar</a>
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

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      qrAtual = qr;
      statusAtual = 'Aguardando leitura do QR Code...';
    }
    if (connection === 'close') {
      const motivo = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (motivo === DisconnectReason.loggedOut) {
        fs.rmSync('sessao_whatsapp', { recursive: true, force: true });
        qrAtual = '';
        statusAtual = 'Desconectado.';
      }
      setTimeout(iniciarBot, 3000);
    } else if (connection === 'open') {
      qrAtual = '';
      statusAtual = '✅ WhatsApp Conectado!';
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe || msg.key.remoteJid.endsWith('@g.us') || msg.key.remoteJid === 'status@broadcast') continue;

      const jid = msg.key.remoteJid;
      const textoOriginal = (
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        ''
      ).trim();
      const texto = textoOriginal.toLowerCase();

      const enviouArquivoOuImagem = Boolean(
        msg.message?.imageMessage ||
        msg.message?.documentMessage ||
        msg.message?.documentWithCaptionMessage
      );

      const estadoAtual = estadoUsuarios[jid] || 'INICIO';

      // 1. Se a pessoa estava na etapa "Te ajudo em algo mais?"
      if (estadoAtual === 'ALGO_MAIS') {
        if (texto === '1' || texto === 'sim' || texto === 's') {
          estadoUsuarios[jid] = 'MENU';
          await sock.sendMessage(jid, { text: TEXTO_MENU });
          continue;
        } else if (texto === '2' || texto === 'não' || texto === 'nao' || texto === 'n') {
          delete estadoUsuarios[jid];
          await sock.sendMessage(jid, { text: TEXTO_DESPEDIDA });
          continue;
        }
      }

      // 2. Se a pessoa escolheu a Opção 1 e acabou de enviar o comprovante (foto, PDF ou texto)
      if (estadoAtual === 'AGUARDANDO_COMPROVANTE') {
        if (enviouArquivoOuImagem || texto.length > 0) {
          estadoUsuarios[jid] = 'ALGO_MAIS';
          await sock.sendMessage(jid, {
            text: `✅ *Comprovante recebido com sucesso!* Nossa equipe fará a conferência.\nDeus abençoe pela sua fidelidade! 🙏${TEXTO_ALGO_MAIS}`
          });
          continue;
        }
      }

      // 3. Se a pessoa está no MENU principal escolhendo uma das 5 opções
      if (estadoAtual === 'MENU') {
        if (texto === '1' || texto === '1️⃣') {
          estadoUsuarios[jid] = 'AGUARDANDO_COMPROVANTE';
          await sock.sendMessage(jid, {
            text: `📄 *Envio de Comprovante Pix*\n\nPode enviá-lo agora mesmo aqui nesta conversa (em formato de *foto* ou *PDF*). Assim que enviar, daremos continuidade! 🙌`
          });
          continue;
        }

        if (texto === '2' || texto === '2️⃣') {
          estadoUsuarios[jid] = 'ALGO_MAIS';
          await sock.sendMessage(jid, {
            text: `💠 *Chave Pix — IPDA Setorial Contagem*\n\n⛔ *FAVOR ENVIAR O COMPROVANTE DO PIX PARA ESTE CONTATO!* ⛔\n\n*CNPJ:* 43.208.040/0001-36\n*Recebedor:* IGREJA PENTECOSTAL DEUS É AMOR\n\n⛔ *FAVOR ENVIAR O COMPROVANTE DO PIX PARA ESTE CONTATO!* ⛔${TEXTO_ALGO_MAIS}`
          });
          continue;
        }

        if (texto === '3' || texto === '3️⃣') {
          estadoUsuarios[jid] = 'ALGO_MAIS';
          await sock.sendMessage(jid, {
            text: `⛪ *Horários dos Cultos — IPDA Setorial Contagem*\n\n🕐 *Turnos:*\n🌅 *Manhã:* 08:00h às 10:00h\n☀️ *Tarde:* 15:00h às 17:00h\n🌙 *Noite:* 19:00h às 21:15h\n\n📅 *Dias da Semana:*\n• *Segunda-feira:* Manhã, tarde e noite;\n• *Terça-feira:* Manhã, tarde e noite;\n• *Quarta-feira:* Manhã, tarde e noite;\n• *Quinta-feira:* Noite;\n• *Sexta-feira:* Manhã, tarde e noite;\n• *Domingo:* Manhã e noite.\n\nSerá uma alegria receber você e sua família! 🙌${TEXTO_ALGO_MAIS}`
          });
          continue;
        }

        if (texto === '4' || texto === '4️⃣') {
          estadoUsuarios[jid] = 'ALGO_MAIS';
          await sock.sendMessage(jid, {
            text: `💝 *Ofertar e/ou Dizimar*\n\nPara ofertar e/ou dizimar presencialmente, favor procurar o *atendente da livraria* durante os cultos ao longo da semana.\n\n💳 *Formas aceitas:* Cartão de crédito/débito, Pix e dinheiro.\n\n_"Deus ama ao que dá com alegria." (2 Coríntios 9:7)_ 🙏${TEXTO_ALGO_MAIS}`
          });
          continue;
        }

        if (texto === '5' || texto === '5️⃣') {
          estadoUsuarios[jid] = 'ALGO_MAIS';
          await sock.sendMessage(jid, {
            text: `🌐 *Contatos e Redes Sociais — IPDA Setorial Contagem*\n\nAcompanhe nossas programações, cultos ao vivo e novidades pelos nossos canais oficiais:\n\n🌍 *Site Oficial:*\nwww.ipda.sitesetorialcontagem.com.br\n\n📸 *Instagram:*\n@ipda_contagem_centro\n\n▶️ *Canal no YouTube:*\n@IPDACONTAGEMCENTRO${TEXTO_ALGO_MAIS}`
          });
          continue;
        }

        // Se digitou algo inválido enquanto estava no menu
        await sock.sendMessage(jid, {
          text: `Por favor, digite apenas o *número* de uma das opções abaixo (de *1* a *5*):\n\n${TEXTO_MENU}`
        });
        continue;
      }

      // 4. Primeiro contato da pessoa (qualquer mensagem inicial envia o menu)
      estadoUsuarios[jid] = 'MENU';
      await sock.sendMessage(jid, { text: TEXTO_MENU });
    }
  });
}

iniciarBot();
