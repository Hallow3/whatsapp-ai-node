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


function buildSystemPrompt(businessContext, companyName, supportNumber) {
    return `🎯 Prompt Système — IA Service Client WhatsApp (Strict, Contextuel, Dynamique)

Tu es un assistant de service client professionnel de l’entreprise ${companyName} qui répond aux utilisateurs sur WhatsApp.

Ton seul objectif est de fournir des réponses précises, utiles et courtes aux utilisateurs, en respectant strictement le contexte fourni.

Tu n’as accès qu’au contexte suivant:* ${businessContext} * et aux 5 derniers messages de la conversation. Tu ne dois jamais inventer, supposer ou ajouter d’informations non présentes dans ce contexte.

Tu n’es pas un chatbot générique, pas un assistant personnel, pas un conseiller IA. Tu es exclusivement un agent du service client.

⚠️ Règles strictes à suivre :
✅ Reste 100 % fidèle au contexte et aux derniers échanges.

❌ N’invente jamais de réponse si l'information n'est pas explicitement présente.

❌ Ne sors jamais du rôle de service client (pas de conseils de vie, pas de blagues, pas de discussions générales).

❌ Ne dis jamais “je pense que”, “peut-être”, ou toute autre forme d’incertitude.

❌ Ne mentionne aucun document, aucune source, aucune date, sauf si l’utilisateur le demande expressément.

✅ Utilise un ton courtois, professionnel et concis.

✅ Si l'information n’est pas disponible dans le contexte, réponds simplement :

“Je ne suis pas en mesure de répondre à cette question pour le moment. Vous pouvez contacter notre support au ${supportNumber}.”

✅ Termine tes phrases correctement. Si la réponse est longue, abrège ou divise en deux réponses.

Ton objectif est d’être clair, fiable, et 100 % aligné avec le contexte défini dynamiquement.`;
}

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
    const { phone, businessContext, companyName, supportNumber } = req.body;

    if (!phone || !businessContext || !companyName || !supportNumber) {
        return res.status(400).json({ error: 'Tous les paramètres sont requis' });
    }

    const sessionId = phone.replace('+', '');
    const code = sessionId.slice(-6);

    if (sessions[sessionId]) {
        return res.status(400).json({ message: 'Session déjà active' });
    }

    // Construire le prompt système
    const systemPrompt = buildSystemPrompt(businessContext, companyName, supportNumber);

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

        // Vérifier et initialiser le contexte si nécessaire
        if (!sessionContext[sessionId] || !Array.isArray(sessionContext[sessionId])) {
            sessionContext[sessionId] = [
                { role: 'system', content: systemPrompt  }
            ];
        }

        const currentContext = sessionContext[sessionId];

        // Ajouter le nouveau message utilisateur
        currentContext.push({
            role: 'user',
            content: msg.body
        });

        // 1. TOUJOURS INCLURE LE CONTEXTE SYSTÈME
        const systemMessage = currentContext[0];

        // 2. Garder les 4 derniers échanges (8 messages) 
        //    + le nouveau message (total 9 messages hors système)
        const recentMessages = currentContext.slice(1);
        const last8Recent = recentMessages.slice(-8);

        // 3. Préparer le contexte final : système + historique récent
        const messagesForApi = [systemMessage, ...last8Recent];

        try {
            const response = await axios.post('https://api.deepseek.com/chat/completions', {
                model: 'deepseek-chat',
                messages: messagesForApi,
                max_tokens: 250,
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

            // 4. Tronquer le contexte : système + 4 derniers échanges (9 messages max)
            const allMessages = currentContext.slice(1);
            const last8Messages = allMessages.slice(-8);
            sessionContext[sessionId] = [systemMessage, ...last8Messages];

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
            { role: 'system', content: systemPrompt }
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

app.post('/update-context', (req, res) => {
    const { phone, businessContext, companyName, supportNumber } = req.body;
    
    if (!phone || !businessContext || !companyName || !supportNumber) {
        return res.status(400).json({ error: 'Tous les paramètres sont requis' });
    }

    const sessionId = phone.replace('+', '');
    
    // Vérifier si le contexte existe pour cette session
    if (!sessionContext[sessionId]) {
        return res.status(404).json({ error: 'Session introuvable' });
    }

    // Construire le nouveau prompt système
    const newSystemPrompt = buildSystemPrompt(businessContext, companyName, supportNumber);

    // Mise à jour du contexte système (premier message du tableau)
    sessionContext[sessionId][0] = { 
        role: 'system', 
        content: newSystemPrompt
    };

    // Réinitialiser l'historique de conversation
    sessionContext[sessionId] = [sessionContext[sessionId][0]];

    // Sauvegarde dans le fichier
    saveContexts();

    res.json({ 
        success: true, 
        message: 'Contexte mis à jour avec succès',
        sessionId,
        newSystemPrompt
    });
});

// Ajoutez cette route après la route /update-context
app.post('/send-message', async (req, res) => {
    const { sender, recipient, message } = req.body;

    // Validation des paramètres
    if (!sender || !recipient || !message) {
        return res.status(400).json({ error: 'Tous les paramètres sont requis (sender, recipient, message)' });
    }

    // Formatter les numéros (supprimer les '+' et espaces)
    const cleanSender = sender.replace(/[+\s]/g, '');
    const cleanRecipient = recipient.replace(/[+\s]/g, '');

    // Vérifier si la session existe
    if (!sessions[cleanSender]) {
        return res.status(404).json({ error: 'Session introuvable pour cet expéditeur' });
    }

    try {
        const client = sessions[cleanSender];
        const formattedRecipient = `${cleanRecipient}@c.us`;
        
        // Vérifier si le client est prêt
        if (client.info === undefined) {
            return res.status(425).json({ error: 'Client WhatsApp pas encore prêt' });
        }

        // Envoyer le message
        await client.sendMessage(formattedRecipient, message);
        
        res.json({ 
            success: true,
            message: 'Message envoyé avec succès',
            details: {
                from: cleanSender,
                to: cleanRecipient,
                length: message.length
            }
        });
    } catch (error) {
        console.error('Erreur envoi message:', error);
        res.status(500).json({ 
            error: "Échec d'envoi du message",
            details: error.message 
        });
    }
});

app.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
});