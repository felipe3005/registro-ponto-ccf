# Ponto Digital CCF

Sistema de registro de ponto digital desenvolvido em Electron.js, compatível com Windows e macOS. Permite controle completo de jornada de trabalho com registro de ponto, cálculos de horas, relatórios e gestão de funcionários.

## Funcionalidades

### Registro de Ponto
- Registro sequencial automático: Entrada → Saída Almoço → Retorno Almoço → Saída
- Validação de duplicidade (impede registrar o mesmo tipo duas vezes no dia)
- Relógio em tempo real na tela de registro

### Gestão de Funcionários
- Cadastro completo com cargo, departamento e jornada semanal
- Perfis de acesso: Administrador e Funcionário
- Soft delete (desativação/reativação)
- Busca e filtros com paginação

### Cálculo de Horas
- Horas trabalhadas por dia (entrada→saída almoço + retorno→saída)
- Horas extras (comparação com jornada contratada)
- Atrasos (com tolerância configurável conforme CLT)
- Banco de horas mensal (saldo acumulado de extras e débitos)

### Relatórios
- Espelho de ponto mensal por funcionário
- Relatório geral de todos os funcionários
- Detecção de inconsistências (registros incompletos ou fora do padrão)
- Exportação em PDF e CSV

### Justificativas e Ajustes
- Solicitação de ajuste de ponto pelo funcionário
- Aprovação/rejeição pelo administrador com justificativa
- Registro de atestados médicos (com upload de arquivo)
- Registro de faltas

### Configurações
- Horário de trabalho por funcionário e dia da semana
- Cadastro de feriados
- Tolerância de atraso configurável (padrão: 10 minutos)

## Stack

- **Desktop:** Electron.js
- **Backend:** Node.js + Express
- **Frontend:** HTML/CSS/JS (SPA)
- **Banco de Dados:** MySQL (TiDB Cloud)
- **Autenticação:** JWT
- **Relatórios:** PDFKit (PDF) + CSV

## Pré-requisitos

- [Node.js](https://nodejs.org/) v18 ou superior
- Acesso ao banco MySQL (credenciais no `.env`)

## Instalação

```bash
# Clonar o repositório
git clone <url-do-repositorio>
cd Registro-Ponto-CCF

# Instalar dependências
make install

# Criar tabelas e usuário admin inicial
make seed

# Ou tudo de uma vez
make setup
```

## Uso

```bash
# Modo desenvolvimento (navegador em http://localhost:3131)
make dev

# Modo desktop (Electron)
make start
```

## Build

```bash
# Gerar instalador Windows (.exe)
make build-win

# Gerar instalador macOS (.dmg)
make build-mac

# Ambos
make build
```

Os instaladores serão gerados na pasta `dist/`.

## Configuração

Crie um arquivo `.env` na raiz do projeto:

```env
MYSQL_HOST=seu-host
MYSQL_PORT=4000
MYSQL_USER=seu-usuario
MYSQL_PASSWORD=sua-senha
MYSQL_DATABASE=seu-banco
JWT_SECRET=sua-chave-secreta
PORT=3131
```

## Login Inicial

| Campo | Valor |
|-------|-------|
| Email | `admin@ccf.com` |
| Senha | `admin123` |

> Altere a senha do admin após o primeiro acesso.

## Estrutura do Projeto

```
├── main.js                        # Processo principal Electron
├── seed.js                        # Criação de tabelas e admin
├── Makefile                       # Comandos make
├── src/
│   ├── backend/
│   │   ├── database.js            # Conexão MySQL + migrations
│   │   ├── server.js              # Servidor Express
│   │   ├── middleware/
│   │   │   └── auth.js            # Autenticação JWT
│   │   └── routes/
│   │       ├── auth.js            # Login, logout, reset senha
│   │       ├── funcionarios.js    # CRUD de funcionários
│   │       ├── ponto.js           # Registro de ponto
│   │       ├── horas.js           # Cálculos de horas
│   │       ├── ajustes.js         # Ajustes, atestados, faltas
│   │       ├── relatorios.js      # Espelho, relatórios, PDF/CSV
│   │       └── configuracoes.js   # Horários, feriados, tolerância
│   └── frontend/
│       ├── index.html             # SPA principal
│       ├── css/
│       │   └── style.css
│       └── js/
│           ├── api.js             # Cliente HTTP
│           └── app.js             # Lógica de interface
└── uploads/                       # Arquivos de atestados
```

## Banco de Dados

Todas as tabelas são criadas com o prefixo `rp_` para não conflitar com tabelas existentes:

| Tabela | Descrição |
|--------|-----------|
| `rp_funcionarios` | Cadastro de funcionários |
| `rp_registros_ponto` | Registros de entrada/saída |
| `rp_ajustes_ponto` | Solicitações de ajuste |
| `rp_atestados` | Atestados médicos |
| `rp_feriados` | Calendário de feriados |
| `rp_configuracoes_horario` | Horários por funcionário/dia |
| `rp_configuracoes` | Configurações gerais |
| `rp_faltas` | Registro de faltas |

## Comandos Make

| Comando | Descrição |
|---------|-----------|
| `make help` | Lista todos os comandos disponíveis |
| `make install` | Instala dependências |
| `make setup` | Install + seed completo |
| `make dev` | Servidor em modo desenvolvimento |
| `make start` | Abre o app Electron |
| `make seed` | Cria tabelas e admin |
| `make build-win` | Build para Windows |
| `make build-mac` | Build para macOS |
| `make build` | Build para ambos |
| `make clean` | Remove node_modules e dist |

## Licença

Uso interno - CCF
