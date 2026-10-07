# Claude Code Image Preview: A Cool Mod for a Real Gap

You paste a screenshot into the Claude Code prompt. Then the phone rings, or lunch happens. You come back to a prompt that says `[Image #1]` and no idea what's behind it. Was that the failing test output, or the mockup? Your only option is to delete it and paste again.

I filed an issue asking for a way to preview a pending image. It was closed. But Claude Code recently gained mods, so I built the fix myself.

> **What are mods?**
> Mods are a new way to extend Claude Code from the inside. A mod is a plugin made of small hook functions, and it can add a live pane, a band above the prompt, a status line entry, a toast, a slash command, or a hook on events like a prompt submit or a tool call. It works in the terminal and in the desktop app's Code tab.
>
> You can ask Claude Code to write one. It puts the mod in a folder, and with your permission it hot-reloads in the running session, so each change shows up when the turn ends. Mods are shared like any other plugin: put the folder in a GitHub repo and others install it with `/plugin`.

## What it does

- A band above the prompt shows a `🖼 Image #N` chip for each image in your draft. Click one and the image opens in your OS viewer. On a Mac that's Preview, with real zoom and full resolution.
- A `📷 Images` button opens a pane listing your images. Each row can reveal the file in Finder, copy its path, or open it.
- It works before you submit, for clipboard pastes and dropped files.

## What I learned building it

The mod API has no hook for clicks on the native `[Image #N]` widget, and it doesn't expose the pasted bytes. So the mod watches your draft for the tags and puts the buttons next to them instead.

My first attempt drew the image inside the terminal with half-block characters. It worked, but it was too coarse to be useful. Handing the image to the OS viewer was both simpler and better.

Terminal buttons also have limits the mod can't change. The terminal inverts a button's colors on hover, and an unfocused pane can need a second click.

## Honest caveats

- You have to type a space after the `[Image #N]` tag before the chip appears. It's a quirk, and I'd like to remove it.
- I've only tested it on macOS. The Linux and Windows code paths exist, but I haven't tried them.

## Try it

```
/plugin marketplace add sandipchitale/claude-code-image-preview
/plugin install image-preview@image-preview
```

The code is MIT-licensed: https://github.com/sandipchitale/claude-code-image-preview

If you're on Linux or Windows, I'd love to hear whether it works. Pull requests are welcome too.

#ClaudeCode #Anthropic #DeveloperTools #AIAssistedCoding
