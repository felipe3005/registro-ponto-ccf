// ==================== FIREBASE INIT ====================
// Inicializa Firebase (App, Auth, RTDB, Storage) via CDN scripts carregados no index.html.
// Exporta handles globais: window.fbApp, window.fbAuth, window.fbDb, window.fbStorage

const firebaseConfig = {
  apiKey: "AIzaSyATbT0y4x9wgRVuyiT-bOAHWfLIs_NhVs8",
  authDomain: "registro-de-ponto-ccf.firebaseapp.com",
  databaseURL: "https://registro-de-ponto-ccf-default-rtdb.firebaseio.com",
  projectId: "registro-de-ponto-ccf",
  storageBucket: "registro-de-ponto-ccf.firebasestorage.app",
  messagingSenderId: "1004286049730",
  appId: "1:1004286049730:web:bf019328fdc70ac9f3aa5b"
};

// Inicializa app principal
firebase.initializeApp(firebaseConfig);
window.fbApp = firebase.app();
window.fbAuth = firebase.auth();
window.fbDb = firebase.database();
window.fbStorage = firebase.storage();

// Habilita persistência offline da RTDB (cache local, economiza reads)
try { window.fbDb.goOnline(); } catch(e) {}

// App secundário (usado pelo admin para criar usuários sem deslogar a si mesmo)
window.fbSecondaryApp = firebase.initializeApp(firebaseConfig, 'secondary');

// Helper: converte usuario -> email sintetico (necessario porque Firebase Auth exige email)
window.usuarioToEmail = function(usuario) {
  return (usuario || '').toLowerCase().trim() + '@ccf.local';
};

// Domínio para admins saberem (UI)
window.EMAIL_DOMAIN = '@ccf.local';
