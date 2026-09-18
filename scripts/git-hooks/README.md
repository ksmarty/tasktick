# Git hooks

## `reference-transaction`, `pre-commit`

Both refuse ref changes while `.git/AGENT-LOCK` exists, so sub-agents cannot
commit or tag while they are running. `reference-transaction` covers every ref
update including `git tag` (which has no dedicated hook); `pre-commit` is
belt-and-braces.

Install into a working copy:

```sh
cp scripts/git-hooks/reference-transaction .git/hooks/
cp scripts/git-hooks/reference-transaction .git/hooks/pre-commit
chmod +x .git/hooks/reference-transaction .git/hooks/pre-commit
```

They are kept here rather than in `.git/` so the guard is reviewable and travels
with the repo, but they are **not** installed automatically — a fresh clone has
no protection until someone copies them.

### Using the lock

```sh
touch .git/AGENT-LOCK     # before spawning sub-agents
rm -f .git/AGENT-LOCK     # after collecting them
```

### Verifying it works

```sh
touch .git/AGENT-LOCK
git commit --allow-empty -m x     # must fail
git tag test-tag                  # must fail
rm .git/AGENT-LOCK
git commit --allow-empty -m x     # must succeed
```

### What it is and is not

It guards against the *accidental* case: an agent finishing its work and
helpfully committing and tagging it. Three separate sub-agents did exactly that,
once sweeping a sibling's half-finished work into a released commit.

It is **not** a sandbox — an agent that knew about the lock could delete it,
which is why the lock is not mentioned in any sub-agent brief.

An earlier attempt used a pi extension with a `tool_call` hook instead. It never
fired: project-local extensions need project trust and a sub-agent runs
non-interactively (which ignores project resources), and a global one produced no
log when a sub-agent ran. The hook mechanism has no such dependency.
