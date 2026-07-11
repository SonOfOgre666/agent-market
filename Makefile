.PHONY: up down dev worker beat install check

# Syntax-only: Python worker tree + apps/api JS (no Mongo/Redis). Run after refactors.
check:
	cd services/ai-worker && python3 -m compileall -q -f connectors tasks lib celery_app.py db.py
	@set -e; for f in $$(find apps/api/src -name '*.js' 2>/dev/null); do node --check "$$f"; done

up:
	docker compose up -d

down:
	docker compose down

install:
	npm install

dev:
	npm run dev

worker:
	cd services/ai-worker && (test -d .venv || python3 -m venv .venv) && . .venv/bin/activate && pip install -q -r requirements.txt && celery -A celery_app:celery_app worker -l info

beat:
	cd services/ai-worker && (test -d .venv || python3 -m venv .venv) && . .venv/bin/activate && pip install -q -r requirements.txt && celery -A celery_app:celery_app beat -l info
