package com.mediadl.app.api

import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object ApiClient {

    var currentBaseUrl: String = "https://youtube-downloader-12ed.onrender.com/"
        set(value) {
            field = if (value.endsWith("/")) value else "$value/"
            retrofitInstance = null
            apiServiceInstance = null
        }

    val okHttpClient: OkHttpClient by lazy {
        val logging = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BASIC
        }
        OkHttpClient.Builder()
            .connectTimeout(60, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .addInterceptor(logging)
            .build()
    }

    private var retrofitInstance: Retrofit? = null
    private var apiServiceInstance: MediaDlApiService? = null

    val apiService: MediaDlApiService
        get() {
            if (apiServiceInstance == null) {
                val retrofit = Retrofit.Builder()
                    .baseUrl(currentBaseUrl)
                    .client(okHttpClient)
                    .addConverterFactory(GsonConverterFactory.create())
                    .build()
                retrofitInstance = retrofit
                apiServiceInstance = retrofit.create(MediaDlApiService::class.java)
            }
            return apiServiceInstance!!
        }

    fun buildDownloadUrl(jobId: String, filename: String): String {
        val base = if (currentBaseUrl.endsWith("/")) currentBaseUrl else "$currentBaseUrl/"
        return "${base}api/download-file?jobId=$jobId&filename=${java.net.URLEncoder.encode(filename, "UTF-8")}"
    }
}
