# 🎬 YouTube Video & Playlist Downloader

A modern web application to download YouTube videos and full playlists with real-time SSE progress streaming, powered by **yt-dlp** and **ffmpeg**.

---

## 🚀 Deploy to Render (Live in 3 Minutes)

### Step 1: Push Code to GitHub

1. Open your terminal in this project folder:
   ```bash
   git init
   git add .
   git commit -m "Initial commit for Render deployment"
   ```

2. Create a new repository on [GitHub](https://github.com/new).

3. Link and push your code:
   ```bash
   git remote add origin https://github.com/<YOUR_USERNAME>/<YOUR_REPO_NAME>.git
   git branch -M main
   git push -u origin main
   ```

---

### Step 2: Deploy on Render

1. Go to [dashboard.render.com](https://dashboard.render.com/) and sign in.
2. Click **New +** → **Web Service**.
3. Connect your GitHub repository.
4. Select **Docker** as the Runtime (Render will automatically detect the [Dockerfile](file:///C:/Users/Admin/Downloads/Youtube%20Video%20Downloader/Dockerfile)).
5. Click **Create Web Service**.

Render will automatically build the container (installing Node.js, `ffmpeg`, and `yt-dlp`) and give you a free live URL (e.g., `https://youtube-downloader-xxxx.onrender.com`).

---

## 💻 Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the server:
   ```bash
   npm start
   ```

3. Open [http://localhost:3000](http://localhost:3000) in your browser.
