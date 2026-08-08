const webpush = require('web-push');

const keys = webpush.generateVAPIDKeys();
console.log('Agrega estas variables de entorno:\n');
console.log('VAPID_PUBLIC_KEY=' + keys.publicKey);
console.log('VAPID_PRIVATE_KEY=' + keys.privateKey);
