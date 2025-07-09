const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');
const axios = require('axios');

const whatsapp = new Client({
     authStrategy: new LocalAuth()
});

// Remplacez par votre clé API DeepSeek
const DEEPSEEK_API_KEY = 'sk-b0f61389b60048f79650eabae43222b0';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

whatsapp.on('qr', (qr) => {
     qrcode.generate(qr, { small: true });
});

whatsapp.on('ready', () => {
     console.log('WhatsApp client is ready!');
});

whatsapp.on('message', async (message) => {
     // Ignorer les messages envoyés par le bot lui-même
     if (message.fromMe) return;
     
     console.log(`Message reçu: ${message.body}`);
     
     try {
         const response = await getMessageResponse(message.body);
         await message.reply(response);
         console.log(`Réponse envoyée: ${response}`);
     } catch (error) {
         console.error('Erreur lors de la génération de la réponse:', error);
         await message.reply('Désolé, je ne peux pas répondre pour le moment. Veuillez réessayer plus tard.');
     }
});

async function getMessageResponse(messageText) {
     try {
         const response = await axios.post(DEEPSEEK_API_URL, {
             model: "deepseek-chat",
             messages: [
                 {
                     role: "system",
                     content: "Tu es un commercant et tu t'appelle Arthur. Tu es un expert en vente et tu réponds aux questions des clients de manière amicale et professionnelle. mais actuellement le stock de toutes les marchandise est épuisé. les clients doivent le savoir"
                 },
                 {
                     role: "user",
                     content: messageText
                 }
             ],
             max_tokens: 150,
             temperature: 0.7
         }, {
             headers: {
                 'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                 'Content-Type': 'application/json'
             }
         });

         return response.data.choices[0].message.content.trim();
     } catch (error) {
         console.error('Erreur API DeepSeek:', error.response?.data || error.message);
         throw error;
     }
}

whatsapp.initialize();

/*
Documentation des fonctionnalités disponibles:

1. qrcode-terminal:
    - generate(text, options): Génère un QR code dans le terminal
    - setErrorLevel(): Définit le niveau de correction d'erreur
    - toString(): Convertit le QR code en chaîne de caractères

2. whatsapp-web.js:
   
    Client:
    - initialize(): Démarre le client WhatsApp
    - destroy(): Arrête le client
    - logout(): Déconnexion
    - sendMessage(chatId, content): Envoie un message
    - sendImage(chatId, image): Envoie une image
    - sendVideo(chatId, video): Envoie une vidéo
    - sendAudio(chatId, audio): Envoie un fichier audio
    - sendDocument(chatId, document): Envoie un document
    - sendLocation(chatId, latitude, longitude): Envoie une localisation
    - sendContact(chatId, contact): Envoie un contact
    - getChats(): Récupère toutes les conversations
    - getChatById(chatId): Récupère une conversation par ID
    - getContacts(): Récupère tous les contacts
    - getContactById(contactId): Récupère un contact par ID
    - archiveChat(chatId): Archive une conversation
    - pinChat(chatId): Épingle une conversation
    - unpinChat(chatId): Désépingle une conversation
    - markChatUnread(chatId): Marque une conversation comme non lue
   
    Events:
    - 'qr': Émis quand un QR code doit être scanné
    - 'ready': Émis quand le client est prêt
    - 'message': Émis quand un message est reçu
    - 'message_create': Émis quand un message est créé
    - 'message_revoke_everyone': Émis quand un message est supprimé
    - 'disconnected': Émis quand le client est déconnecté
    - 'change_state': Émis quand l'état de connexion change
    - 'group_join': Émis quand quelqu'un rejoint un groupe
    - 'group_leave': Émis quand quelqu'un quitte un groupe
    - 'group_update': Émis quand les infos d'un groupe sont mises à jour
   
    Message:
    - reply(content): Répond à un message
    - forward(chatId): Transfère un message
    - delete(everyone): Supprime un message
    - star(): Marque un message comme favoris
    - unstar(): Retire un message des favoris
    - react(emoji): Ajoute une réaction
   
    Chat:
    - sendMessage(content): Envoie un message dans la conversation
    - sendImage(image): Envoie une image dans la conversation
    - sendVideo(video): Envoie une vidéo dans la conversation
    - sendAudio(audio): Envoie un audio dans la conversation
    - sendDocument(document): Envoie un document dans la conversation
    - sendLocation(latitude, longitude): Envoie une localisation
    - sendContact(contact): Envoie un contact
*/