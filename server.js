const express = require('express');
const QRCode = require('qrcode');
const pino = require('pino');
const cors = require('cors'); // نیا پیکیج CORS کے لیے
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');

const app = express();
app.use(cors()); // تمام ڈومینز سے ریکوئस्ट الاؤ کرنے کے لیے
app.use(express.json());

const PORT = process.env.PORT || 3000;
const GATEWAY_SECRET = process.env.GATEWAY_SECRET || 'thg_secret_key_12345';

let sock;
let qrCodeData = '';
let isConnected = false;

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  
  sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    logger: pino({ level: 'silent' })
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) {
      QRCode.toDataURL(qr, (err, url) => {
        if (!err) qrCodeData = url;
      });
    }

    if (connection === 'open') {
      isConnected = true;
      qrCodeData = '';
      console.log('WhatsApp Connected Successfully!');
    } else if (connection === 'close') {
      isConnected = false;
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        console.log('Reconnecting to WhatsApp...');
        connectToWhatsApp();
      } else {
        console.log('Connection closed. Please restart to scan QR again.');
      }
    }
  });
}

// 1. Web Route: QR Code & Status UI
app.get('/', (req, res) => {
  if (isConnected) {
    return res.send(`
      <div style="text-align:center;margin-top:100px;font-family:sans-serif;">
        <h1 style="color:#10b981;">⚡ THG WhatsApp Gateway Connected!</h1>
        <p>Your WhatsApp session is active and ready to dispatch OTP messages.</p>
      </div>
    `);
  }
  if (qrCodeData) {
    return res.send(`
      <div style="text-align:center;margin-top:50px;font-family:sans-serif;">
        <h2>Scan QR Code with WhatsApp</h2>
        <p>Open WhatsApp on your phone -> Linked Devices -> Link a Device</p>
        <img src="${qrCodeData}" alt="WhatsApp QR Code" style="margin-top:20px; border:4px solid #10b981; border-radius:12px;"/>
      </div>
    `);
  }
  res.send(`
    <div style="text-align:center;margin-top:100px;font-family:sans-serif;">
      <h2>Generating WhatsApp QR Code...</h2>
      <p>Please refresh this page in 5 seconds.</p>
    </div>
  `);
});

// 2. Status Route for Testing Connection
app.get('/status', (req, res) => {
  res.json({
    success: true,
    connected: isConnected,
    message: isConnected ? 'Gateway is online and WhatsApp is connected.' : 'Gateway is online, waiting for WhatsApp QR scan.'
  });
});

// 3. Send Message API Endpoint
app.post('/send-message', async (req, res) => {
  const authHeader = req.headers['authorization'] || req.headers['x-api-key'];
  const token = authHeader && authHeader.replace('Bearer ', '') || req.body.secret;

  if (token !== GATEWAY_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Invalid Secret Token' });
  }

  if (!isConnected) {
    return res.status(400).json({ success: false, error: 'WhatsApp is not connected. Please scan the QR code first.' });
  }

  const recipient = req.body.number || req.body.phone;
  const messageText = req.body.message;

  if (!recipient || !messageText) {
    return res.status(400).json({ success: false, error: 'Missing phone number or message content.' });
  }

  try {
    const formattedNumber = recipient.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
    await sock.sendMessage(formattedNumber, { text: messageText });
    res.json({ success: true, message: 'OTP / Message sent successfully via WhatsApp!' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Gateway Server running on port ${PORT}`);
  connectToWhatsApp();
});
