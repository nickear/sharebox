# ShareBox 

[English](README.md) | 中文

一个小型自托管 Web 应用，用于共享文本、文件和文件夹。

## 快速开始

将 `.env.example` 复制为 `.env`。

### 本地运行

需要 Node.js 20.6.0 或更高版本。

```bash
cd sharebox
npm start
```

打开：

```text
http://127.0.0.1:3940
```

然后输入 `.env` 中 `SHAREBOX_PASSWORD` 的密码（默认是 `share`），或将 `SHAREBOX_PASSWORD` 置空来跳过登录认证。

### Docker

```bash
cd sharebox
docker compose up -d --build
```

打开：

```text
http://SERVER_IP:3940
```
