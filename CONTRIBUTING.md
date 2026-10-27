# Contributing to DevIntel

## Team roles

| Role | GitHub |
|---|---|
| Team lead, reviewer and maintainer of `main` | Malik-p |
| Contributor | Sanrachana10 |
| Contributor | Chitlangia-Vedant |

All changes reach `main` through a reviewed pull request. Nobody pushes directly to `main`.

## Local setup

```powershell
npm install
Copy-Item .env.example .env   # then set JWT_SECRET (24+ characters)
npm run dev                   # API on :4000, web app on :5173
```

MongoDB must be running locally (or set `MONGODB_URI` to an Atlas cluster). The demo workspace is seeded automatically on first start; `npm run seed` resets it.

## Workflow

1. **Pick an issue** from the project board and assign it to yourself.
2. **Create a branch from the latest `main`:**
   ```powershell
   git checkout main
   git pull
   git checkout -b feature/short-description
   ```
3. **Commit small, focused changes** (see the conventions below).
4. **Push and open a pull request** into `main` using the PR template. Link the issue with `Closes #<number>`.
5. **CI must pass** (install + production build).
6. **The team lead reviews.** Address the comments, then the lead merges.
7. **Delete the branch** after merging.

## Branch names

| Prefix | Use for |
|---|---|
| `feature/` | New functionality, e.g. `feature/github-file-contents` |
| `fix/` | Bug fixes, e.g. `fix/task-board-filter` |
| `docs/` | Documentation only |
| `test/` | Adding or updating tests |
| `chore/` | Tooling, dependencies, configuration |

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(impact): detect removed formats in source allow-lists
fix(tasks): keep sprint filter when moving a card
docs(readme): add deployment steps
test(api): cover requirement revalidation endpoint
```

When a commit implements a DevIntel requirement or task, include its key (for example `REQ-006` or `TASK-022`). DevIntel's own GitHub sync uses these keys to link commits to requirements.

## Code style

- Match the surrounding code: ES modules, `async/await`, two-space indentation, single quotes.
- Backend routes go in `server/routes/api.js`; domain logic belongs in `server/services/`.
- Shared UI components live in `src/components/`; reuse `ui.jsx` badges and states instead of creating new ones.
- Never commit `.env`, credentials, `node_modules/` or `dist/`.

## Before opening a pull request

- [ ] `npm run build` succeeds
- [ ] The demo workflow still works (dashboard → REQ-006 → edit → Analyze Change Impact)
- [ ] No secrets or debug logging added
