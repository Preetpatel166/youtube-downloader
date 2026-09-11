package com.mediadl.app.download;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Environment;
import android.util.Log;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import java.io.File;

/**
 * AndroidDownloadHelper - Native Java download manager integration for MediaDL.
 * Downloads video and audio files into standard Android storage (Movies/Music)
 * and automatically indexes them into the device gallery and media library.
 */
public class AndroidDownloadHelper {

    private static final String TAG = "MediaDL_Downloader";

    /**
     * Enqueue a download via Android's native DownloadManager.
     *
     * @param context   Application context
     * @param fileUrl   The remote download endpoint URL
     * @param fileName  Target filename (e.g. "Never Gonna Give You Up.mp4")
     * @param isAudio   True if format is MP3/M4A, false if video
     * @return Download ID from DownloadManager
     */
    public static long enqueueDownload(Context context, String fileUrl, String fileName, boolean isAudio) {
        try {
            DownloadManager downloadManager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
            if (downloadManager == null) {
                Toast.makeText(context, "Download Manager not available", Toast.LENGTH_SHORT).show();
                return -1;
            }

            Uri downloadUri = Uri.parse(fileUrl);
            DownloadManager.Request request = new DownloadManager.Request(downloadUri);

            // Set MIME type
            String mimeType = isAudio ? "audio/mpeg" : "video/mp4";
            request.setMimeType(mimeType);

            // Title & description in Android notification tray
            request.setTitle(fileName);
            request.setDescription("Downloading media via MediaDL");

            // Allow over both Mobile data and Wi-Fi
            request.setAllowedNetworkTypes(DownloadManager.Request.NETWORK_WIFI | DownloadManager.Request.NETWORK_MOBILE);
            request.setAllowedOverRoaming(true);

            // Make visible in Android downloads UI and notifications
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);

            // Target directory: Movies/MediaDL or Music/MediaDL
            String targetSubDir = isAudio ? "Music/MediaDL" : "Movies/MediaDL";
            request.setDestinationInExternalPublicDir(
                    isAudio ? Environment.DIRECTORY_MUSIC : Environment.DIRECTORY_MOVIES,
                    "MediaDL" + File.separator + fileName
            );

            long downloadId = downloadManager.enqueue(request);
            Log.d(TAG, "Download enqueued with ID: " + downloadId + " -> " + fileName);
            Toast.makeText(context, "Saving " + fileName + " to " + targetSubDir, Toast.LENGTH_LONG).show();

            return downloadId;
        } catch (Exception e) {
            Log.e(TAG, "Error enqueuing download: " + e.getMessage(), e);
            Toast.makeText(context, "Download failed: " + e.getMessage(), Toast.LENGTH_LONG).show();
            return -1;
        }
    }

    /**
     * Launch an intent to view/play the downloaded video in the user's preferred media player.
     */
    public static void openDownloadedFile(Context context, File file, boolean isAudio) {
        if (file == null || !file.exists()) {
            Toast.makeText(context, "File does not exist yet", Toast.LENGTH_SHORT).show();
            return;
        }

        try {
            Uri contentUri = FileProvider.getUriForFile(
                    context,
                    context.getPackageName() + ".provider",
                    file
            );

            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(contentUri, isAudio ? "audio/*" : "video/*");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            context.startActivity(Intent.createChooser(intent, "Play with"));
        } catch (Exception e) {
            Log.e(TAG, "Cannot open file: " + e.getMessage());
            Toast.makeText(context, "No app available to play this file", Toast.LENGTH_SHORT).show();
        }
    }
}
