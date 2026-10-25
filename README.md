# auto-resume

A Claude Code mod that picks your work back up when the usage limit resets, so you don't have to wait around to type "continue".

When a turn stops because you hit the usage limit, the mod reads when the limit resets (the later one, if both the five-hour and weekly windows are spent), shows `auto-resume at 3:05 PM` in the status line, and about 90 seconds after the reset sends a prompt asking Claude to continue the task from where it left off. You get a desktop notification when it does.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install auto-resume --marketplace quincysting/auto-resume
```

From a shell:

```
claude plugin install auto-resume --marketplace quincysting/auto-resume
```

Answer `y` to add the marketplace, then press Enter to install at the user scope.

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `quincysting/auto-resume`, then Add plugin.

## Use

- It arms itself: nothing to do until a turn stops on the usage limit.
- `/auto-resume` shows whether anything is waiting; `/auto-resume off` and `/auto-resume on` switch it for the current session.
- Typing a prompt yourself before the reset cancels the pending resume.
- If the resumed turn is limited again, it retries, up to 6 times.

## Limits

- Claude Code has to stay open and the computer awake: a closed terminal can't resume anything.
- It triggers on a turn that stops with a `rate_limit` API error. If the limit surfaces differently on your build, it won't arm; the status line then never shows the `auto-resume at` time.
- Built against Claude Code 2.1.310's mod API, which is early access and may change between releases.
