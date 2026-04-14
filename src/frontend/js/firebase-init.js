// ==================== FIREBASE INIT ====================
// O app principal ja foi inicializado por /__/firebase/init.js (URL reservada servida
// pelo Firebase Hosting com o config em runtime). Assim o config nao fica no repositorio.

window.fbApp = firebase.app();
window.fbAuth = firebase.auth();
window.fbDb = firebase.database();
window.fbStorage = firebase.storage();

try { window.fbDb.goOnline(); } catch (e) {}

// App secundario (usado pelo admin pra criar usuarios sem deslogar a si mesmo)
window.fbSecondaryApp = firebase.initializeApp(firebase.app().options, 'secondary');

window.usuarioToEmail = function (usuario) {
  return (usuario || '').toLowerCase().trim() + '@ccf.local';
};

window.EMAIL_DOMAIN = '@ccf.local';
