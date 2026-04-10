.PHONY: install dev start seed build-win build-mac build clean help

# Variáveis
NPM := npm
NODE := node

help: ## Exibe esta ajuda
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

install: ## Instala todas as dependências
	$(NPM) install

setup: install seed ## Setup completo (install + seed)

dev: ## Roda o servidor em modo desenvolvimento (http://localhost:3131)
	$(NODE) src/backend/server.js

start: ## Abre o app Electron
	$(NPM) start

seed: ## Cria as tabelas e o usuário admin inicial
	$(NODE) seed.js

build-win: ## Gera o instalador para Windows (.exe)
	$(NPM) run build:win

build-mac: ## Gera o instalador para macOS (.dmg)
	$(NPM) run build:mac

build: ## Gera instaladores para Windows e macOS
	$(NPM) run build

clean: ## Remove node_modules e dist
	rm -rf node_modules dist

reset-db: ## Recria as tabelas e o admin (não apaga dados existentes)
	$(NODE) seed.js
