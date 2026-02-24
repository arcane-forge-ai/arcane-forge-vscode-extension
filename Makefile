SHELL := /bin/sh

.PHONY: help install compile package build-vsix publish-vscode publish-openvsx publish-all clean

help:
	@echo "Targets:"
	@echo "  make install          Install dependencies"
	@echo "  make compile          Compile TypeScript"
	@echo "  make package          Build .vsix package"
	@echo "  make build-vsix       Alias for package"
	@echo "  make publish-vscode   Publish to VS Code Marketplace (uses VSCE_PAT or prior vsce login)"
	@echo "  make publish-openvsx  Publish to Open VSX (requires OVSX_PAT env var)"
	@echo "  make publish-all      Package and publish to both registries"
	@echo "  make clean            Remove build output and VSIX artifacts"

install:
	npm install

compile:
	npm run compile

package: install compile
	npm run package:vsix

build-vsix: package

publish-vscode: package
	@npx @vscode/vsce publish

publish-openvsx: package
	@if [ -z "$$OVSX_PAT" ]; then \
		echo "Error: OVSX_PAT is not set."; \
		echo "Usage: OVSX_PAT=*** make publish-openvsx"; \
		exit 1; \
	fi
	@npx ovsx publish -p "$$OVSX_PAT"

publish-all: package
	@if [ -z "$$OVSX_PAT" ]; then \
		echo "Error: OVSX_PAT is not set."; \
		echo "Usage: OVSX_PAT=*** make publish-all"; \
		exit 1; \
	fi
	@npx @vscode/vsce publish
	@npx ovsx publish -p "$$OVSX_PAT"

clean:
	rm -rf out *.vsix

