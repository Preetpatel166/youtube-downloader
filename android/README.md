# MediaDL Android Application

Native Android App for **MediaDL — YouTube Video & Audio Downloader**. Built with **Kotlin**, **Java**, modern **Material 3 XML Layouts**, **Retrofit**, and native **Android DownloadManager**.

---

## 📱 Features

- **Quick YouTube Download**: Paste any YouTube link (Videos, Shorts, Playlists).
- **System Share Sheet Integration**: In the YouTube app or browser, tap **Share** → select **MediaDL** to automatically fetch and download!
- **Clipboard Auto-Detect**: Automatically detects copied YouTube links upon opening the app.
- **HD Video & Audio Selection**: 1080p, 720p, 480p, and high-bitrate MP3 Audio extraction.
- **Direct Gallery/Media Storage**: Downloads files directly into your Android phone's **`Movies/MediaDL`** and **`Music/MediaDL`** folders, immediately accessible in your phone's Gallery, Photos, and Files apps.
- **Cloud Backend Connection**: Automatically configured with the live Render cloud backend (`https://youtube-downloader-12ed.onrender.com`).

---

## 🛠️ How to Open & Run in Android Studio

1. **Launch Android Studio**.
2. Click **Open** (or `File` → `Open...`).
3. Select this folder:
   ```
   c:\xampp\htdocs\Youtube Video Downloader\android
   ```
4. Allow Gradle to sync dependencies.
5. Connect your Android phone via USB (with **USB Debugging** enabled) or start an Android Emulator.
6. Click the green **Run (▶)** button!

---

## 📦 How to Build the APK File

In Android Studio:
- Go to `Build` → `Build Bundle(s) / APK(s)` → `Build APK(s)`.
- Or open terminal in this folder and run:
  ```bash
  gradlew assembleDebug
  ```
- Your installable `.apk` file will be generated in:
  ```
  app/build/outputs/apk/debug/app-debug.apk
  ```

---

## 🏗️ Architecture

- **`MainActivity.kt`**: Main UI controller handling clipboard detection, media previews with Glide, quality chips, and SSE download progress.
- **`ShareReceiverActivity.kt`**: Transparent receiver activity handling YouTube app share intents (`ACTION_SEND`).
- **`AndroidDownloadHelper.java`**: Java utility integrating with Android's system `DownloadManager` and storage providers.
- **`ApiClient.kt` & `MediaDlApiService.kt`**: Retrofit 2 + OkHttp networking layer.
- **`res/layout/activity_main.xml`**: Modern dark neon Material 3 XML layout.
