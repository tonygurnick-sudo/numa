.PHONY: init lock install test build clean

init:
	poetry install --no-root

lock:
	poetry lock

install:
	poetry install --no-root

test:
	poetry run pytest

build:
	rm -f lambda_function.zip
	zip -r lambda_function.zip lambda_function.py

clean:
	rm -f lambda_function.zip
	find . -name "__pycache__" -type d -prune -exec rm -rf {} +
