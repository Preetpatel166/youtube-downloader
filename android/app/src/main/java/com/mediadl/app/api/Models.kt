package com.mediadl.app.api

import com.google.gson.annotations.SerializedName

data class VideoItem(
    val index: Int = 1,
    val id: String = "",
    val title: String = "",
    val duration: Long = 0,
    val thumbnail: String = "",
    val url: String = ""
)

data class MediaInfoResponse(
    val isPlaylist: Boolean = false,
    val title: String = "",
    val id: String = "",
    val uploader: String = "YouTube Creator",
    val duration: Long = 0,
    val thumbnail: String = "",
    val count: Int = 1,
    val videos: List<VideoItem> = emptyList()
)

data class DownloadRequest(
    val url: String,
    val quality: String = "1080p",
    val playlistTitle: String? = null,
    val jobId: String,
    val isSingleVideo: Boolean = true,
    val selectedIndices: List<Int>? = null
)

data class DownloadStartResponse(
    val status: String = "started",
    val outputDir: String = ""
)

data class ProgressEvent(
    val type: String = "",
    val percent: Float = 0f,
    val speed: String? = null,
    val eta: String? = null,
    val size: String? = null,
    val message: String? = null,
    val files: List<String>? = null,
    val outputDir: String? = null
)

data class AuthStatusResponse(
    val connected: Boolean = false,
    val mode: String = "guest",
    val browser: String? = null
)
