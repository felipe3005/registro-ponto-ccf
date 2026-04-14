// ==================== FIREBASE INIT ====================
// App principal ja foi inicializado por /__/firebase/init.js (reserved URL do Hosting).
// Aqui so configuramos handles globais + app secundario (usado pelo admin pra criar
// usuarios sem deslogar a si mesmo).

window.fbApp = firebase.app();
window.fbAuth = firebase.auth();
window.fbDb = firebase.database();
window.fbStorage = firebase.storage();

try { window.fbDb.goOnline(); } catch (e) {}

// Reusa o mesmo config que o Hosting injetou no app principal
window.fbSecondaryApp = firebase.initializeApp(firebase.app().options, 'secondary');

// Helper: usuario -> email sintetico (Firebase Auth exige email)
window.usuarioToEmail = function (usuario) {
  return (usuario || '').toLowerCase().trim() + '@ccf.local';
};

window.EMAIL_DOMAIN = '@ccf.local';
