.PHONY: install dev build build-dev create create-dev update update-dev get-token copy-env watch start

PROJECT_PATH := $(CURDIR)

-include .env

start:
	@echo "Welcome to the Akeneo Extension SDK project! Let's set up your environment."
	@echo "---------------------------------------------------------------------"
	@echo "Installing common dependencies..."
	@(cd common && npm install)
	@echo "Installing dependencies..."
	@$(MAKE) install
	@echo "\nCopying environment file..."
	@$(MAKE) copy-env
	@echo "\nNow we need to configure your environment variables."

	@_ensure_env_var() { \
		if grep -q "^$$1=" .env > /dev/null 2>&1; then \
			echo "$$2 is already set in .env. Using existing value."; \
		else \
			read -p "Enter your $$2: " value; \
			node common/set-env.mjs $$1 "$$value"; \
		fi \
	}; \
	echo "Please provide the following information:"; \
	_ensure_env_var PIM_HOST "PIM host URL (e.g., https://your-pim-instance.com)"; \
	_ensure_env_var CLIENT_ID "CLIENT_ID"; \
	_ensure_env_var CLIENT_SECRET "CLIENT_SECRET"; \
	_ensure_env_var USERNAME "USERNAME"; \
	_ensure_env_var PASSWORD "PASSWORD"; \
	_ensure_env_var ZENDESK_BASE_URL "ZENDESK_BASE_URL"; \
	echo "\nGenerating API token..."; \
	$(MAKE) get-token; \
	echo "\nCreating UI extension..."; \
	$(MAKE) create-dev; \
	echo "\n✅ Setup complete!"
	@echo "Run 'update-dev' to update your extension after making changes."
	@echo "\nYou can run 'make watch' to enable hot reloading during development."
	@echo "This will automatically update your extension when you make changes to the code."
	@echo "\n🚀 Enjoy building your extension!"

install:
	npm install

dev:
	npm run dev

build:
	@echo "Building..."
	@echo "Project path: $(PROJECT_PATH)"
	npm run build

build-dev:
	@echo "Building with optimized configuration for development..."
	@echo "Project path: $(PROJECT_PATH)"
	npx vite build --mode development

create: build get-token
	@node common/create-extension.mjs

create-dev: build-dev get-token
	@node common/create-extension.mjs

create-with-credentials: build get-token
	@node common/create-extension.mjs --with-credentials

create-dev-with-credentials: build-dev get-token
	@node common/create-extension.mjs --with-credentials

update: build get-token
	@node common/update-extension.mjs

update-dev: build-dev get-token
	@node common/update-extension.mjs

update-with-credentials: build get-token
	@node common/update-extension.mjs --with-credentials

update-dev-with-credentials: build-dev get-token
	@node common/update-extension.mjs --with-credentials

watch:
	@echo "Watching for changes and updating on file change..."
	@node common/watch.mjs

get-token:
	@echo "Getting API token for Akeneo PIM..."
	@node common/token.mjs

copy-env:
	@if [ ! -f .env ]; then \
		echo "Creating .env file from .env.example..."; \
		cp .env.example .env; \
		echo ".env file created."; \
	else \
		echo ".env file already exists. No changes made."; \
	fi
