# Pull Request

## What changed

<!-- Describe the change and the problem it solves. Link the issue it closes, if any. -->

## How it was tested

<!-- Commands run, scenarios covered, screenshots for UI changes. -->

- [ ] `npm run typecheck`
- [ ] `npx vitest run`
- [ ] `npm run build`

## Self-hosted deployment impact

<!--
TaskTick is self-hosted: people run their own instances from Docker images they
pull themselves. Call out anything an operator must do on upgrade.
-->

- [ ] No deployment impact — existing instances keep working unchanged.
- [ ] Requires a new or changed environment variable (documented in `.env.example`).
- [ ] Requires a database migration (`npm run db:migrate`).
- [ ] Changes the Docker image, entrypoint, port or volume layout.
- [ ] Other operator action required — described above.
