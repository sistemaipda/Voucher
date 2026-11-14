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

const estadoUsuarios = {};
const atendimentoHumano = new Map();
const idsEnviadosPeloBot = new Set();

const TEMPO_PAUSA_HUMANA_MS = 12 * 60 * 60 * 1000;

const TEXTO_MENU = `A paz do Senhor Jesus! 🙌
A *IPDA Setorial Contagem* agradece o seu contato.

Em que podemos ajudar? Digite o número da opção desejada:

1️⃣ Enviar Comprovante do Pix;
2️⃣ Chave Pix;
3️⃣ Horários dos Cultos;
4️⃣ Ofertar e/ou dizimar;
5️⃣ Contatos / Redes Sociais.`;

const TEXTO_ALGO_MAIS = `\n\n━━━━━━━━━━━━━━━\nTe ajudo em algo mais?\n\n*1* - Sim, voltar ao menu\n*2* - Não, encerrar atendimento`;

const RESPOSTAS = {
  PEDIR_COMPROVANTE:
    '📄 *Envio de Comprovante Pix*\n\nPode enviá-lo agora mesmo aqui nesta conversa (em formato de *foto* ou *PDF*). Assim que enviar, daremos continuidade! 🙌',
  CHAVE_PIX:
    `💠 *Chave Pix — IPDA Setorial Contagem*\n\n⛔ *FAVOR ENVIAR O COMPROVANTE DO PIX PARA ESTE CONTATO!* ⛔\n\n*CNPJ:* 43.208.040/0001-36\n*Recebedor:* IGREJA PENTECOSTAL DEUS É AMOR\n\n⛔ *FAVOR ENVIAR O COMPROVANTE DO PIX PARA ESTE CONTATO!* ⛔${TEXTO_ALGO_MAIS}`,
  HORARIOS:
    `⛪ *Horários dos Cultos — IPDA Setorial Contagem*\n\n🕐 *Turnos:*\n🌅 *Manhã:* 08:00h às 10:00h\n☀️ *Tarde:* 15:00h às 17:00h\n🌙 *Noite:* 19:00h às 21:15h\n\n📅 *Dias da Semana:*\n• *Segunda-feira:* Manhã, tarde e noite;\n• *Terça-feira:* Manhã, tarde e noite;\n• *Quarta-feira:* Manhã, tarde e noite;\n• *Quinta-feira:* Noite;\n• *Sexta-feira:* Manhã, tarde e noite;\n• *Domingo:* Manhã e noite.\n\nSerá uma alegria receber você e sua família! 🙌${TEXTO_ALGO_MAIS}`,
  OFERTAR:
    `💝 *Ofertar e/ou Dizimar*\n\nPara ofertar e/ou dizimar presencialmente, favor procurar o *atendente da livraria* durante os cultos ao longo da semana.\n\n💳 *Formas aceitas:* Cartão de crédito/débito, Pix e dinheiro.\n\n_"Deus ama ao que dá com alegria." (2 Coríntios 9:7)_ 🙏${TEXTO_ALGO_MAIS}`,
  CONTATOS:
    `🌐 *Contatos e Redes Sociais — IPDA Setorial Contagem*\n\nAcompanhe nossas programações, cultos ao vivo e novidades pelos nossos canais oficiais:\n\n🌍 *Site Oficial:*\nwww.ipda.sitesetorialcontagem.com.br\n\n📸 *Instagram:*\n@ipda_contagem_centro\n\n▶️ *Canal no YouTube:*\n@IPDACONTAGEMCENTRO${TEXTO_ALGO_MAIS}`,
  DESPEDIDA:
    'A *IPDA Setorial Contagem* agradece o seu contato. 🙏🌈\nQualquer outra necessidade, estamos à disposição.\n\nQue Deus abençoe sua vida! ✨'
};

async function enviarMensagemBot(sock, jid, texto) {
  const sent = await sock.sendMessage(jid, { text: texto });
  if (sent?.key?.id) {
    idsEnviadosPeloBot.add(sent.key.id);
  }
  return sent;
}

