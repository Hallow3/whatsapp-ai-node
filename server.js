require('dotenv').config();
const express = require('express');
const fs = require('fs');
const qrcode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const bodyParser = require('body-parser');
const cors = require('cors');


const app = express();
app.use(bodyParser.json());
app.use(cors({
    origin: process.env.CLIENT_URL || '*',
    methods: ['POST']
}));
app.use('/qr', express.static('qr'));

const sessions = {}; // mémoire
const PORT = process.env.PORT;

function migrateContexts(contexts) {
    const migrated = {};
    for (const sessionId in contexts) {
        if (typeof contexts[sessionId] === 'string') {
            migrated[sessionId] = [
                { role: 'system', content: contexts[sessionId] }
            ];
        } else {
            migrated[sessionId] = contexts[sessionId];
        }
    }
    return migrated;
}

// Charger les contextes
let sessionContext = {};

if (fs.existsSync('sessions.json')) {
        try {
        const rawData = fs.readFileSync('sessions.json');
        const loadedContext = JSON.parse(rawData);
        
        // Appliquer la migration si nécessaire
        sessionContext = migrateContexts(loadedContext);
        
        // Sauvegarder la version migrée
        fs.writeFileSync('sessions.json', JSON.stringify(sessionContext, null, 2));
        console.log('Contextes migrés avec succès');
    } catch (e) {
        console.error('Erreur de chargement sessions.json:', e);
        sessionContext = {};
    }
}

function saveContexts() {
    fs.writeFileSync('sessions.json', JSON.stringify(sessionContext, null, 2));
}

// MODIFICATIONS À PARTIR D'ICI
app.post('/generate-session', async (req, res) => {
    const { phone, context } = req.body;
    const sessionId = phone.replace('+', '');
    const code = sessionId.slice(-6);

    if (sessions[sessionId]) {
        return res.status(400).json({ message: 'Session déjà active' });
    }

    const client = new Client({
        authStrategy: new LocalAuth({ clientId: sessionId }),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-logging',
                '--silent',
                '--disable-gpu',
                '--disable-software-rasterizer',
                '--disable-dev-shm-usage'
            ],
            logger: { // Redirige les logs vers un flux vide
                debug: () => { },
                info: () => { },
                warn: () => { },
                error: () => { }
            }
        }
    });

    const qrDir = './qr';
    if (!fs.existsSync(qrDir)) {
        fs.mkdirSync(qrDir);
    }

    client.on('qr', async (qr) => {
        await qrcode.toFile(`./qr/${sessionId}.png`, qr);
        console.log(`[${sessionId}] QR généré`);
    });

    client.on('ready', () => {
        console.log(`[${sessionId}] connecté`);
    });

    client.on('authenticated', () => {
        fs.unlink(`./qr/${sessionId}.png`, (err) => {
            if (err && err.code !== 'EBUSY') {
                console.error(err);
            } else {
                console.log(`[${sessionId}] QR supprimé`);
            }
        });
    });

    process.on('uncaughtException', (err) => {
        if (err.code === 'EBUSY') {
            console.warn('EBUSY warning ignorée:', err.message);
        } else {
            console.error('Erreur non gérée:', err);
            process.exit(1);
        }
    });

    client.on('message', async msg => {
        if (msg.fromMe) return;

        const axios = require('axios');
        const deepseekKey = process.env.DEEPSEEK_API_KEY;

        // 3. Vérifier et corriger le format du contexte
        if (!sessionContext[sessionId] || !Array.isArray(sessionContext[sessionId])) {
            sessionContext[sessionId] = [
                { role: 'system', content: context }
            ];
        }

        // Nouvelle gestion du contexte
        const currentContext = sessionContext[sessionId];

        // Ajouter le nouveau message
        currentContext.push({
            role: 'user',
            content: msg.body
        });

        // Garder seulement les 5 derniers messages
        const trimmedContext = currentContext.slice(-6);

        try {
            const response = await axios.post('https://api.deepseek.com/chat/completions', {
                model: 'deepseek-chat',
                messages: trimmedContext,
                max_tokens: 150,
                temperature: 0.7
            }, {
                headers: {
                    'Authorization': `Bearer ${deepseekKey}`,
                    'Content-Type': 'application/json'
                }
            });

            const reply = response.data.choices[0].message.content.trim();

            // Ajouter la réponse au contexte
            currentContext.push({
                role: 'assistant',
                content: reply
            });

            // Mettre à jour le contexte dans la session
            sessionContext[sessionId] = currentContext;
            saveContexts();

            await msg.reply(reply);
        } catch (error) {
            console.error('Erreur DeepSeek API:', error);
            await msg.reply("Désolé, une erreur s'est produite.");
        }
    });

    // Initialiser le contexte avec un tableau vide
    // 4. Initialiser le contexte si nécessaire
    if (!sessionContext[sessionId] || !Array.isArray(sessionContext[sessionId])) {
        sessionContext[sessionId] = [
            { role: 'system', content: context }
        ];
    }

    // Sauvegarder le contexte initial
    saveContexts();

    sessions[sessionId] = client;
    client.initialize();

    res.json({
        sessionId,
        code,
        qrUrl: `${process.env.BASE_URL}/qr/${sessionId}.png`
    });
});

app.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
});