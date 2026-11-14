const http = require('http');
const fs = require('fs');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  decryptPollVote,
  getAggregateVotesInPollMessage
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');

let statusAtual = 'Gerando QR Code...';
let qrAtual = '';

const estadoUsuarios = {};
const mensagensEnquete = new Map();

const OPCOES_MENU = [
  '1️⃣ Enviar Comprovante do Pix',
  '2️⃣ Chave Pix',
  '3️⃣ Horários dos Cultos',
  '4️⃣ Ofertar e/ou dizimar',
  '5️⃣ Contatos / Redes Sociais'
];

const OPCOES_ALGO_MAIS = [
  '✅ Sim, voltar ao menu',
  '❌ Não, encerrar atendimento'
];

const RESPOSTAS = {
  PEDIR_COMPROVANTE:
    '📄 *Envio de Comprovante Pix*\n\nPode enviá-lo agora mesmo aqui nesta conversa (em formato de *foto* ou *PDF*). Assim que enviar, daremos continuidade! 🙌',
  CHAVE_PIX:
    '💠 *Chave Pix — IPDA Setorial Contagem*\n\n⛔ *FAVOR ENVIAR O COMPROVANTE DO PIX PARA ESTE CONTATO!* ⛔\n\n*CNPJ:* 43.208.040/0001-36\n*Recebedor:* IGREJA PENTECOSTAL DEUS É AMOR\n\n⛔ *FAVOR ENVIAR O COMPROVANTE DO PIX PARA ESTE CONTATO!* ⛔',
  HORARIOS:
    '⛪ *Horários dos Cultos — IPDA Setorial Contagem*\n\n🕐 *Turnos:*\n🌅 *Manhã:* 08:00h às 10:00h\n☀️ *Tarde:* 15:00h às 17:00h\n🌙 *Noite:* 19:00h às 21:15h\n\n📅 *Dias da Semana:*\n• *Segunda-feira:* Manhã, tarde e noite;\n• *Terça-feira:* Manhã, tarde e noite;\n• *Quarta-feira:* Manhã, tarde e noite;\n• *Quinta-feira:* Noite;\n• *Sexta-feira:* Manhã, tarde e noite;\n• *Domingo:* Manhã e noite.\n\nSerá uma alegria receber você e sua família! 🙌',
  OFERTAR:
    '💝 *Ofertar e/ou Dizimar*\n\nPara ofertar e/ou dizimar presencialmente, favor procurar o *atendente da livraria* durante os cultos ao longo da semana.\n\n💳 *Formas aceitas:* Cartão de crédito/débito, Pix e dinheiro.\n\n_"Deus ama ao que dá com alegria." (2 Coríntios 9:7)_ 🙏',
  CONTATOS:
    '🌐 *Contatos e Redes Sociais — IPDA Setorial Contagem*\n\nAcompanhe nossas programações, cultos ao vivo e novidades pelos nossos canais oficiais:\n\n🌍 *Site Oficial:*\nwww.ipda.sitesetorialcontagem.com.br\n\n📸 *Instagram:*\n@ipda_contagem_centro\n\n▶️ *Canal no YouTube:*\n@IPDACONTAGEMCENTRO',
  DESPEDIDA:
    'A *IPDA Setorial Contagem* agradece o seu contato. 🙏🌈\nQualquer outra necessidade, estamos à disposição.\n\nQue Deus abençoe sua vida! ✨'
};

