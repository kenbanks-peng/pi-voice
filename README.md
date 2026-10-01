# Pi Voice

Read short responses directly through macOS `say` after each completed Pi request. For responses longer than 45 spoken words, read a separate summary. Written results keep their full detail. Speech starts at `agent_settled`, after automatic continuations finish, not when Pi exits.

## Use

Load this folder as a Pi package:

```sh
pi install /Users/kenbanks/Software/Public/pi-plugins/pi-voice
```

Or load the extension for one session:

```sh
pi --extension ./index.ts
```

Short responses need no extra model request. Markdown, URLs, and code are removed or replaced before the words are counted and the text is read. For longer responses, the extension uses the current model for one extra summary request. This has model cost and sends the final answer to that provider. It does not send tool output or thinking text. `prompt.md` guides the spoken summary. If no model is available or the summary request fails, it does not speak the long response.

Requires macOS and `/usr/bin/say`. Uses the default system voice. Speech is also enabled in non-interactive modes. A new agent run or session shutdown cancels speech. Aborted runs and empty answers produce no speech.

## Check

```sh
npm install
npm test
npm run typecheck
```
