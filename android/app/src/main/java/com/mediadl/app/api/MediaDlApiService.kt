package com.mediadl.app.api

import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.*

interface MediaDlApiService {

    @GET("api/info")
    suspend fun getMediaInfo(
        @Query("url") url: String
    ): Response<MediaInfoResponse>

    @POST("api/download")
    suspend fun startDownload(
        @Body request: DownloadRequest
    ): Response<DownloadStartResponse>

    @Streaming
    @GET("api/progress/{jobId}")
    suspend fun streamProgress(
        @Path("jobId") jobId: String
    ): Response<ResponseBody>

    @GET("api/auth/status")
    suspend fun getAuthStatus(): Response<AuthStatusResponse>
}
