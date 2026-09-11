package com.mediadl.app

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.mediadl.app.databinding.ActivityShareBinding
import java.util.regex.Pattern

/**
 * ShareReceiverActivity intercepts YouTube links shared directly from
 * the YouTube app, Google Chrome, WhatsApp, or any other Android app.
 */
class ShareReceiverActivity : AppCompatActivity() {

    private lateinit var binding: ActivityShareBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityShareBinding.inflate(layoutInflater)
        setContentView(binding.root)

        if (intent?.action == Intent.ACTION_SEND && intent.type == "text/plain") {
            val sharedText = intent.getStringExtra(Intent.EXTRA_TEXT) ?: ""
            val extractedUrl = extractYouTubeUrl(sharedText)

            if (extractedUrl != null) {
                binding.tvSharedUrl.text = "Loading: $extractedUrl"

                // Launch MainActivity with extracted URL
                val mainIntent = Intent(this, MainActivity::class.java).apply {
                    putExtra("EXTRA_YOUTUBE_URL", extractedUrl)
                    flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
                }
                startActivity(mainIntent)
                finish()
            } else {
                Toast.makeText(this, "No valid YouTube URL detected in shared content.", Toast.LENGTH_SHORT).show()
                finish()
            }
        } else {
            finish()
        }
    }

    private fun extractYouTubeUrl(text: String): String? {
        val regex = "(https?://(?:www\\.)?(?:youtube\\.com/watch\\?v=[a-zA-Z0-9_-]+|youtu\\.be/[a-zA-Z0-9_-]+|youtube\\.com/shorts/[a-zA-Z0-9_-]+|youtube\\.com/playlist\\?list=[a-zA-Z0-9_-]+)[^\\s]*)"
        val pattern = Pattern.compile(regex)
        val matcher = pattern.matcher(text)
        return if (matcher.find()) {
            matcher.group(1)
        } else if (text.contains("youtu")) {
            text.trim()
        } else {
            null
        }
    }
}
