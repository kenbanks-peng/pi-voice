# Pi Voice

Speak a short result summary through macOS `say` after each completed Pi request. Written results keep their full detail; speech rules apply only to a separate summary. Speech starts at `agent_settled`, after automatic continuations finish, not when Pi exits.

## Use

Load this folder as a Pi package:

```sh
pi install /Users/kenbanks/Software/Public/pi-plugins/pi-voice
```

Or load the extension for one session:

```sh
pi --extension ./index.ts
```

The extension uses the current model for one extra summary request. This has model cost and sends the final answer to that provider. It does not send tool output or thinking text. `prompt.md` guides the spoken summary. The code does not enforce a word limit. If the summary request fails, it reads the final answer instead.

Requires macOS and `/usr/bin/say`. Uses the default system voice. Speech is also enabled in non-interactive modes. A new agent run or session shutdown cancels speech. Aborted runs and empty answers produce no speech.

## Check

```sh
npm install
npm test
npm run typecheck
```
