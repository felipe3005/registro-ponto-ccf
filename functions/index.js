const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

admin.initializeApp();
setGlobalOptions({ region: 'us-central1', maxInstances: 5 });

const SMTP_USER = 'noreply@creditocasafinanciamentos.com.br';
const SMTP_PASS = '';
const APP_URL = 'https://registro-de-ponto-ccf.web.app';
const TOKEN_TTL_MIN = 30;

function transport() {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
}

function maskEmail(email) {
  const [u, d] = (email || '').split('@');
  if (!u || !d) return email;
  if (u.length <= 2) return u[0] + '***@' + d;
  return u.slice(0, 2) + '***' + u.slice(-1) + '@' + d;
}

function htmlEmail(nome, link, expira) {
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:'Open Sans',Arial,sans-serif;background:#f4f6fa;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fa;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(13,44,100,.08);">
        <tr><td style="background:linear-gradient(135deg,#0d2c64 0%,#1e4ba8 100%);padding:32px 40px;text-align:center;">
          <h1 style="color:#fff;margin:0;font-size:24px;font-weight:600;">Ponto Digital CCF</h1>
          <p style="color:#cbd9f0;margin:6px 0 0;font-size:14px;">Crédito Casa Financiamentos</p>
        </td></tr>
        <tr><td style="padding:40px;">
          <h2 style="color:#0d2c64;margin:0 0 16px;font-size:20px;">Olá, ${nome || 'Colaborador'}!</h2>
          <p style="color:#444;font-size:15px;line-height:1.6;margin:0 0 24px;">
            Recebemos uma solicitação para redefinir a senha da sua conta no Ponto Digital CCF.
            Clique no botão abaixo para criar uma nova senha:
          </p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center" style="padding:8px 0 32px;">
              <a href="${link}" style="display:inline-block;background:#0d2c64;color:#fff;text-decoration:none;padding:14px 40px;border-radius:8px;font-weight:600;font-size:15px;">Redefinir Senha</a>
            </td></tr>
          </table>
          <p style="color:#666;font-size:13px;line-height:1.6;margin:0 0 8px;">
            Ou copie e cole este link no navegador:
          </p>
          <p style="background:#f4f6fa;padding:12px;border-radius:6px;word-break:break-all;font-size:12px;color:#0d2c64;margin:0 0 24px;">
            ${link}
          </p>
          <div style="background:#fff8e1;border-left:4px solid #ffa726;padding:14px 18px;border-radius:4px;margin:0 0 24px;">
            <p style="color:#7a5a00;font-size:13px;margin:0;">
              <strong>⏱ Atenção:</strong> Este link expira em <strong>${expira}</strong>. Se você não solicitou esta redefinição, ignore este e-mail — sua senha permanecerá inalterada.
            </p>
          </div>
          <p style="color:#999;font-size:12px;line-height:1.5;margin:0;">
            Dúvidas? Procure o administrador do sistema.
          </p>
        </td></tr>
        <tr><td style="background:#f4f6fa;padding:20px 40px;text-align:center;">
          <p style="color:#888;font-size:12px;margin:0;">© Crédito Casa Financiamentos - Ponto Digital</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// Solicita reset: usuario -> envia email se cadastrado
exports.solicitarResetSenha = onCall(async (req) => {
  const usuario = (req.data?.usuario || '').toLowerCase().trim();
  if (!usuario) throw new HttpsError('invalid-argument', 'Usuário obrigatório');

  const db = admin.database();
  // Codifica chave igual ao client (replace . por ,)
  const key = usuario.replace(/\./g, ',').replace(/#/g, '%23').replace(/\$/g, '%24').replace(/\[/g, '%5B').replace(/\]/g, '%5D').replace(/\//g, '%2F');
  const uidSnap = await db.ref('usuario_to_uid/' + key).once('value');
  const uid = uidSnap.val();
  // Por seguranca nao revelamos se o usuario existe
  const RESP_GENERICA = { ok: true, message: 'Se o usuário existir e tiver e-mail cadastrado, um link foi enviado.' };
  if (!uid) return RESP_GENERICA;

  const userSnap = await db.ref('users/' + uid).once('value');
  const userData = userSnap.val();
  if (!userData || !userData.email) return RESP_GENERICA;

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + TOKEN_TTL_MIN * 60 * 1000;
  await db.ref('password_resets/' + token).set({
    uid,
    usuario,
    email: userData.email,
    expires_at: expiresAt,
    used: false,
    created_at: Date.now()
  });

  const link = `${APP_URL}/reset-senha.html?token=${token}`;
  await transport().sendMail({
    from: `"Ponto Digital CCF" <${SMTP_USER}>`,
    to: userData.email,
    subject: 'Redefinição de senha — Ponto Digital CCF',
    html: htmlEmail(userData.nome, link, `${TOKEN_TTL_MIN} minutos`)
  });

  return { ok: true, emailMascara: maskEmail(userData.email), message: `E-mail enviado para ${maskEmail(userData.email)}` };
});

// Valida token
exports.validarTokenReset = onCall(async (req) => {
  const token = (req.data?.token || '').trim();
  if (!token) throw new HttpsError('invalid-argument', 'Token obrigatório');
  const db = admin.database();
  const snap = await db.ref('password_resets/' + token).once('value');
  const r = snap.val();
  if (!r) throw new HttpsError('not-found', 'Link inválido');
  if (r.used) throw new HttpsError('failed-precondition', 'Este link já foi usado');
  if (Date.now() > r.expires_at) throw new HttpsError('failed-precondition', 'Link expirado');
  return { valido: true, usuario: r.usuario };
});

// Aplica nova senha
exports.aplicarResetSenha = onCall(async (req) => {
  const token = (req.data?.token || '').trim();
  const novaSenha = req.data?.novaSenha || '';
  if (!token) throw new HttpsError('invalid-argument', 'Token obrigatório');
  if (!novaSenha || novaSenha.length < 6) throw new HttpsError('invalid-argument', 'Senha deve ter pelo menos 6 caracteres');

  const db = admin.database();
  const ref = db.ref('password_resets/' + token);
  const snap = await ref.once('value');
  const r = snap.val();
  if (!r) throw new HttpsError('not-found', 'Link inválido');
  if (r.used) throw new HttpsError('failed-precondition', 'Este link já foi usado');
  if (Date.now() > r.expires_at) throw new HttpsError('failed-precondition', 'Link expirado');

  await admin.auth().updateUser(r.uid, { password: novaSenha });
  await db.ref('users/' + r.uid + '/senha_temporaria').set(false);
  await ref.update({ used: true, used_at: Date.now() });

  return { ok: true, message: 'Senha redefinida com sucesso' };
});
