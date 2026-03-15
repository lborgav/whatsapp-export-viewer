# WhatsApp Export Viewer

A browser-based viewer for exported WhatsApp conversations. Everything runs locally — no data is uploaded anywhere.

## Usage

1. Export a chat from WhatsApp (**Settings → Chats → Export Chat**, choose "With Media")
2. Unzip the exported file
3. Serve the project with any HTTP server:

```bash
make run
# or
python3 -m http.server 8000
```

4. Open `http://localhost:8000` and select the unzipped chat folder

## Features

- Images, videos, audio, and stickers
- Full-text search (Ctrl/Cmd+F)
- Light/dark theme
- Bold, italic, strikethrough, inline code, and clickable links
- Edited message indicator

## Requirements

A modern browser with File System Access API support (Chrome, Edge, Safari 15.2+).
