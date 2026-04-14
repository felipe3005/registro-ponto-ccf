.PHONY: install dev deploy deploy-rules deploy-hosting emulators logs login clean help \
        bump-patch bump-minor bump-major release

NPM := npm
MSG ?= Atualizacao do sistema

help: ## Exibe esta ajuda
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

install: ## Instala dependencias (firebase-tools)
	$(NPM) install

login: ## Login no Firebase CLI (rode uma vez)
	npx firebase login

dev: ## Roda local (Hosting + Auth + RTDB + Storage nos emuladores)
	npx firebase emulators:start

serve: ## Serve apenas Hosting local (conectado ao Firebase real)
	npx firebase serve --only hosting

deploy: ## Deploy completo (hosting + regras RTDB + regras Storage)
	npx firebase deploy

deploy-hosting: ## Deploy apenas do frontend
	npx firebase deploy --only hosting

deploy-rules: ## Deploy apenas das regras de seguranca (RTDB + Storage)
	npx firebase deploy --only database,storage

logs: ## Abre console do Firebase
	@echo "https://console.firebase.google.com/project/registro-de-ponto-ccf"

clean: ## Limpa node_modules
	rm -rf node_modules

# ==================== VERSIONAMENTO ====================

bump-patch: ## Incrementa versao patch (2.0.0 -> 2.0.1)
	$(NPM) version patch --no-git-tag-version
	@echo "\033[32m✔ Versao atualizada para $$(node -p "require('./package.json').version")\033[0m"

bump-minor: ## Incrementa versao minor (2.0.0 -> 2.1.0)
	$(NPM) version minor --no-git-tag-version

bump-major: ## Incrementa versao major (2.0.0 -> 3.0.0)
	$(NPM) version major --no-git-tag-version

# ==================== RELEASE (BUMP + DEPLOY + GIT) ====================

release: bump-patch ## Bump patch + commit + push + deploy Firebase
	@VERSION=$$(node -p "require('./package.json').version") && \
	echo "\033[36m=> Versao: v$$VERSION\033[0m" && \
	git add -A && \
	git commit -m "release v$$VERSION - $(MSG)" && \
	git tag "v$$VERSION" && \
	git push origin main --tags && \
	echo "\033[36m=> Fazendo deploy no Firebase...\033[0m" && \
	npx firebase deploy && \
	echo "\033[32m✔ Release v$$VERSION publicada em https://registro-de-ponto-ccf.web.app\033[0m"
