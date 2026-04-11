# Contributing to TrustM365

Thank you for your interest in contributing. This document explains how to get involved.

## Ways to Contribute

- **Report a bug** — Open an issue with steps to reproduce
- **Request a feature** — Open a discussion describing the use case
- **Add a resource area collector** — See the collector guide below
- **Improve documentation** — Fix errors, add clarity, translate
- **Review pull requests** — Code review is always welcome

---

## Development Setup

```bash
git clone https://github.com/AntoPorter/trustm365.git
cd trustm365
npm run install:all
cp .env.example .env
npm run generate:key   # paste output into .env as ENCRYPTION_KEY
npm run dev
```

The database is created automatically on first run. You do not need to run any separate init step.

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Adding a New Resource Area Collector

Each resource area (e.g. Conditional Access, Intune Compliance) is a self-contained collector registered in `backend/src/collectors/index.js`.

A collector must implement the following shape:

```javascript
{
  areaKey: 'unique_key',          // snake_case, e.g. 'entra_ca'
  displayName: 'Human Name',
  description: 'What this area monitors',

  // Graph API permissions needed for read access
  readPermissions: ['Graph.Permission.Read'],

  // Graph API permissions needed for restore (write) access
  writePermissions: ['Graph.Permission.ReadWrite'],

  // Pull all resources from the Graph API
  // Must return: { [resourceId]: { id, displayName, ...fields } }
  async pull(token) { },

  // Properties available in the visual baseline editor
  watchableKeys: [
    {
      path: 'fieldName',
      label: 'Human-readable label',
      type: 'boolean|string|number|enum|array|json'
    }
  ],

  // Restore a single resource to its baseline state
  // Use graphPatch / graphPut / graphPost as appropriate for the API endpoint
  async restore(token, resourceId, baselineResource) { }
}
```

### Licence detection

If a collector requires a specific licence (e.g. Entra P1 for CA, Intune for device management), it should throw a `LicenceUnavailableError` from `pull()` when the licence is absent. TrustM365 catches this and marks the area as **Licence required** on the dashboard rather than showing an error.

### Graph permissions

Add the permissions your collector needs to `readPermissions` and `writePermissions`. Document them in your PR description. Reviewers will check that:

- Read permissions are the minimum necessary
- Write permissions are as tightly scoped as possible
- Admin consent requirements are clearly noted

Also add the permissions to the tables in [docs/prerequisites.md](docs/prerequisites.md).

---

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Include a description of what changed and why
- For new collectors, include the Graph API endpoints used and a brief description of what each field in `watchableKeys` represents
- Do not include `.env` files, database files, or `node_modules`
- Run `npm run dev` and verify the new area appears, syncs, and baselines correctly before submitting

---

## Code Style

- 2-space indentation
- Single quotes for strings
- Async/await over raw promises
- Descriptive variable names over abbreviations
- JSDoc comments on exported functions

---

## Reporting Security Issues

Please **do not** open public issues for security vulnerabilities. Email the maintainer directly instead.