function normalizar(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function detectarIntencao(textoNormalizado) {
  if (!textoNormalizado || textoNormalizado.length < 2) return null;

  if (
    textoNormalizado.includes('comprovante') ||
    textoNormalizado.includes('recibo') ||
    textoNormalizado.includes('paguei') ||
    textoNormalizado.includes('transferi') ||
    textoNormalizado.includes('fiz o pix') ||
    textoNormalizado.includes('mandei o pix')
  ) {
    return 'COMPROVANTE';
  }

  if (
    textoNormalizado.includes('chave') ||
    textoNormalizado.includes('cnpj') ||
    textoNormalizado.includes('conta') ||
    textoNormalizado === 'pix' ||
    textoNormalizado.includes('qual o pix') ||
    textoNormalizado.includes('qual a chave')
  ) {
    return 'CHAVE_PIX';
  }

  if (
    textoNormalizado.includes('horario') ||
    textoNormalizado.includes('hora') ||
    textoNormalizado.includes('culto') ||
    textoNormalizado.includes('funciona') ||
    textoNormalizado.includes('abre') ||
    textoNormalizado.includes('domingo') ||
    textoNormalizado.includes('segunda') ||
    textoNormalizado.includes('terca') ||
    textoNormalizado.includes('quarta') ||
    textoNormalizado.includes('quinta') ||
    textoNormalizado.includes('sexta')
  ) {
    return 'HORARIOS';
  }

  if (
    textoNormalizado.includes('oferta') ||
    textoNormalizado.includes('dizim') ||
    textoNormalizado.includes('cartao') ||
    textoNormalizado.includes('livraria') ||
    textoNormalizado.includes('contribu')
  ) {
    return 'OFERTAR';
  }

  if (
    textoNormalizado.includes('site') ||
    textoNormalizado.includes('instagram') ||
    textoNormalizado.includes('insta') ||
    textoNormalizado.includes('youtube') ||
    textoNormalizado.includes('rede') ||
    textoNormalizado.includes('contato') ||
    textoNormalizado.includes('canal')
  ) {
    return 'CONTATOS';
  }

  return null;
}

async function executarAcao(sock, jid, acao) {
  if (acao === 'COMPROVANTE') {
    estadoUsuarios[jid] = 'AGUARDANDO_COMPROVANTE';
    await enviarMensagemBot(sock, jid, RESPOSTAS.PEDIR_COMPROVANTE);
    return;
  }
  estadoUsuarios[jid] = 'ALGO_MAIS';
  if (acao === 'CHAVE_PIX') return enviarMensagemBot(sock, jid, RESPOSTAS.CHAVE_PIX);
  if (acao === 'HORARIOS') return enviarMensagemBot(sock, jid, RESPOSTAS.HORARIOS);
  if (acao === 'OFERTAR') return enviarMensagemBot(sock, jid, RESPOSTAS.OFERTAR);
  if (acao === 'CONTATOS') return enviarMensagemBot(sock, jid, RESPOSTAS.CONTATOS);
}

async function processarMensagem(sock, jid, textoOriginal, enviouArquivoOuImagem) {
  const norm = normalizar(textoOriginal);
  const estadoAtual = estadoUsuarios[jid] || 'INICIO';

  // 1. Aguardando comprovante do Pix
  if (estadoAtual === 'AGUARDANDO_COMPROVANTE') {
    if (enviouArquivoOuImagem) {
      estadoUsuarios[jid] = 'ALGO_MAIS';
      await enviarMensagemBot(
        sock,
        jid,
        `✅ *Comprovante recebido com sucesso!* Nossa equipe fará a conferência.\nDeus abençoe pela sua fidelidade! 🙏${TEXTO_ALGO_MAIS}`
      );
      return;
    }

    const intencao = detectarIntencao(norm);
    if (intencao && intencao !== 'COMPROVANTE') {
      await executarAcao(sock, jid, intencao);
      return;
    }

    await enviarMensagemBot(
      sock,
      jid,
      `Desculpe, não entendi. 🤔\nAinda estou aguardando o seu *comprovante do Pix*.\n\n${RESPOSTAS.PEDIR_COMPROVANTE}`
    );
    return;
  }

  // 2. Etapa "Te ajudo em algo mais?"
  if (estadoAtual === 'ALGO_MAIS') {
    if (norm === '1' || norm === 'sim' || norm === 's') {
      estadoUsuarios[jid] = 'MENU';
      await enviarMensagemBot(sock, jid, TEXTO_MENU);
      return;
    }
    if (norm === '2' || norm === 'nao' || norm === 'n') {
      delete estadoUsuarios[jid];
      await enviarMensagemBot(sock, jid, RESPOSTAS.DESPEDIDA);
      return;
    }

    const intencao = detectarIntencao(norm);
    if (intencao) {
      await executarAcao(sock, jid, intencao);
      return;
    }

    await enviarMensagemBot(
      sock,
      jid,
      `Desculpe, não entendi sua resposta. 🤔 Por favor, responda apenas com *1* (Sim) ou *2* (Não):${TEXTO_ALGO_MAIS}`
    );
    return;
  }

  // 3. Escolha numérica no MENU (1 a 5)
  if (estadoAtual === 'MENU') {
    if (norm === '1') return executarAcao(sock, jid, 'COMPROVANTE');
    if (norm === '2') return executarAcao(sock, jid, 'CHAVE_PIX');
    if (norm === '3') return executarAcao(sock, jid, 'HORARIOS');
    if (norm === '4') return executarAcao(sock, jid, 'OFERTAR');
    if (norm === '5') return executarAcao(sock, jid, 'CONTATOS');
  }

  // 4. Detecção de dúvida por palavra-chave em qualquer momento da conversa
  const intencaoDireta = detectarIntencao(norm);
  if (intencaoDireta) {
    await executarAcao(sock, jid, intencaoDireta);
    return;
  }

  // 5. Se já estava no MENU e mandou "." ou opção inválida, não reinicia: avisa e repete o menu
  if (estadoAtual === 'MENU') {
    await enviarMensagemBot(
      sock,
      jid,
      `Desculpe, não entendi o que você digitou. 🤔\nPor favor, digite apenas o *número* de *1* a *5*:\n\n${TEXTO_MENU}`
    );
    return;
  }

  // 6. Primeiro contato: envia a mensagem de boas-vindas com o menu
  estadoUsuarios[jid] = 'MENU';
  await enviarMensagemBot(sock, jid, TEXTO_MENU);
}

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
      const jid = msg.key.remoteJid;
      if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') continue;

      if (msg.key.fromMe) {
        if (!idsEnviadosPeloBot.has(msg.key.id)) {
          atendimentoHumano.set(jid, Date.now());
          delete estadoUsuarios[jid];
        }
        continue;
      }

      const ultimaIntervencaoHumana = atendimentoHumano.get(jid);
      if (ultimaIntervencaoHumana && Date.now() - ultimaIntervencaoHumana < TEMPO_PAUSA_HUMANA_MS) {
        continue;
      }

      const textoOriginal = (
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        ''
      ).trim();

      const enviouArquivoOuImagem = Boolean(
        msg.message?.imageMessage ||
        msg.message?.documentMessage ||
        msg.message?.documentWithCaptionMessage
      );

      if (!textoOriginal && !enviouArquivoOuImagem) continue;

      await processarMensagem(sock, jid, textoOriginal, enviouArquivoOuImagem);
    }
  });
}

iniciarBot();
