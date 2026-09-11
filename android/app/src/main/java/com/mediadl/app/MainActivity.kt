package com.mediadl.app

import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.bumptech.glide.Glide
import com.bumptech.glide.load.resource.bitmap.RoundedCorners
import com.google.gson.Gson
import com.mediadl.app.api.*
import com.mediadl.app.databinding.ActivityMainBinding
import com.mediadl.app.download.AndroidDownloadHelper
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.BufferedReader
import java.io.InputStreamReader

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private var currentMedia: MediaInfoResponse? = null
    private var selectedQuality: String = "1080p"
    private var activeJobId: String? = null
    private val gson = Gson()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupListeners()
        handleIntent(intent)
        checkClipboardForYouTubeLink()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        if (intent != null && intent.hasExtra("EXTRA_YOUTUBE_URL")) {
            val sharedUrl = intent.getStringExtra("EXTRA_YOUTUBE_URL") ?: ""
            if (sharedUrl.isNotEmpty()) {
                binding.etUrl.setText(sharedUrl)
                fetchMediaInfo(sharedUrl)
            }
        }
    }

    private fun setupListeners() {
        // Paste button
        binding.btnPaste.setOnClickListener {
            val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val clip = clipboard.primaryClip
            if (clip != null && clip.itemCount > 0) {
                val text = clip.getItemAt(0).text?.toString()?.trim() ?: ""
                if (text.isNotEmpty()) {
                    binding.etUrl.setText(text)
                    fetchMediaInfo(text)
                }
            } else {
                Toast.makeText(this, "Clipboard is empty", Toast.LENGTH_SHORT).show()
            }
        }

        // Fetch button
        binding.btnFetch.setOnClickListener {
            val url = binding.etUrl.text.toString().trim()
            if (url.isEmpty()) {
                Toast.makeText(this, "Please enter a YouTube link", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            fetchMediaInfo(url)
        }

        // Quality selection chips
        binding.chipGroupQuality.setOnCheckedStateChangeListener { _, checkedIds ->
            if (checkedIds.isEmpty()) return@setOnCheckedStateChangeListener
            selectedQuality = when (checkedIds.first()) {
                binding.chip1080.id -> "1080p"
                binding.chip720.id -> "720p"
                binding.chip480.id -> "480p"
                binding.chipMp3.id -> "mp3"
                else -> "1080p"
            }
        }

        // Download button
        binding.btnDownload.setOnClickListener {
            startDownloadJob()
        }

        // Server switcher chip
        binding.chipServerStatus.setOnClickListener {
            showServerConfigDialog()
        }
    }

    private fun showServerConfigDialog() {
        val servers = arrayOf(
            "Render Cloud (https://youtube-downloader-12ed.onrender.com/)",
            "Local PC Wi-Fi (http://10.192.216.1:3000/)"
        )
        val currentIndex = if (com.mediadl.app.api.ApiClient.currentBaseUrl.contains("onrender.com")) 0 else 1

        androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("Select Backend Server")
            .setSingleChoiceItems(servers, currentIndex) { dialog, which ->
                if (which == 0) {
                    com.mediadl.app.api.ApiClient.currentBaseUrl = "https://youtube-downloader-12ed.onrender.com/"
                    binding.chipServerStatus.text = "Render Live"
                    binding.chipServerStatus.setTextColor(getColor(R.color.accent_green))
                    Toast.makeText(this, "Connected to Render Cloud", Toast.LENGTH_SHORT).show()
                } else {
                    com.mediadl.app.api.ApiClient.currentBaseUrl = "http://10.192.216.1:3000/"
                    binding.chipServerStatus.text = "Local PC (Wi-Fi)"
                    binding.chipServerStatus.setTextColor(getColor(R.color.brand_cyan))
                    Toast.makeText(this, "Connected to Local PC", Toast.LENGTH_SHORT).show()
                }
                dialog.dismiss()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun checkClipboardForYouTubeLink() {
        try {
            val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val clip = clipboard.primaryClip
            if (clip != null && clip.itemCount > 0) {
                val text = clip.getItemAt(0).text?.toString()?.trim() ?: ""
                if (text.contains("youtube.com") || text.contains("youtu.be")) {
                    if (binding.etUrl.text.isNullOrEmpty()) {
                        binding.etUrl.setText(text)
                        Toast.makeText(this, "Detected link from clipboard!", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        } catch (_: Exception) {}
    }

    private fun fetchMediaInfo(url: String) {
        binding.pbLoading.visibility = View.VISIBLE
        binding.btnFetch.isEnabled = false
        binding.cardMediaPreview.visibility = View.GONE
        binding.cardProgress.visibility = View.GONE

        lifecycleScope.launch(Dispatchers.IO) {
            try {
                var response = ApiClient.apiService.getMediaInfo(url)

                // If cloud server encountered bot check, attempt auto-fallback to local PC on Wi-Fi
                if (!response.isSuccessful && ApiClient.currentBaseUrl.contains("onrender.com")) {
                    val rawErr = response.errorBody()?.string() ?: ""
                    if (rawErr.contains("bot", ignoreCase = true) || rawErr.contains("sign-in", ignoreCase = true)) {
                        try {
                            val localUrl = "http://10.192.216.1:3000/"
                            val localRetrofit = retrofit2.Retrofit.Builder()
                                .baseUrl(localUrl)
                                .client(ApiClient.okHttpClient)
                                .addConverterFactory(retrofit2.converter.gson.GsonConverterFactory.create())
                                .build()
                            val localService = localRetrofit.create(MediaDlApiService::class.java)
                            val localResp = localService.getMediaInfo(url)
                            if (localResp.isSuccessful && localResp.body() != null) {
                                response = localResp
                                ApiClient.currentBaseUrl = localUrl
                                withContext(Dispatchers.Main) {
                                    binding.chipServerStatus.text = "Local PC (Wi-Fi)"
                                    binding.chipServerStatus.setTextColor(getColor(R.color.brand_cyan))
                                    Toast.makeText(this@MainActivity, "Connected via Local PC server (bot check bypassed!)", Toast.LENGTH_SHORT).show()
                                }
                            }
                        } catch (_: Exception) {}
                    }
                }

                withContext(Dispatchers.Main) {
                    binding.pbLoading.visibility = View.GONE
                    binding.btnFetch.isEnabled = true

                    if (response.isSuccessful && response.body() != null) {
                        currentMedia = response.body()
                        displayMediaPreview(currentMedia!!)
                    } else {
                        val rawError = response.errorBody()?.string() ?: ""
                        val cleanMsg = try {
                            val jsonObj = org.json.JSONObject(rawError)
                            jsonObj.optString("error", rawError)
                        } catch (_: Exception) {
                            if (rawError.isNotEmpty()) rawError else "Failed to fetch media details"
                        }

                        if (cleanMsg.contains("age-restricted", ignoreCase = true) || cleanMsg.contains("Sign in", ignoreCase = true)) {
                            androidx.appcompat.app.AlertDialog.Builder(this@MainActivity)
                                .setTitle("🔞 Age-Restricted Video")
                                .setMessage("YouTube requires age verification for this specific video.\n\nPublic videos, music tracks, podcasts, and playlists download automatically without sign-in!")
                                .setPositiveButton("OK", null)
                                .show()
                        } else {
                            Toast.makeText(this@MainActivity, cleanMsg, Toast.LENGTH_LONG).show()
                        }
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    binding.pbLoading.visibility = View.GONE
                    binding.btnFetch.isEnabled = true
                    Toast.makeText(this@MainActivity, "Connection error: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun displayMediaPreview(media: MediaInfoResponse) {
        binding.cardMediaPreview.visibility = View.VISIBLE
        binding.tvTitle.text = media.title
        binding.tvUploader.text = media.uploader
        binding.tvDuration.text = formatDuration(media.duration)

        // Load thumbnail with rounded corners
        Glide.with(this)
            .load(media.thumbnail)
            .transform(RoundedCorners(16))
            .into(binding.ivThumbnail)

        binding.cardMediaPreview.post {
            binding.cardMediaPreview.requestFocus()
        }
    }

    private fun startDownloadJob() {
        val media = currentMedia ?: return
        val url = binding.etUrl.text.toString().trim()
        val jobId = "job_android_${System.currentTimeMillis()}"
        activeJobId = jobId

        // Show progress HUD
        binding.cardProgress.visibility = View.VISIBLE
        binding.tvProgressStatus.text = "Starting Download…"
        binding.tvProgressDetail.text = "Initializing server engine…"
        binding.progressBar.progress = 0
        binding.tvPercent.text = "0%"
        binding.tvSpeedEta.text = "-- MB/s"
        binding.btnOpenFile.visibility = View.GONE
        binding.btnDownload.isEnabled = false

        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val request = DownloadRequest(
                    url = url,
                    quality = selectedQuality,
                    playlistTitle = media.title,
                    jobId = jobId,
                    isSingleVideo = !media.isPlaylist
                )

                val res = ApiClient.apiService.startDownload(request)
                if (res.isSuccessful) {
                    listenToProgress(jobId)
                } else {
                    withContext(Dispatchers.Main) {
                        binding.btnDownload.isEnabled = true
                        Toast.makeText(this@MainActivity, "Failed to start: ${res.message()}", Toast.LENGTH_LONG).show()
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    binding.btnDownload.isEnabled = true
                    Toast.makeText(this@MainActivity, "Error: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private suspend fun listenToProgress(jobId: String) {
        try {
            val response = ApiClient.apiService.streamProgress(jobId)
            val body = response.body() ?: return
            val reader = BufferedReader(InputStreamReader(body.byteStream()))

            var line: String?
            while (reader.readLine().also { line = it } != null) {
                val currentLine = line ?: continue
                if (currentLine.startsWith("data:")) {
                    val json = currentLine.removePrefix("data:").trim()
                    try {
                        val event = gson.fromJson(json, ProgressEvent::class.java)
                        withContext(Dispatchers.Main) {
                            handleProgressEvent(event, jobId)
                        }
                    } catch (_: Exception) {}
                }
            }
        } catch (e: Exception) {
            withContext(Dispatchers.Main) {
                binding.tvProgressDetail.text = "Connection closed: ${e.localizedMessage}"
                binding.btnDownload.isEnabled = true
            }
        }
    }

    private fun handleProgressEvent(event: ProgressEvent, jobId: String) {
        when (event.type) {
            "progress" -> {
                val pct = event.percent.toInt().coerceIn(0, 100)
                binding.progressBar.progress = pct
                binding.tvPercent.text = "$pct%"
                binding.tvProgressStatus.text = "Downloading Video…"
                val speed = event.speed ?: "-- MB/s"
                val eta = event.eta ?: "--:--"
                binding.tvSpeedEta.text = "$speed (ETA: $eta)"
                binding.tvProgressDetail.text = "Processing video streams..."
            }
            "merging" -> {
                binding.tvProgressStatus.text = "Merging Video & Audio…"
                binding.tvProgressDetail.text = "Combining streams with FFmpeg…"
            }
            "done" -> {
                binding.progressBar.progress = 100
                binding.tvPercent.text = "100%"
                binding.tvProgressStatus.text = "🎉 Download Completed!"
                binding.tvProgressDetail.text = "Saving directly to your device…"
                binding.btnDownload.isEnabled = true

                // Enqueue native Android download for each completed file
                val files = event.files ?: emptyList()
                if (files.isNotEmpty()) {
                    val isAudio = selectedQuality == "mp3"
                    files.forEach { fileName ->
                        val remoteDownloadUrl = ApiClient.buildDownloadUrl(jobId, fileName)
                        AndroidDownloadHelper.enqueueDownload(this, remoteDownloadUrl, fileName, isAudio)
                    }
                    Toast.makeText(this, "Saved ${files.size} file(s) to phone storage!", Toast.LENGTH_LONG).show()
                }
            }
            "error" -> {
                binding.tvProgressStatus.text = "Download Failed"
                binding.tvProgressDetail.text = event.message ?: "An unexpected error occurred"
                binding.btnDownload.isEnabled = true
                Toast.makeText(this, "Error: ${event.message}", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun formatDuration(seconds: Long): String {
        if (seconds <= 0) return "0:00"
        val hrs = seconds / 3600
        val mins = (seconds % 3600) / 60
        val secs = seconds % 60
        return if (hrs > 0) {
            String.format("%d:%02d:%02d", hrs, mins, secs)
        } else {
            String.format("%d:%02d", mins, secs)
        }
    }
}
