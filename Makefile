# One command per job, for every language at once.
#   make generate   regenerate all SDKs, the GraphQL schema and docs from spec/openapi.json
#   make spec       fetch Zora's current spec (then: make generate)
#   make test       offline tests for every SDK (no network)
#   make live       every endpoint against Zora's production API, in every language
#   make fixtures   re-record the shared test fixtures from the live API
PY ?= python3
PYSDK ?= $(abspath ../zora-coins-py)
DOTNET ?= $(HOME)/.dotnet/dotnet
CMAKE ?= /usr/bin/cmake

.PHONY: generate spec test live fixtures test-go test-graphql test-rust test-ts test-dotnet test-java test-cpp test-python

spec:
	curl -fsS https://api-sdk.zora.engineering/openapi -o spec/openapi.json

generate:
	cd codegen && for e in emit_go emit_graphql emit_rust emit_ts emit_csharp emit_java emit_cpp emit_docs; do $(PY) $$e.py || exit 1; done
	[ ! -d $(PYSDK) ] || (cd codegen && $(PY) emit_python.py $(PYSDK)/src/zora_coins/_models.py)

fixtures:
	$(PY) scripts/record_fixtures.py

test: test-go test-graphql test-rust test-ts test-dotnet test-java test-cpp

test-go:
	cd go && go vet ./... && go test -race -count=1 ./...
test-graphql:
	cd graphql && go vet ./... && go test -race -count=1 ./...
test-rust:
	cd rust && cargo clippy --all-features --all-targets -- -D warnings && cargo test --all-features
test-ts:
	cd typescript && npx tsc --noEmit && npx vitest run
test-dotnet:
	cd dotnet && $(DOTNET) test tests/Zora.Coins.Tests
test-java:
	cd java && ./gradlew test javadoc -q
test-cpp:
	cd cpp && $(CMAKE) -S . -B build -DCMAKE_BUILD_TYPE=Release && $(CMAKE) --build build -j && ./build/zora_tests
test-python:
	cd $(PYSDK) && .venv/bin/python -m pytest -q && .venv/bin/python -m mypy src && .venv/bin/ruff check src tests

live:
	cd go && go test -tags live -count=1 -run Live ./zora
	cd rust && cargo test --test live -- --ignored
	cd typescript && LIVE=1 npx vitest run test/live.test.ts
	cd dotnet && LIVE=1 $(DOTNET) test tests/Zora.Coins.Tests --filter LiveTests
	cd java && LIVE=1 ./gradlew test --tests '*LiveTest*' -q
	cd cpp && LIVE=1 ./build/zora_tests
