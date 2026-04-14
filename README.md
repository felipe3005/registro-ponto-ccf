# Ponto Digital CCF (Firebase)

Sistema de registro de ponto digital da **Credito Casa Financiamentos**, rodando 100% em **Firebase**: Hosting (frontend estatico), Realtime Database (dados), Authentication (login) e Storage (atestados).

Sem backend proprio, sem Electron, sem instalador. Acesso direto pelo navegador em:

**https://registro-de-ponto-ccf.web.app**

---

## Arquitetura

- **Frontend**: HTML/CSS/JS vanilla em [`src/frontend/`](src/frontend/)
- **Firebase SDK (compat)** carregado via CDN
- **Realtime Database** armazena usuarios, registros, ajustes, abonos, perfis de horario, feriados, config
- **Firebase Auth** (email/senha) — usuario digita `usuario`, internamente e convertido para `{usuario}@ccf.local`
- **Storage** guarda atestados em `/atestados/{uid}/{arquivo}`

### Estrutura de dados (RTDB)

```
/users/{uid}               — perfil do colaborador
/usuario_to_uid/{usuario}  — lookup rapido username -> uid
/registros/{uid}/{id}      — registros de ponto (indexado por `data`)
/ajustes/{id}              — solicitacoes de ajuste (indexado por funcionario_uid, status)
/abonos/{id}               — abonos/atestados (indexado por funcionario_uid, status)
/perfis_horario/{id}       — perfis de horario de trabalho
/configuracoes_horario/{uid}/{diaSemana}
/feriados/{id}
/configuracoes/            — tolerancia_minutos etc
```

---

## Setup inicial (uma vez)

### 1. Instalar Firebase CLI

```bash
make install          # instala firebase-tools localmente
make login            # autentica no Firebase
```

### 2. Habilitar servicos no Firebase Console

No projeto `registro-de-ponto-ccf`:

1. **Authentication** > Sign-in method > habilitar "Email/Password"
2. **Realtime Database** > criar (regiao `us-central1`) > modo bloqueado
3. **Storage** > criar bucket padrao

### 3. Publicar regras de seguranca

```bash
make deploy-rules
```

### 4. Criar o primeiro admin

Como o sistema usa Firebase Auth, o primeiro admin precisa ser criado manualmente:

1. Abra https://console.firebase.google.com/project/registro-de-ponto-ccf/authentication/users
2. **Add user** com email `admin@ccf.local` e a senha que quiser
3. Copie o **User UID** gerado
4. Abra https://console.firebase.google.com/project/registro-de-ponto-ccf/database > **Data**
5. Crie manualmente o no `/users/{UID_COPIADO}` com o seguinte JSON:

```json
{
  "nome": "Administrador",
  "usuario": "admin",
  "email_login": "admin@ccf.local",
  "role": "admin",
  "ativo": true,
  "senha_temporaria": false,
  "jornada_semanal": 44
}
```

6. Crie tambem `/usuario_to_uid/admin` com valor `"{UID_COPIADO}"` (string)

Agora voce pode logar com `admin` + senha no app.

### 5. Deploy do frontend

```bash
make deploy
```

---

## Comandos

| Comando            | O que faz |
|--------------------|-----------|
| `make install`     | Instala `firebase-tools` |
| `make login`       | Login no Firebase CLI |
| `make dev`         | Roda **emuladores locais** (Hosting :5000, Auth :9099, DB :9000, Storage :9199, UI :4000) |
| `make serve`       | Serve hosting local conectado ao Firebase real |
| `make deploy`      | Deploy completo (frontend + regras) |
| `make deploy-hosting` | Deploy so do frontend |
| `make deploy-rules`   | Deploy so das regras de seguranca |
| `make release`     | Bump patch + commit + push + deploy |

---

## Desenvolvimento local

**Opcao 1 — Emuladores (recomendado):**
```bash
make dev
```
Abra http://localhost:5000. UI dos emuladores em http://localhost:4000.

**Opcao 2 — Frontend local + Firebase real:**
```bash
make serve
```

---

## Fluxos e regras

### Auth
- Colaborador digita `usuario` + senha -> convertido para `{usuario}@ccf.local` internamente
- Sessao persiste automaticamente
- `senha_temporaria: true` abre modal de troca no primeiro login

### Cadastro de colaborador (admin)
- Admin informa nome, usuario e senha inicial
- Sistema cria Firebase Auth user via **app secundario** (nao desloga o admin)
- Cria `/users/{novoUid}` e `/usuario_to_uid/{usuario}`

### Reset de senha
- **Com email real cadastrado**: Firebase envia email de reset
- **Sem email** (so @ccf.local): admin precisa **excluir e recriar** o colaborador (limitacao sem Admin SDK)

### Registro de ponto
- Trava de 1h de almoco
- Offline: RTDB enfilera localmente e sincroniza sozinha ao voltar

### Relatorios
- Rodam no cliente sobre dados lidos da RTDB
- Export CSV disponivel. PDF foi removido (dependia do backend).

---

## Economia de recursos (free tier)

- RTDB: queries estreitas com `orderByChild`/`startAt`/`endBefore`, cache em memoria
- Storage: atestados limitados a 5 MB, apenas imagens/PDF
- Hosting: cache de assets (1h js/css, 1 dia imagens)
- Auth: ilimitado gratis

Limites do plano Spark:
- RTDB: 1 GB / 10 GB download mes
- Storage: 5 GB / 1 GB dia download
- Hosting: 10 GB mes

Para CCF isso sobra.

---

## Limitacoes sem Cloud Functions

1. **Exclusao definitiva** remove da RTDB mas deixa usuario no Firebase Auth
2. **Reset de senha sem email** nao funciona — excluir e recriar
3. **Relatorios pesados** rodam no cliente (ok ate ~10k registros/mes)
4. **PDF export** removido
5. **Agregacoes** fazem varios reads paralelos (aceitavel ate ~100 funcionarios)

Upgrade para Blaze habilita Cloud Functions se necessario.

---

## Migracao da versao antiga (MySQL/Electron)

Senhas bcrypt do MySQL nao migram para Firebase Auth. Caminho:

1. Exportar funcionarios do MySQL
2. Admin cria cada um com senha temporaria
3. Cada colaborador troca senha no primeiro login
4. Registros historicos podem ser importados via script Node

---

## Versao

Frontend: v2.0.0 (Firebase)

Versao anterior (Electron/MySQL) disponivel no historico git pre-migracao.