// Normaliza acentos para facilitar o reconhecimento de perguntas naturais
function normalizar(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

// Identifica se a mensagem faz uma pergunta/menção direta a algum assunto
function detectarIntencao(textoNormalizado) {
  if (!textoNormalizado || textoNormalizado.length < 2) return null;

  // 1. Enviar comprovante
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

  // 2. Chave Pix / CNPJ
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

  // 3. Horários e dias de culto
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

  // 4. Ofertar / Dizimar / Cartão / Livraria
  if (
    textoNormalizado.includes('oferta') ||
    textoNormalizado.includes('dizim') ||
    textoNormalizado.includes('cartao') ||
    textoNormalizado.includes('livraria') ||
    textoNormalizado.includes('contribu')
  ) {
    return 'OFERTAR';
  }

  // 5. Contatos / Site / Redes sociais
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

async function enviarMenu(sock, jid) {
  estadoUsuarios[jid] = 'MENU';
  const sent = await sock.sendMessage(jid, {
    poll: {
      name: 'A paz do Senhor Jesus! 🙌\nA IPDA Setorial Contagem agradece o seu contato.\n\nToque na opção desejada:',
      values: OPCOES_MENU,
      selectableCount: 1
    }
  });
  if (sent?.key?.id) mensagensEnquete.set(sent.key.id, sent);
}

async function enviarAlgoMais(sock, jid) {
  estadoUsuarios[jid] = 'ALGO_MAIS';
  const sent = await sock.sendMessage(jid, {
    poll: {
      name: 'Te ajudo em algo mais?',
      values: OPCOES_ALGO_MAIS,
      selectableCount: 1
    }
  });
  if (sent?.key?.id) mensagensEnquete.set(sent.key.id, sent);
}

async function executarAcao(sock, jid, acao) {
  if (acao === 'COMPROVANTE') {
    estadoUsuarios[jid] = 'AGUARDANDO_COMPROVANTE';
    await sock.sendMessage(jid, { text: RESPOSTAS.PEDIR_COMPROVANTE });
    return;
  }
  if (acao === 'CHAVE_PIX') {
    await sock.sendMessage(jid, { text: RESPOSTAS.CHAVE_PIX });
    await enviarAlgoMais(sock, jid);
    return;
  }
  if (acao === 'HORARIOS') {
    await sock.sendMessage(jid, { text: RESPOSTAS.HORARIOS });
    await enviarAlgoMais(sock, jid);
    return;
  }
  if (acao === 'OFERTAR') {
    await sock.sendMessage(jid, { text: RESPOSTAS.OFERTAR });
    await enviarAlgoMais(sock, jid);
    return;
  }
  if (acao === 'CONTATOS') {
    await sock.sendMessage(jid, { text: RESPOSTAS.CONTATOS });
    await enviarAlgoMais(sock, jid);
  }
}

async function processarEscolha(sock, jid, escolha, enviouArquivoOuImagem, veioDeEnquete = false) {
  const norm = normalizar(escolha);
  const estadoAtual = estadoUsuarios[jid] || 'INICIO';

  // 1. Se estava aguardando o comprovante
  if (estadoAtual === 'AGUARDANDO_COMPROVANTE') {
    if (enviouArquivoOuImagem) {
      await sock.sendMessage(jid, {
        text: '✅ *Comprovante recebido com sucesso!* Nossa equipe fará a conferência.\nDeus abençoe pela sua fidelidade! 🙏'
      });
      await enviarAlgoMais(sock, jid);
      return;
    }

    // Se a pessoa fez uma pergunta sobre outro assunto enquanto estava nessa etapa
    const intencao = detectarIntencao(norm);
    if (intencao && intencao !== 'COMPROVANTE') {
      await executarAcao(sock, jid, intencao);
      return;
    }

    // Se mandou "." ou mensagem sem ser o arquivo, mantém na mesma etapa sem reiniciar
    await sock.sendMessage(jid, {
      text: `Desculpe, não entendi. 🤔\nAinda estou aguardando o seu *comprovante do Pix*.\n\n${RESPOSTAS.PEDIR_COMPROVANTE}`
    });
    return;
  }

  // 2. Se estava na etapa "Te ajudo em algo mais?"
  if (estadoAtual === 'ALGO_MAIS') {
    if (norm.includes('sim') || norm === '1' || norm === 's') {
      await enviarMenu(sock, jid);
      return;
    }
    if (norm.includes('nao') || norm === '2' || norm === 'n') {
      delete estadoUsuarios[jid];
      await sock.sendMessage(jid, { text: RESPOSTAS.DESPEDIDA });
      return;
    }

    // Verifica se a pessoa já emendou uma pergunta direta (ex: "qual o horário?")
    const intencao = detectarIntencao(norm);
    if (intencao) {
      await executarAcao(sock, jid, intencao);
      return;
    }

    // Se mandou "." ou algo inválido, avisa e repete apenas a pergunta atual
    await sock.sendMessage(jid, {
      text: 'Desculpe, não entendi sua resposta. 🤔 Por favor, toque em uma das opções abaixo para continuar:'
    });
    await enviarAlgoMais(sock, jid);
    return;
  }

  // 3. Verifica seleção numérica/enquete no MENU ou pergunta direta em qualquer ponto
  if (veioDeEnquete || estadoAtual === 'MENU') {
    if (norm.startsWith('1')) return executarAcao(sock, jid, 'COMPROVANTE');
    if (norm.startsWith('2')) return executarAcao(sock, jid, 'CHAVE_PIX');
    if (norm.startsWith('3')) return executarAcao(sock, jid, 'HORARIOS');
    if (norm.startsWith('4')) return executarAcao(sock, jid, 'OFERTAR');
    if (norm.startsWith('5')) return executarAcao(sock, jid, 'CONTATOS');
  }

  // 4. Inteligência de dúvidas: funciona tanto no início quanto no meio do menu
  const intencaoDireta = detectarIntencao(norm);
  if (intencaoDireta) {
    await executarAcao(sock, jid, intencaoDireta);
    return;
  }

  // 5. Se já estava no MENU e mandou "." ou algo que não existe, não reinicia: avisa e reenvia o menu
  if (estadoAtual === 'MENU') {
    await sock.sendMessage(jid, {
      text: 'Desculpe, não entendi o que você digitou. 🤔\nPor favor, toque em uma das opções abaixo (ou digite o número de *1* a *5*):'
    });
    await enviarMenu(sock, jid);
    return;
  }

  // 6. Primeiro contato (INICIO): abre as boas-vindas com o menu
  await enviarMenu(sock, jid);
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
    printQRInTerminal: false,
    getMessage: async (key) => {
      const msg = mensagensEnquete.get(key.id);
      return msg ? msg.message : undefined;
    }
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

      if (msg.message?.pollUpdateMessage) {
        const pollCreationMsg = mensagensEnquete.get(msg.message.pollUpdateMessage.pollCreationMessageKey.id);
        if (pollCreationMsg) {
          const pollEncKey = pollCreationMsg.message?.messageContextInfo?.messageSecret;
          if (pollEncKey) {
            const votoDecifrado = decryptPollVote(msg.message.pollUpdateMessage.vote, {
              pollCreatorJid: sock.user.id.split(':')[0] + '@s.whatsapp.net',
              pollMsgId: msg.message.pollUpdateMessage.pollCreationMessageKey.id,
              pollEncKey,
              voterJid: jid
            });
            const votosAgregados = getAggregateVotesInPollMessage({
              message: pollCreationMsg.message,
              pollUpdates: [{ pollUpdateMessageKey: msg.key, vote: votoDecifrado }]
            });
            const opcaoEscolhida = votosAgregados.find((v) => v.voters.length > 0)?.name;
            if (opcaoEscolhida) {
              await processarEscolha(sock, jid, opcaoEscolhida, false, true);
            }
          }
        }
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

      await processarEscolha(sock, jid, textoOriginal, enviouArquivoOuImagem, false);
    }
  });
}

iniciarBot();
