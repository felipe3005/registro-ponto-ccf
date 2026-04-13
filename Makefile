.PHONY: install dev start seed build-win build-mac build clean help \
       release release-win release-mac bump-patch bump-minor bump-major

# Carregar .env
ifneq (,$(wildcard .env))
  include .env
  export
endif

# Variáveis
NPM := npm
NODE := node
MSG ?= Atualizacao do sistema

help: ## Exibe esta ajuda
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

install: ## Instala todas as dependencias
	$(NPM) install

setup: install seed ## Setup completo (install + seed)

dev: ## Roda o servidor em modo desenvolvimento (http://localhost:3131)
	$(NODE) src/backend/server.js

start: ## Abre o app Electron
	$(NPM) start

seed: ## Cria as tabelas e o usuario admin inicial
	$(NODE) seed.js

build-win: ## Gera o instalador para Windows (.exe)
	$(NPM) run build:win

build-mac: ## Gera o instalador para macOS (.dmg)
	$(NPM) run build:mac

build: ## Gera instaladores para Windows e macOS
	$(NPM) run build

clean: ## Remove node_modules e dist
	rm -rf node_modules dist

reset-db: ## Recria as tabelas e o admin (nao apaga dados existentes)
	$(NODE) seed.js

# ==================== VERSIONAMENTO ====================

bump-patch: ## Incrementa versao patch (1.0.0 -> 1.0.1)
	$(NPM) version patch --no-git-tag-version
	@echo "\033[32m✔ Versao atualizada para $$(node -p "require('./package.json').version")\033[0m"

bump-minor: ## Incrementa versao minor (1.0.0 -> 1.1.0)
	$(NPM) version minor --no-git-tag-version
	@echo "\033[32m✔ Versao atualizada para $$(node -p "require('./package.json').version")\033[0m"

bump-major: ## Incrementa versao major (1.0.0 -> 2.0.0)
	$(NPM) version major --no-git-tag-version
	@echo "\033[32m✔ Versao atualizada para $$(node -p "require('./package.json').version")\033[0m"

# ==================== RELEASE (BUILD + GIT + PUBLISH) ====================

release-win: bump-patch ## Build Windows + git + publish (auto-update colaboradores)
	@echo "\033[36m=> Versao: $$(node -p "require('./package.json').version")\033[0m"
	@echo "\033[36m=> Commitando alteracoes...\033[0m"
	git add -A
	git commit -m "release v$$(node -p "require('./package.json').version") - $(MSG)"
	git tag "v$$(node -p "require('./package.json').version")"
	@echo "\033[36m=> Enviando para o GitHub...\033[0m"
	git push origin main --tags
	@echo "\033[36m=> Gerando build Windows e publicando...\033[0m"
	$(NPM) run release:win
	@echo "\033[32m✔ Release Windows v$$(node -p "require('./package.json').version") publicada com sucesso!\033[0m"
	@echo "\033[32m  Os colaboradores receberao a atualizacao automaticamente.\033[0m"
	@echo "\033[33m  URL: https://github.com/felipe3005/registro-ponto-ccf/releases/tag/v$$(node -p "require('./package.json').version")\033[0m"

release-mac: bump-patch ## Build Mac + git + publish (auto-update colaboradores)
	@echo "\033[36m=> Versao: $$(node -p "require('./package.json').version")\033[0m"
	@echo "\033[36m=> Commitando alteracoes...\033[0m"
	git add -A
	git commit -m "release v$$(node -p "require('./package.json').version") - $(MSG)"
	git tag "v$$(node -p "require('./package.json').version")"
	@echo "\033[36m=> Enviando para o GitHub...\033[0m"
	git push origin main --tags
	@echo "\033[36m=> Gerando build Mac e publicando...\033[0m"
	$(NPM) run release:mac
	@echo "\033[32m✔ Release Mac v$$(node -p "require('./package.json').version") publicada com sucesso!\033[0m"
	@echo "\033[32m  Os colaboradores receberao a atualizacao automaticamente.\033[0m"
	@echo "\033[33m  URL: https://github.com/felipe3005/registro-ponto-ccf/releases/tag/v$$(node -p "require('./package.json').version")\033[0m"

release: bump-patch ## Build Win+Mac + git + publish (auto-update colaboradores)
	@echo "\033[36m=> Versao: $$(node -p "require('./package.json').version")\033[0m"
	@echo "\033[36m=> Commitando alteracoes...\033[0m"
	git add -A
	git commit -m "release v$$(node -p "require('./package.json').version") - $(MSG)"
	git tag "v$$(node -p "require('./package.json').version")"
	@echo "\033[36m=> Enviando para o GitHub...\033[0m"
	git push origin main --tags
	@echo "\033[36m=> Gerando build Win + Mac e publicando...\033[0m"
	$(NPM) run release
	@echo "\033[32m✔ Release v$$(node -p "require('./package.json').version") publicada com sucesso!\033[0m"
	@echo "\033[32m  Os colaboradores receberao a atualizacao automaticamente.\033[0m"
	@echo "\033[33m  URL: https://github.com/felipe3005/registro-ponto-ccf/releases/tag/v$$(node -p "require('./package.json').version")\033[0m"
