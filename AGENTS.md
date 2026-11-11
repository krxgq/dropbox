# Repository Guidelines

## Project Structure & Module Organization

This workspace is currently an empty project scaffold. No application source, tests, assets, or dependency manifests are present. The existing `.agents/`, `.codex/`, `.aws/`, and `.git/` directories are environment-managed; do not repurpose them for application files.

When adding the first implementation, establish a simple layout appropriate to the chosen stack. Suggested locations are `src/` for source code, `tests/` for automated tests, and `assets/` for static resources. Add a `README.md` describing the project and its actual directory structure.

## Build, Test, and Development Commands

No build, test, lint, or local development commands are configured yet. Do not assume commands such as `npm test` or `make build` are available.

When introducing tooling, document exact installation, development, build, and test commands in `README.md`. Commit the relevant manifests and lockfiles so contributors can reproduce the environment.

## Coding Style & Naming Conventions

No language-specific style or formatter is established. Follow the conventions of the selected language and keep formatting consistent within each file. Use descriptive names for modules, functions, and variables.

Configure a formatter and linter when adding the initial source code. Avoid unrelated formatting changes in functional contributions.

## Testing Guidelines

No testing framework or coverage threshold is configured. Add automated tests alongside new behavior using the chosen stack's standard framework. Use descriptive test names that identify the behavior and expected outcome, and document how to run the suite.

## Commit & Pull Request Guidelines

Git history is unavailable in this workspace, so no existing commit convention can be inferred. Use concise, imperative commit subjects, such as `Add initial project setup`, and keep each commit focused.

Pull requests should describe the change, its purpose, and validation performed. Link relevant issues and include screenshots for visible interface changes. Explicitly note when tests could not be run and why.

## Security & Configuration

Never commit credentials, access tokens, or private configuration. Provide placeholder configuration examples and exclude local secrets and generated output through `.gitignore` when initializing the project.
