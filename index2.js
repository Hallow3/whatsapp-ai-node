  const qrcode = require('qrcode-terminal');
  const { Client, LocalAuth } = require('whatsapp-web.js');

  const whatsapp = new Client({
      authStrategy: new LocalAuth()
  });

  whatsapp.on('qr', (qr) => {
      qrcode.generate(qr, { small: true });
  });

  whatsapp.on('ready', async () => {
      console.log('WhatsApp client is ready!');
    
      // ID du groupe (à remplacer par l'ID de votre groupe)
      const groupId = "IRA5EX90wozK55vOU8q8M5@g.us";
    
      try {
          // Obtenir le chat du groupe
          const chat = await whatsapp.getChatById(groupId);
        
          // Envoyer le message dans le groupe
          await chat.sendMessage("Voici mon message automatique !");
          console.log('Message envoyé avec succès !');
      } catch (error) {
          console.error('Erreur lors de l\'envoi du message:', error);
      }
  });

  // Pour obtenir l'ID de votre groupe WhatsApp :
    // 1. Allez sur WhatsApp Web
    // 2. Ouvrez le groupe dont vous voulez l'ID
    // 3. Dans l'URL, vous verrez quelque chose comme : https://web.whatsapp.com/accept?code=xxx
    // 4. L'ID du groupe sera une série de chiffres suivie de "@g.us"
    // 5. Copiez cet ID et remplacez "XXXXXXXXXX@g.us" par votre ID de groupe
  

  whatsapp.initialize();
