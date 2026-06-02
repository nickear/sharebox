# ShareBox 

English | [中文](README.zh-CN.md)

A small self-hosted web app for sharing text, files, and folders.

## Quick Start

Copy `.env.example` to `.env`.

### Local

Requires Node.js 20.6.0 or newer.

```bash
cd sharebox
npm start
```

Open:

```text
http://127.0.0.1:3940
```

Then enter the password from `SHAREBOX_PASSWORD` in `.env` (`share` by default), or leave `SHAREBOX_PASSWORD` empty to skip authentication.

### Docker

```bash
cd sharebox
docker compose up -d --build
```

Open:

```text
http://SERVER_IP:3940
```
